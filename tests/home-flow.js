import http from 'k6/http';
import { check, fail, group, sleep } from 'k6';
import exec from 'k6/execution';

import {
  API_URL,
  BASE_URL,
  INCLUDE_DUPLICATES,
  THINK_TIME_SECONDS,
  buildOptions,
} from '../lib/config.js';

import { getUserByVuId } from '../lib/users.js';
import { login } from '../lib/auth.js';
import { accountHeaders, teamHeaders } from '../lib/headers.js';
import { checkBatch, encode, json, truncate } from '../lib/helpers.js';
import { createSummary } from '../lib/summary.js';

export const options = buildOptions('home_flow', {
  'checks{type:login}': ['rate>0.95'],
  'checks{type:home}': ['rate>0.95'],
  'checks{type:device}': ['rate>0.95'],
});

const SINGLE_REQUEST_URL = __ENV.SINGLE_REQUEST_URL || '';
const SINGLE_REQUEST_NAME = __ENV.SINGLE_REQUEST_NAME || 'single-request';
const SINGLE_REQUEST_METHOD = (__ENV.SINGLE_REQUEST_METHOD || 'GET').toUpperCase();
const SINGLE_REQUEST_BODY = __ENV.SINGLE_REQUEST_BODY;
const SINGLE_REQUEST_CONTENT_TYPE =
  __ENV.SINGLE_REQUEST_CONTENT_TYPE || 'application/json';
const SKIP_PROFILE = (__ENV.SKIP_PROFILE || 'false').toLowerCase() === 'true';

