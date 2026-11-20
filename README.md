# k6 Highload — нагрузочные тесты MyLink

Набор нагрузочных тестов на [k6](https://k6.io) для сервисов MyLink: авторизация через SSO, главная страница и отдельные API (в том числе сервис учёта рабочего времени **wtm**), отметки с терминалов (iclock) и табель.

Каждый тест — это сценарий реального пользователя: логин, затем те же запросы, что делает фронт. Тесты запускаются готовыми скриптами под нужный стенд (dev / stage / prod) в двух режимах: **smoke** (проверить, что сценарий работает) и **load** (дать нагрузку). Результат каждого запуска сохраняется в отдельную папку с HTML-отчётом.

## Что тестируется

| Сценарий | Файл | Что делает пользователь | Основные эндпоинты | Меняет данные |
|---|---|---|---|---|
| **login** | `tests/login-flow.js` | Только логин | SSO (Ory Kratos): `GET /self-service/login/browser\|api`, `POST <flow action>` | нет |
| **home** | `tests/home-flow.js` | Логин → профиль → запросы главной страницы. Умеет нагружать **любой один URL** (режим single request) | `engine/api/v2/employees/profile/`, сейчас включён `POST wtm/api/v1/calendar/export/` | зависит от запроса |
| **device** | `tests/device-flow.js` | Терминал (ZKTeco iclock) шлёт heartbeat и отметки прихода/ухода | `wtm/iclock/getrequest`, `POST wtm/iclock/cdata?table=ATTLOG` | **да** (отметки) |
| **timesheet-hr** | `tests/timesheet-hr-flow.js` | HR открывает табель, при необходимости создаёт его, правит ячейки, смотрит историю | `wtm/api/v1/timesheets/…` (список, сетка месяца, `changes/`, дельта, история) | **да** (табель) |

Все пути API идут от `API_URL` из `.env.<стенд>`, например `https://dev-sso.mylink.kz/service/wtm/api/v1/...`. Авторизация — Bearer-токен, который возвращает логин в режиме `LOGIN_FLOW_MODE=api`, или cookies в режиме `browser`.

## Быстрый старт

1. Установить k6: `brew install k6` (macOS) или по [инструкции](https://grafana.com/docs/k6/latest/set-up/install-k6/). Для отчёта по табелю нужен ещё `python3`.
2. Подключить VPN: dev и stage доступны только через него.
3. Выдать права на скрипты:

   ```bash
   find scripts -type f -name "*.sh" -exec chmod +x {} \;
   ```

4. Положить учётки в `users/` (см. «Учётки»).
5. Запустить smoke, например логин на dev:

   ```bash
   ./scripts/dev/run-dev-login-smoke.sh
   ```

6. Открыть отчёт `results/dev/login-flow/smoke/<дата-время>/summary.html`.

Запускать тесты нужно **только через скрипты** из `scripts/`: они подгружают `.env.<стенд>`, задают параметры нагрузки и создают папку для результатов. Прямой `k6 run tests/...` упадёт с `Missing required env variable: BASE_URL`.

## Структура проекта

```text
tests/        сценарии (по одному файлу на flow)
lib/          общий код: логин, конфиг и профили нагрузки, заголовки, чтение учёток, отчёт
scripts/      скрипты запуска: scripts/<стенд>/run-<стенд>-<flow>-<smoke|load>.sh
              + run-timesheet-compare.sh и timesheet-report.py для табеля
users/        CSV с учётками (в git только dev и пример)
results/      результаты запусков: results/<стенд>/<flow>/<режим>/<дата-время>/
docs/         отчёты по проведённым тестам
instruction/  подробная инструкция и промпт для генерации нового flow из HAR
.env.<стенд>  адреса стендов и путь к файлу учёток
```

`lib/` содержит только общую логику. Бизнес-сценарии живут в `tests/`.

| Модуль | Назначение |
|---|---|
| `lib/auth.js` | Логин через Ory Kratos: `browser` (форма + csrf, возвращает cookies) или `api` (возвращает `session_token`) |
| `lib/config.js` | Чтение env, профили нагрузки smoke/load, пороги по умолчанию |
| `lib/headers.js` | Общие заголовки для accounts/team |
| `lib/users.js` | Чтение CSV с учётками. Виртуальный пользователь N берёт строку N по кругу |
| `lib/helpers.js` | `json()`, `checkBatch()`, `truncate()` и другие мелочи |
| `lib/summary.js` | Сохранение `summary.html` и `summary.json` |

## Стенды и учётки

| Стенд | env-файл | Адреса | Учётки |
|---|---|---|---|
| dev | `.env.dev` | `dev-sso.mylink.kz`, `dev-team.mylink.kz` | `users/users-dev.csv` (в git) |
| stage | `.env.stage` | `stage-sso.mylink.kz`, `stage-team.mylink.kz` | `users/users-stage.csv`; для табеля — `users/users-stage-timesheet.csv` |
| prod | `.env.prod` | прод | `users/users-prod.csv` |

В `.env.*` только адреса и путь к учёткам. Параметры нагрузки задаются в `.sh`-скриптах.

Формат CSV (пример — `users/users-example.csv`):

```csv
identifier,password
user@example.com,password
```

Учётки stage и prod в git не хранятся (см. `.gitignore`), их передают отдельно. Учётка не должна требовать 2FA: со вторым фактором запросы получают 401/403. Для табеля нужна роль `hr` (или `timekeeper`).

## Режимы запуска

**smoke** — короткая проверка, что сценарий проходит (по умолчанию 1 пользователь, 1 итерация). Всегда запускается перед load.

**load** — нагрузка по ступеням (`ramping-vus`):

```text
0 → VUS_1 за RAMP_1 → VUS за RAMP_2 → держим VUS в течение HOLD → 0 за RAMP_DOWN
```

Пороги по умолчанию: ошибок < 5%, p95 времени ответа < 2 с, у каждого сценария есть свои проверки (`checks`) не ниже 95%. Если порог не выполнен, k6 пишет `thresholds … have been crossed`. Это значит, что сервис не уложился в норму, а не что тест сломан.

Общие переменные (задаются в скриптах или перед командой):

| Переменная | По умолчанию | Описание |
|---|---|---|
| `TEST_MODE` | `smoke` | `smoke` или `load` |
| `VUS`, `ITERATIONS`, `MAX_DURATION` | `1`, `1`, `1m` | smoke |
| `VUS_1`, `VUS`, `RAMP_1`, `RAMP_2`, `HOLD`, `RAMP_DOWN` | `500`, `2000`, `5m`, `10m`, `10m`, `5m` | load; в скриптах заданы свои, гораздо меньшие значения |
| `LOGIN_FLOW_MODE` | `browser` | `browser` (cookies) или `api` (Bearer-токен) |
| `THINK_TIME_SECONDS` | `1` | пауза между действиями пользователя |

## Сценарии

### login — авторизация

Проверяет только SSO: создание login flow и отправку логина и пароля. Подходит для нагрузки на сам SSO.

```bash
./scripts/dev/run-dev-login-smoke.sh
./scripts/dev/run-dev-login-load.sh      # 10 → 50 пользователей, ~7 мин
```

Скрипты есть для dev, stage и prod.

### home — главная страница и отдельные URL wtm

Логинится, получает профиль сотрудника и отправляет пачку запросов главной страницы. Сейчас в списке включён только `POST /service/wtm/api/v1/calendar/export/` (экспорт календаря). Остальные запросы (виджеты, отметки, календарь, документы) лежат в файле закомментированными: их можно включить по необходимости.

```bash
./scripts/dev/run-dev-home-smoke.sh
./scripts/dev/run-dev-home-load.sh
```

**Нагрузка на один любой URL** без правки кода — через переменные:

```bash
SINGLE_REQUEST_URL='{{API_URL}}/service/wtm/api/v1/calendar/today-marks/' \
SINGLE_REQUEST_NAME='GET today-marks' \
./scripts/dev/run-dev-home-load.sh
```

| Переменная | Описание |
|---|---|
| `SINGLE_REQUEST_URL` | URL запроса. Подстановки: `{{API_URL}}`, `{{BASE_URL}}`, `{{employeeId}}` |
| `SINGLE_REQUEST_METHOD` | `GET` по умолчанию |
| `SINGLE_REQUEST_BODY` | тело запроса, те же подстановки |
| `SINGLE_REQUEST_CONTENT_TYPE` | `application/json` по умолчанию |
| `SINGLE_REQUEST_NAME` | имя запроса в отчёте |
| `SKIP_PROFILE` | `true` — не запрашивать профиль (тогда `{{employeeId}}` пустой) |

### device — отметки с терминалов (iclock)

Имитирует терминал ZKTeco: heartbeat (`GET /service/wtm/iclock/getrequest`), отметка прихода и ухода (`POST /service/wtm/iclock/cdata?table=ATTLOG`, ответ должен быть `OK`). Работает только с `LOGIN_FLOW_MODE=api`. **Создаёт отметки** у сотрудников с указанными PIN.

Готовых скриптов для него нет, запуск вручную:

```bash
set -a; source .env.dev; set +a
RESULTS_DIR="results/dev/device-flow/smoke/$(date +%F_%H-%M-%S)"; mkdir -p "$RESULTS_DIR"
TEST_MODE=smoke LOGIN_FLOW_MODE=api RESULTS_DIR="$RESULTS_DIR" k6 run tests/device-flow.js
```

| Переменная | По умолчанию | Описание |
|---|---|---|
| `DEVICE_SERIALS` | `WJA6244800003,HDP1254500162` | серийные номера терминалов, по кругу на пользователей |
| `DEVICE_PINS` | пусто | PIN сотрудников через запятую; пусто — `PIN_START … PIN_START+PINS_PER_DEVICE-1` |
| `PIN_START`, `PINS_PER_DEVICE` | `1`, `100` | диапазон PIN |
| `SEND_HEARTBEAT` | `true` | слать heartbeat перед отметками |
| `ICLOCK_BASE` | `${API_URL}/service/wtm` | база iclock |

### timesheet-hr — табель

Сценарий одного HR за итерацию:

1. Логин.
2. Список табелей за месяц, профиль, роли, дерево подразделений.
3. Если табеля по подразделению нет — создание (`POST /timesheets/`).
4. Открытие табеля: сетка месяца, alerts, revision, фильтр сотрудников, коды.
5. Правка ячеек сотрудник/день (`PUT /timesheets/{год}/{месяц}/changes/`), затем обновление: весь месяц или дельта (см. `AFTER_EDIT_MODE`).
6. История изменений табеля.

Отправка на согласование, согласование и возврат на доработку **не** выполняются: они блокируют табель для ручного тестирования.

```bash
./scripts/dev/run-dev-timesheet-hr-smoke.sh
./scripts/dev/run-dev-timesheet-hr-load.sh    # 5 → 10 HR, ~8 мин
SMOKE_VUS=3 ./scripts/stage/run-stage-timesheet-hr-smoke.sh
```

**Прогон «до/после» одной командой** (stage или dev):

```bash
./scripts/run-timesheet-compare.sh stage
```

Скрипт проверяет VPN, на smoke проверяет, что дельта отдаёт поле `employees` (то есть оптимизация бэка выкачена), гоняет load в режиме `month`, потом в режиме `delta` и печатает таблицу для Telegram. `ONLY=month` — только один режим, `SKIP_FIX_CHECK=true` — без проверки дельты. Таблицу по любым прогонам можно собрать отдельно: `python3 scripts/timesheet-report.py <папка_прогона> [<папка_прогона> …]`.

| Переменная | По умолчанию | Описание |
|---|---|---|
| `AFTER_EDIT_MODE` | `month` | `month` — после правки перечитать весь месяц (текущий фронт); `delta` — `GET …/changes/?since=<ревизия>` (новый фронт) |
| `TIMESHEET_DEPARTMENT_IDS` | dev: «Папич», stage: «Бухгалтерия» | ID подразделений через запятую; пусто — берутся табели «в работе», где есть сотрудники |
| `TIMESHEET_PERIOD` | текущий месяц | `YYYY-MM` |
| `EDITS_PER_ITERATION` | `2` | сколько ячеек правит HR за итерацию |
| `ALLOW_CREATE` | `true` | создавать табель, если его нет |
| `SMOKE_VUS` | `1` | пользователей в smoke |
| `TIMESHEET_USERS_FILE` | stage: `users/users-stage-timesheet.csv` | отдельный файл учёток для табеля |
| `FAIL_BACKOFF_SECONDS` | `10` | пауза после прерванной итерации |

Свои метрики: `timesheet_edits_done`, `timesheet_edit_conflicts` (409), `timesheet_failed_iterations`, `timesheet_grid_bytes`, `timesheet_delta_bytes`.

Результаты тестов табеля: [docs/timesheet-load-report-2026-11-16.md](docs/timesheet-load-report-2026-11-16.md).

## Результаты

Каждый запуск пишет в `results/<стенд>/<flow>/<режим>/<дата-время>/`:

| Файл | Что внутри |
|---|---|
| `summary.html` | HTML-отчёт: проверки, время ответа по каждому запросу, ошибки. Его и пересылают |
| `run.log` | полный вывод k6 с текстами ошибок |
| `summary.json`, `summary-export.json` | те же итоги в машинном виде |
| `metrics.csv.gz` | время каждого запроса (пока только у табеля), для разбивки по секундам |

В git хранится только эталонный прогон табеля, остальные результаты игнорируются.

## Как добавить новый сценарий

1. Записать HAR в Chrome DevTools на dev или stage (не на prod).
2. Сгенерировать k6-тест по [instruction/prompt-har-to-k6.md](instruction/prompt-har-to-k6.md) или написать вручную в `tests/<имя>-flow.js`, используя `login()` из `lib/auth.js` и `buildOptions()` из `lib/config.js`.
3. Скопировать пару скриптов `scripts/<стенд>/run-<стенд>-home-{smoke,load}.sh` и поменять `FLOW_NAME` и путь к тесту.
4. Прогнать smoke, потом load.

Подробности и шаблон — в [instruction/README.md](instruction/README.md).

## Правила

- Сначала smoke, потом load.
- **Load на prod — только после согласования** с ответственными: сначала smoke, потом небольшая контролируемая нагрузка.
- Сценарии `device` и `timesheet-hr` создают и меняют данные — только на dev и stage.
- Не коммитить учётки stage и prod, HAR-файлы (в них cookies и токены) и лишние результаты.
- Не запускать два load на один стенд одновременно: нагрузка сложится, цифры будут неверными.

## Известные особенности

- В режиме `LOGIN_FLOW_MODE=browser` заголовки `Origin` и `Referer` для отправки логина зашиты на `dev-sso.mylink.kz` (`lib/headers.js`, `loginSubmitHeaders`). На stage и prod надёжнее `LOGIN_FLOW_MODE=api`.
- При длительной нагрузке файрвол стенда может временно заблокировать IP, с которого идёт тест: стенд перестаёт отвечать по TCP. Скрипт сравнения табеля проверяет доступ до и после каждого прогона.
