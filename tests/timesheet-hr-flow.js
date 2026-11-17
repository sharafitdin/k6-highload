// Timesheet (табель) flow для роли HR.
//
// Сценарий (по HAR dev-team.mylink.kz, 2026-11-16):
//   01_login                 — общий login из lib/auth.js
//   02_open_timesheets_list  — страница "Табели": профиль, роли, список табелей за месяц, дерево подразделений
//   03_ensure_timesheet      — если табеля по подразделению за период нет — создаём (POST /timesheets/)
//   04_open_timesheet        — открытие табеля подразделения (тяжёлая сетка ~200KB + alerts/revision/filters/codes)
//   05_edit_cells            — правка ячеек сотрудник/день через PUT /timesheets/{y}/{m}/changes/
//   06_view_history          — история изменений табеля
//
// ВНИМАНИЕ: сценарий ИЗМЕНЯЕТ данные (создаёт табель, правит смены/часы в ячейках).
// Отправка на согласование / согласование / возврат на доработку НЕ входят в тест намеренно —
// они блокируют табель и мешают ручному тестированию.
// Cleanup не делается (согласовано).

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';

import { API_URL, THINK_TIME_SECONDS, buildOptions } from '../lib/config.js';
import { getUserByVuId } from '../lib/users.js';
import { login } from '../lib/auth.js';
import { teamHeaders } from '../lib/headers.js';
import { checkBatch, encode, json, truncate } from '../lib/helpers.js';
import { createSummary } from '../lib/summary.js';

export const options = buildOptions('timesheet_hr_flow', {
  'checks{type:login}': ['rate>0.95'],
  'checks{type:timesheet}': ['rate>0.95'],
  'checks{type:timesheet_edit}': ['rate>0.95'],
  'http_req_duration{name:GET timesheet grid}': ['p(95)<3000'],
  'http_req_duration{name:PUT timesheet changes}': ['p(95)<2000'],
  'http_req_duration{name:GET timesheet changes delta}': ['p(95)<1000'],
});

// ---------- параметры ----------

const WTM_API = `${(__ENV.TIMESHEET_API_URL || API_URL).replace(/\/$/, '')}/service/wtm/api/v1`;
const ENGINE_API = `${(__ENV.TIMESHEET_API_URL || API_URL).replace(/\/$/, '')}/service/engine/api`;
const AMS_API = `${(__ENV.TIMESHEET_API_URL || API_URL).replace(/\/$/, '')}/service/ams/api/v1`;

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Период табеля YYYY-MM (по умолчанию — текущий месяц)
const PERIOD = __ENV.TIMESHEET_PERIOD || currentPeriod();
const [YEAR, MONTH_PADDED] = PERIOD.split('-');
const MONTH = String(Number(MONTH_PADDED)); // в URL сетки месяц без ведущего нуля: /timesheets/2026/11/