const ICLOCK_BASE = __ENV.ICLOCK_BASE || `${API_URL}/service/wtm`;
const DEVICE_SERIALS = (__ENV.DEVICE_SERIALS || 'WJA6244800003,HDP1254500162')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const PIN_LIST = (__ENV.DEVICE_PINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const PINS_PER_DEVICE = parseInt(__ENV.PINS_PER_DEVICE || '100', 10);
const PIN_START = parseInt(__ENV.PIN_START || '1', 10);
const VERIFY_MODE = parseInt(__ENV.VERIFY || '15', 10);
const SEND_HEARTBEAT = (__ENV.SEND_HEARTBEAT || 'true').toLowerCase() === 'true';

function deviceNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function attlogLine(pin, punchType) {
  // 47547575  2026-04-29 17:56:30  255  15  0  0  0  0  0  0
  // return `${pin}\t${deviceNow()}\t${punchType}\t${VERIFY_MODE}\t0\n`;
  // 40867160\t2026-07-01 14:27:48\t255\t15\t0\t0\t0\t0\t0\t0
  //return `${pin}\t${deviceNow()}\t255\t${punchType}\t${VERIFY_MODE}\t0\n`;
  return `${pin}\t${deviceNow()}\t255\t15\t0\t0\t0\t0\t0\t0\n`;
}

function applyRequestTemplate(value, variables = {}) {
  return Object.entries(variables).reduce(
    (result, [key, replacement]) =>
      result.replaceAll(`{{${key}}}`, replacement == null ? '' : String(replacement)),
    String(value),
  );
}

export default function () {
  const user = getUserByVuId(exec.vu.idInTest);
  let auth;

  group('01_login', () => {
    auth = login(user);
  });

  const authHeader = auth.sessionToken
    ? {
        Authorization: `Bearer ${auth.sessionToken}`,
      }
    : {};

  const buildAuthHeaders = (headerFactory) => {
    const base = headerFactory();
    const headers = {
      ...base.headers,
      ...authHeader,
    };

    if (auth.cookies) {
      headers.Cookie = Object.entries(auth.cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
    }

    return {
      ...base,
      headers,
    };
  };

  const accountAuthHeaders = () => buildAuthHeaders(accountHeaders);
  const teamAuthHeaders = () => buildAuthHeaders(teamHeaders);

  /*
  group('02_post_login_bootstrap', () => {
    const bootstrapRequests = [
  
      [
        'GET employees/me',
        'GET',
        `${API_URL}/service/engine/api/v1/employees/me/`,
        null,
        accountAuthHeaders(),
      ],
      [
        'GET whoami',
        'GET',
        `${BASE_URL}/sessions/whoami`,
        null,
        accountAuthHeaders(),
      ],
      [
        'GET users/get-all-employees',
        'GET',
        `${API_URL}/service/engine/api/v1/users/get-all-employees/`,
        null,
        accountAuthHeaders(),
      ],
      [
        'GET companies/company',
        'GET',
        `${API_URL}/service/engine/api/v1/companies/company/`,
        null,
        accountAuthHeaders(),
      ],
    ];

    if (INCLUDE_DUPLICATES) {
      bootstrapRequests.push(
        [
          'GET employees/me duplicate',
          'GET',
          `${API_URL}/service/engine/api/v1/employees/me/`,
          null,
          accountAuthHeaders(),
        ],
        [
          'GET whoami duplicate',
          'GET',
          `${BASE_URL}/sessions/whoami`,
          null,
          accountAuthHeaders(),
        ],
        [
          'GET users/get-all-employees duplicate',
          'GET',
          `${API_URL}/service/engine/api/v1/users/get-all-employees/`,
          null,
          accountAuthHeaders(),
        ],
        [
          'GET companies/company duplicate',
          'GET',
          `${API_URL}/service/engine/api/v1/companies/company/`,
          null,
          accountAuthHeaders(),
        ],
      );
    }

    const responses = http.batch(
      bootstrapRequests.map(([name, method, url, body, params]) => ({
        method,
        url,
        body,
        params: {
          ...params,
          tags: {
            name,
            type: 'home',
          },
        },
      })),
    );

    checkBatch(responses, 'bootstrap', 'home');
    
  });
  */

  group('03_home_page', () => {
    if (!auth.sessionToken && !auth.cookies) {
      fail('Login did not return session token or cookies');
    }

    let employeeId;

    if (!SKIP_PROFILE) {
      const profileRes = http.get(
        `${API_URL}/service/engine/api/v2/employees/profile/`,
        {
          headers: teamAuthHeaders().headers,
          tags: {
            name: 'GET employees/profile',
            type: 'home',
          },
        },
      );

      check(
        profileRes,
        {
          'profile status is 200': (r) => r.status === 200,
          'profile has employee id': (r) => Boolean(json(r)?.id),
        },
        { type: 'home' },
      );

      if (profileRes.status !== 200) {
        console.error(
          `profile failed: ${profileRes.status} ${profileRes.request.url} body=${truncate(profileRes.body, 1000)}`,
        );
      }

      const profile = json(profileRes);
      employeeId = profile?.id;
    }

    const requestVariables = {
      API_URL,
      BASE_URL,
      employeeId,
    };

    let homeRequests;

    if (SINGLE_REQUEST_URL) {
      const singleRequestParams = teamAuthHeaders();

      if (typeof SINGLE_REQUEST_BODY !== 'undefined') {
        singleRequestParams.headers = {
          ...singleRequestParams.headers,
          'Content-Type': SINGLE_REQUEST_CONTENT_TYPE,
        };
      }

      homeRequests = [
        [
          SINGLE_REQUEST_NAME,
          SINGLE_REQUEST_METHOD,
          applyRequestTemplate(SINGLE_REQUEST_URL, requestVariables),
          typeof SINGLE_REQUEST_BODY === 'undefined'
            ? null
            : applyRequestTemplate(SINGLE_REQUEST_BODY, requestVariables),
          singleRequestParams,
        ],
      ];
    } else {
      homeRequests = [
      /*
      [
        'GET dms/categories',
        'GET',
        `${API_URL}/service/dms/api/v1/directories/categories/?limit=50`,
        null,
        teamAuthHeaders(),
      ],
      [
        'GET companies/widget',
        'GET',
        `${API_URL}/service/engine/api/v2/companies/widget/`,
        null,
        teamAuthHeaders(),
      ],
      [
        'GET employees/widget',
        'GET',
        `${API_URL}/service/engine/api/v2/employees/widget/`,
        null,
        teamAuthHeaders(),
      ],
      [
        'GET vacations/days_left',
        'GET',
        `${API_URL}/service/rcs/api/v1/vacations/days_left`,
        null,
        teamAuthHeaders(),
      ],
      */
      
      // [
      //   'GET calendar/today-marks',
      //   'GET',
      //   `${API_URL}/service/wtm/api/v1/calendar/today-marks/`,
      //   null,
      //   teamAuthHeaders(),
      // ],
      //
      // [
      //   'GET calendar/mobile-today-marks',
      //   'GET',
      //   `${API_URL}/service/wtm/api/v1/calendar/mobile-today-marks/`,
      //   null,
      //   teamAuthHeaders(),
      // ],
      //
      // [
      //   'POST worktime/check-in',
      //   'POST',
      //   `${API_URL}/service/wtm/api/v1/worktime/check-in/`,
      //   JSON.stringify({
      //     point: {
      //       type: 'Point',
      //       coordinates: [76.89098865482002, 43.204904374511756],
      //     },
      //     comment: '123',
      //   }),
      //   {
      //     headers: {
      //       ...teamAuthHeaders().headers,
      //       'Content-Type': 'application/json',
      //     },
      //   },
      // ],
      //
      // [
      //   'GET calendar/organization-shift',
      //   'GET',
      //   `${API_URL}/service/wtm/api/v1/calendar/organization-shift/2026/6/?page=1&page_size=20&multiple_status=INVITED%2CREGISTERED_IN_1C%2CACTIVE%2CANNUAL_LEAVE%2CSOCIAL_LEAVE%2CSICK_LEAVE%2CBUSINESS_TRIP%2CDISABLED%2CSUSPENDED%2CTERMINATED`,
      //   null,
      //   teamAuthHeaders(),
      // ],
      //
      // [
      //   'GET calendar/events',
      //   'GET',
      //   `${API_URL}/service/wtm/api/v1/calendar/events/?year=2026&month=6`,
      //   null,
      //   teamAuthHeaders(),
      // ],
      [
        'POST calendar/export',
        'POST',
        `${API_URL}/service/wtm/api/v1/calendar/export/`,
        JSON.stringify({
          months: ['2026-07'],
          with_schedule_control: true,
          with_mark_verification: true,
          with_events: true,
          with_comments: true,
          report_type: 'horizontal',
        }),
        {
          headers: {
            ...teamAuthHeaders().headers,
            'Content-Type': 'application/json',
          },
        },
      ],
      
      ];
    }

    if (employeeId) {
      /*
      homeRequests.push(
        [
          'GET employee-roles',
          'GET',
          `${API_URL}/service/ams/api/v1/employee-roles/?employee=${encode(employeeId)}`,
          null,
          teamAuthHeaders(),
        ],
        [
          'GET documents limit 100',
          'GET',
          `${API_URL}/service/dms/api/v1/documents/?employee_id=${encode(employeeId)}&limit=100`,
          null,
          teamAuthHeaders(),
        ],
        [
          'GET hire-dates',
          'GET',
          `${API_URL}/service/engine/api/v1/employees/position/get-hire-dates/?employee_id=${encode(employeeId)}`,
          null,
          teamAuthHeaders(),
        ],
      );

      if (INCLUDE_DUPLICATES) {
        homeRequests.push(
          [
            'GET employees/profile duplicate',
            'GET',
            `${API_URL}/service/engine/api/v2/employees/profile/`,
            null,
            teamAuthHeaders(),
          ],
          [
            'GET documents limit 30 duplicate',
            'GET',
            `${API_URL}/service/dms/api/v1/documents/?employee_id=${encode(employeeId)}&limit=30`,
            null,
            teamAuthHeaders(),
          ],
          [
            'GET hire-dates duplicate',
            'GET',
            `${API_URL}/service/engine/api/v1/employees/position/get-hire-dates/?employee_id=${encode(employeeId)}`,
            null,
            teamAuthHeaders(),
          ],
        );
      }
      */
    }

    const responses = http.batch(
      homeRequests.map(([name, method, url, body, params]) => ({
        method,
        url,
        body,
        params: {
          ...params,
          tags: {
            name,
            type: 'home',
          },
        },
      })),
    );

    checkBatch(responses, 'home_page', 'home');
  });
  

  /*
  group('04_device_flow', () => {
    const serial = DEVICE_SERIALS[(exec.vu.idInTest - 1) % DEVICE_SERIALS.length];
    const pinSlot = (exec.vu.idInTest - 1) + exec.vu.iterationInInstance;
    const pin =
      PIN_LIST.length > 0
        ? PIN_LIST[pinSlot % PIN_LIST.length]
        : PIN_START + (pinSlot % PINS_PER_DEVICE);

    const cdataUrl = `${ICLOCK_BASE}/iclock/cdata?SN=${encodeURIComponent(serial)}&table=ATTLOG`;

    group('04_heartbeat', () => {
      if (!SEND_HEARTBEAT) return;

      const res = http.get(
        `${ICLOCK_BASE}/iclock/getrequest?SN=${encodeURIComponent(serial)}&INFO=loadtest`,
        {
          headers: teamAuthHeaders().headers,
          tags: { name: 'GET iclock/getrequest', type: 'device' },
        },
      );

      check(
        res,
        { 'heartbeat status is 200': (r) => r.status === 200 },
        { type: 'device' },
      );
    });

    group('04_check_in', () => {
      const res = http.post(cdataUrl, attlogLine(pin, 0), {
        headers: {
          ...teamAuthHeaders().headers,
          'Content-Type': 'text/plain',
        },
        tags: { name: 'POST iclock/cdata check-in', type: 'device' },
      });

      check(
        res,
        {
          'check-in status is 200': (r) => r.status === 200,
          'check-in body is OK': (r) => (r.body || '').trim() === 'OK',
        },
        { type: 'device' },
      );
    });

    group('04_check_out', () => {
      const res = http.post(cdataUrl, attlogLine(pin, 1), {
        headers: {
          ...teamAuthHeaders().headers,
          'Content-Type': 'text/plain',
        },
        tags: { name: 'POST iclock/cdata check-out', type: 'device' },
      });

      check(
        res,
        {
          'check-out status is 200': (r) => r.status === 200,
          'check-out body is OK': (r) => (r.body || '').trim() === 'OK',
        },
        { type: 'device' },
      );
    });
  });
  
  sleep(THINK_TIME_SECONDS);
  */
}

export const handleSummary = createSummary();