// Подразделения, по которым HR работает с табелем. VU распределяются по ним по кругу.
const DEPARTMENT_IDS = (__ENV.TIMESHEET_DEPARTMENT_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Сколько ячеек правит один HR за итерацию
const EDITS_PER_ITERATION = parseInt(__ENV.EDITS_PER_ITERATION || '2', 10);
// Разрешено ли создавать табель, если его нет
const ALLOW_CREATE = (__ENV.ALLOW_CREATE || 'true').toLowerCase() === 'true';
// Комментарий к правке (виден в истории табеля)
const EDIT_COMMENT = __ENV.EDIT_COMMENT || 'k6 load test';
// Что делать после сохранения правки:
//   month — как текущий фронт: перечитать весь месяц (GET /timesheets/{y}/{m}/)
//   delta — как новый фронт: GET /timesheets/{y}/{m}/changes/?since=<ревизия>
const AFTER_EDIT_MODE = (__ENV.AFTER_EDIT_MODE || 'month').toLowerCase();

// ---------- метрики ----------

const editConflicts = new Counter('timesheet_edit_conflicts'); // 409 на PUT changes
const editRetries = new Counter('timesheet_edit_retries');
const editsDone = new Counter('timesheet_edits_done');
const gridSize = new Trend('timesheet_grid_bytes');
const deltaSize = new Trend('timesheet_delta_bytes');

// ---------- helpers ----------

// Пауза при прерванной итерации: без неё VU сразу перелогинивается и
// превращает сбой бэкенда в шторм логинов (искажает нагрузку и метрики).
const FAIL_BACKOFF_SECONDS = Number(__ENV.FAIL_BACKOFF_SECONDS || 10);
const failedIterations = new Counter('timesheet_failed_iterations');

function backoff() {
  failedIterations.add(1);
  sleep(FAIL_BACKOFF_SECONDS);
}

function buildAuthParams(auth, name, type, extraHeaders = {}) {
  const headers = { ...teamHeaders().headers, ...extraHeaders };

  if (auth.sessionToken) {
    headers.Authorization = `Bearer ${auth.sessionToken}`;
  }

  if (auth.cookies) {
    headers.Cookie = Object.entries(auth.cookies)
      .map(([cookieName, values]) => {
        // k6 res.cookies: { name: [{ value, ... }] }
        const value = Array.isArray(values) ? values[0]?.value : values;
        return `${cookieName}=${value}`;
      })
      .join('; ');
  }

  return { headers, tags: { name, type } };
}

function batchGet(auth, requests, label, type) {
  const responses = http.batch(
    requests.map(([name, url]) => ({
      method: 'GET',
      url,
      params: buildAuthParams(auth, name, type),
    })),
  );

  checkBatch(responses, label, type);

  const byName = {};
  requests.forEach(([name], i) => {
    byName[name] = responses[i];
  });
  return byName;
}

// departments/tree → Map(department_id → employees_count) по всем уровням вложенности
function flattenDepartmentTree(nodes, out = new Map()) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node?.id) out.set(node.id, Number(node.employees_count || 0));
    flattenDepartmentTree(node?.children, out);
  }
  return out;
}

function findTimesheetForDepartment(listBody, departmentId) {
  const items = listBody?.timesheets || [];
  return items.find(
    (t) =>
      t.period === PERIOD &&
      (t.departments || []).some((d) => d.department_id === departmentId),
  );
}

// Ячейки, которые можно править: прошедший рабочий день с плановой сменой,
// без read-only событий и без событий из календаря (больничный/отпуск и т.п.).
function editableCells(grid) {
  const cells = [];

  for (const emp of grid?.employees || []) {
    for (const day of emp.days || []) {
      if (day.is_future || !day.is_work_day || !day.planned_start || !day.planned_end) continue;

      const events = day.events || [];
      if (events.some((e) => e.is_read_only || e.source === 'calendar')) continue;

      cells.push({
        employeeId: emp.employee_id,
        date: day.date,
        plannedStart: day.planned_start,
        plannedEnd: day.planned_end,
        plannedHours: Number(day.planned_hours || 0),
      });
    }
  }

  return cells;
}

// Детерминированно разносим VU/итерации по разным ячейкам, чтобы HR не правили одну и ту же клетку.
function pickCell(cells, editIndex) {
  const vu = exec.vu.idInTest - 1;
  const iter = exec.vu.iterationInScenario;
  const idx = (vu * 7919 + iter * EDITS_PER_ITERATION + editIndex) % cells.length;
  return cells[idx];
}

function putChanges(auth, departmentId, cell) {
  // Повторяем действие из HAR: смена по плановому графику + фактические часы.
  const body = JSON.stringify({
    department_id: departmentId,
    changes: [
      {
        kind: 'shift',
        employee_id: cell.employeeId,
        date: cell.date,
        planned_start: cell.plannedStart,
        planned_end: cell.plannedEnd,
        absence_to_attendance: true,
        comment: EDIT_COMMENT,
      },
      {
        kind: 'timesheet_hours',
        employee_id: cell.employeeId,
        date: cell.date,
        timesheet_hours: cell.plannedHours,
        night_hours: 0,
      },
    ],
  });

  return http.put(
    `${WTM_API}/timesheets/${YEAR}/${MONTH}/changes/`,
    body,
    buildAuthParams(auth, 'PUT timesheet changes', 'timesheet_edit', {
      'Content-Type': 'application/json',
    }),
  );
}

// ---------- flow ----------

export default function () {
  const user = getUserByVuId(exec.vu.idInTest);
  let auth;

  group('01_login', () => {
    try {
      auth = login(user);
    } catch (e) {
      // login() вызывает fail() при ошибке — ловим, чтобы сработала пауза ниже
      console.error(`login failed: ${String(e).slice(0, 300)}`);
    }
  });

  if (!auth || (!auth.sessionToken && !auth.cookies)) {
    console.error('Login did not return session token or cookies');
    backoff();
    return;
  }

  let departmentId = DEPARTMENT_IDS.length
    ? DEPARTMENT_IDS[(exec.vu.idInTest - 1) % DEPARTMENT_IDS.length]
    : undefined;
  let listBody;

  group('02_open_timesheets_list', () => {
    const profileRes = http.get(
      `${ENGINE_API}/v2/employees/profile/`,
      buildAuthParams(auth, 'GET employees/profile', 'timesheet'),
    );
    check(profileRes, { 'profile status is 200': (r) => r.status === 200 }, { type: 'timesheet' });
    const employeeId = json(profileRes)?.id;

    const reqs = [
      ['GET employee-department-manager', `${ENGINE_API}/v1/employees/employee/department-manager/`],
      ['GET timesheets list by month', `${WTM_API}/timesheets/?month=${PERIOD}`],
      ['GET departments tree', `${ENGINE_API}/v1/schedules/departments/tree/`],
    ];
    if (employeeId) {
      reqs.push(['GET employee-roles', `${AMS_API}/employee-roles/?employee=${encode(employeeId)}`]);
    }

    const res = batchGet(auth, reqs, 'timesheets list', 'timesheet');
    listBody = json(res['GET timesheets list by month']);

    check(
      res['GET timesheets list by month'],
      { 'timesheets list has items array': () => Array.isArray(listBody?.timesheets) },
      { type: 'timesheet' },
    );

    // Если подразделение не задано через env — берём табели периода в статусе IN_PROGRESS
    // только по отделам, где есть сотрудники (employees_count из дерева подразделений + headcount табеля),
    // и распределяем VU по ним по кругу. Табели с 0 сотрудников — баг на dev, их не трогаем.
    if (!departmentId) {
      const employeesByDepartment = flattenDepartmentTree(json(res['GET departments tree']));
      const hasEmployees = (depId) =>
        // если дерево не пришло — опираемся только на headcount табеля
        !employeesByDepartment.size || Number(employeesByDepartment.get(depId) || 0) > 0;

      const candidates = (listBody?.timesheets || []).filter(
        (t) =>
          t.period === PERIOD &&
          t.status === 'IN_PROGRESS' &&
          Number(t.headcount || 0) > 0 &&
          (t.departments || []).length &&
          hasEmployees(t.departments[0].department_id),
      );
      if (!candidates.length) {
        console.error(`Нет табелей IN_PROGRESS с сотрудниками за ${PERIOD}`);
      }
      const ts = candidates[(exec.vu.idInTest - 1) % (candidates.length || 1)];
      departmentId = ts?.departments[0]?.department_id;
    }
  });

  if (!departmentId) {
    console.error(`No department for timesheet: set TIMESHEET_DEPARTMENT_IDS (period=${PERIOD})`);
    backoff();
    return;
  }

  sleep(THINK_TIME_SECONDS);

  group('03_ensure_timesheet', () => {
    // Список табелей не загрузился (502 и т.п.) — не знаем, есть ли табель, создавать не пытаемся
    if (!Array.isArray(listBody?.timesheets)) return;
    if (findTimesheetForDepartment(listBody, departmentId)) return;

    if (!ALLOW_CREATE) {
      console.error(`Timesheet for department=${departmentId} period=${PERIOD} not found, ALLOW_CREATE=false`);
      return;
    }

    const createRes = http.post(
      `${WTM_API}/timesheets/`,
      JSON.stringify({ period: PERIOD, department_ids: [departmentId] }),
      buildAuthParams(auth, 'POST timesheets create', 'timesheet', {
        'Content-Type': 'application/json',
      }),
    );

    // 201 — создан; 400/409 — параллельный VU уже создал табель по этому подразделению (это ок)
    const created = check(
      createRes,
      { 'timesheet created or already exists': (r) => [201, 400, 409].includes(r.status) },
      { type: 'timesheet' },
    );
    if (!created || createRes.status !== 201) {
      console.warn(`create timesheet status=${createRes.status} body=${truncate(createRes.body, 500)}`);
    }

    batchGet(
      auth,
      [
        ['GET timesheets list in_progress', `${WTM_API}/timesheets/?status=in_progress`],
        ['GET timesheets list by month', `${WTM_API}/timesheets/?month=${PERIOD}`],
      ],
      'after create',
      'timesheet',
    );
  });

  sleep(THINK_TIME_SECONDS);

  let grid;
  let timesheetId;

  group('04_open_timesheet', () => {
    const dep = encode(departmentId);
    const res = batchGet(
      auth,
      [
        ['GET timesheet grid', `${WTM_API}/timesheets/${YEAR}/${MONTH}/?department_id=${dep}`],
        ['GET timesheet alerts', `${WTM_API}/timesheets/${YEAR}/${MONTH}/alerts/?department_id=${dep}&limit=500`],
        ['GET timesheet revision', `${WTM_API}/timesheets/${YEAR}/${MONTH}/revision/?department_id=${dep}`],
        ['GET timesheet employee-filter', `${WTM_API}/timesheets/employee-filter/?year=${YEAR}&month=${MONTH}&department_id=${dep}`],
        ['GET timesheets in_progress by department', `${WTM_API}/timesheets/?status=in_progress&department_id=${dep}`],
        ['GET timesheets archive by department', `${WTM_API}/timesheets/?status=archive&department_id=${dep}`],
        ['GET timesheet codes', `${WTM_API}/timesheets/codes/`],
      ],
      'open timesheet',
      'timesheet',
    );

    const gridRes = res['GET timesheet grid'];
    grid = json(gridRes);
    timesheetId = grid?.timesheet_id;
    gridSize.add(gridRes.body ? gridRes.body.length : 0);

    check(
      gridRes,
      {
        'grid has timesheet_id': () => Boolean(timesheetId),
        'grid has employees': () => (grid?.employees || []).length > 0,
      },
      { type: 'timesheet' },
    );
  });

  if (!timesheetId) {
    backoff();
    return;
  }

  sleep(THINK_TIME_SECONDS);

  group('05_edit_cells', () => {
    if (grid.status !== 'IN_PROGRESS') {
      console.warn(`timesheet ${timesheetId} status=${grid.status} — редактирование пропущено`);
      return;
    }

    const cells = editableCells(grid);
    if (!cells.length) {
      console.warn(`timesheet ${timesheetId}: нет редактируемых ячеек`);
      return;
    }

    const dep = encode(departmentId);
    let knownRevision = Number(grid.revision || 0);

    for (let i = 0; i < EDITS_PER_ITERATION; i++) {
      const cell = pickCell(cells, i);

      // Клик по ячейке: история дня + справочник кодов
      batchGet(
        auth,
        [
          ['GET timesheet day history', `${WTM_API}/timesheets/${timesheetId}/days/${cell.date}/history/?origin=all&limit=500`],
          ['GET timesheet codes', `${WTM_API}/timesheets/codes/`],
        ],
        'open cell',
        'timesheet',
      );

      sleep(THINK_TIME_SECONDS);

      let putRes = putChanges(auth, departmentId, cell);

      // calendar_version / конкурентная правка: перечитываем ревизию и пробуем ещё раз
      if (putRes.status === 409) {
        editConflicts.add(1);
        editRetries.add(1);
        http.get(
          `${WTM_API}/timesheets/${YEAR}/${MONTH}/revision/?department_id=${dep}`,
          buildAuthParams(auth, 'GET timesheet revision', 'timesheet'),
        );
        putRes = putChanges(auth, departmentId, cell);
      }

      const ok = check(
        putRes,
        {
          'PUT changes status is 200': (r) => r.status === 200,
          'PUT changes returns revision': (r) => typeof json(r)?.revision === 'number',
        },
        { type: 'timesheet_edit' },
      );

      if (ok) {
        editsDone.add(1);
      } else {
        console.error(
          `PUT changes failed status=${putRes.status} employee=${cell.employeeId} date=${cell.date} body=${truncate(putRes.body, 1000)}`,
        );
      }

      if (AFTER_EDIT_MODE === 'delta') {
        // Новый фронт: вместо перечитывания месяца берём дельту с ревизии до правки
        const deltaRes = http.get(
          `${WTM_API}/timesheets/${YEAR}/${MONTH}/changes/?department_id=${dep}&since=${knownRevision}`,
          buildAuthParams(auth, 'GET timesheet changes delta', 'timesheet'),
        );
        const delta = json(deltaRes);
        const deltaOk = check(
          deltaRes,
          {
            'delta status is 200': (r) => r.status === 200,
            'delta has employees': () => Array.isArray(delta?.employees),
          },
          { type: 'timesheet' },
        );
        deltaSize.add(deltaRes.body ? deltaRes.body.length : 0);
        if (!deltaOk) {
          console.error(`delta failed status=${deltaRes.status} body=${truncate(deltaRes.body, 500)}`);
        }
        if (typeof delta?.revision === 'number') knownRevision = delta.revision;

        batchGet(
          auth,
          [
            ['GET timesheet day history', `${WTM_API}/timesheets/${timesheetId}/days/${cell.date}/history/?origin=all&limit=500`],
            ['GET timesheet revision', `${WTM_API}/timesheets/${YEAR}/${MONTH}/revision/?department_id=${dep}`],
          ],
          'after edit',
          'timesheet',
        );
      } else {
        // Текущий фронт: после сохранения перечитывает весь месяц, историю дня и ревизию
        batchGet(
          auth,
          [
            ['GET timesheet grid', `${WTM_API}/timesheets/${YEAR}/${MONTH}/?department_id=${dep}`],
            ['GET timesheet day history', `${WTM_API}/timesheets/${timesheetId}/days/${cell.date}/history/?origin=all&limit=500`],
            ['GET timesheet revision', `${WTM_API}/timesheets/${YEAR}/${MONTH}/revision/?department_id=${dep}`],
          ],
          'after edit',
          'timesheet',
        );
      }

      sleep(THINK_TIME_SECONDS);
    }
  });

  group('06_view_history', () => {
    const dep = encode(departmentId);
    batchGet(
      auth,
      [
        ['GET timesheet history', `${WTM_API}/timesheets/${timesheetId}/history/?origin=all&limit=500`],
        ['GET timesheet revision', `${WTM_API}/timesheets/${YEAR}/${MONTH}/revision/?department_id=${dep}`],
      ],
      'history',
      'timesheet',
    );
  });

  sleep(THINK_TIME_SECONDS);
}

export const handleSummary = createSummary();
