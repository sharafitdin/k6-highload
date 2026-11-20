# k6 Highload — MyLink load tests

A set of [k6](https://k6.io) load tests for MyLink services: SSO login, the home page and individual APIs (including the **wtm** time-tracking service), attendance terminals (iclock), and the timesheet.

Each test replays a real user scenario: log in, then send the same requests the frontend sends. Tests are started with ready-made scripts per environment (dev / stage / prod) in two modes: **smoke** (check that the scenario works) and **load** (apply load). Every run is saved to its own folder with an HTML report.

## What is tested

| Scenario | File | What the user does | Main endpoints | Changes data |
|---|---|---|---|---|
| **login** | `tests/login-flow.js` | Logs in, nothing else | SSO (Ory Kratos): `GET /self-service/login/browser\|api`, `POST <flow action>` | no |
| **home** | `tests/home-flow.js` | Login → profile → home page requests. Can also load **any single URL** (single request mode) | `engine/api/v2/employees/profile/`; currently enabled: `POST wtm/api/v1/calendar/export/` | depends on the request |
| **device** | `tests/device-flow.js` | A ZKTeco (iclock) terminal sends a heartbeat and check-in / check-out punches | `wtm/iclock/getrequest`, `POST wtm/iclock/cdata?table=ATTLOG` | **yes** (punches) |
| **timesheet-hr** | `tests/timesheet-hr-flow.js` | An HR user opens a timesheet, creates it if missing, edits cells, views history | `wtm/api/v1/timesheets/…` (list, month grid, `changes/`, delta, history) | **yes** (timesheet) |

All API paths are relative to `API_URL` from `.env.<env>`, e.g. `https://dev-sso.mylink.kz/service/wtm/api/v1/...`. Requests are authorized with the Bearer token returned by login in `LOGIN_FLOW_MODE=api`, or with cookies in `browser` mode.

## Quick start

1. Install k6: `brew install k6` (macOS) or follow the [install guide](https://grafana.com/docs/k6/latest/set-up/install-k6/). The timesheet report also needs `python3`.
2. Connect to the VPN: dev and stage are reachable only through it.
3. Make the scripts executable:

   ```bash
   find scripts -type f -name "*.sh" -exec chmod +x {} \;
   ```

4. Put test accounts into `users/` (see "Accounts").
5. Run a smoke test, e.g. login on dev:

   ```bash
   ./scripts/dev/run-dev-login-smoke.sh
   ```

6. Open the report: `results/dev/login-flow/smoke/<date-time>/summary.html`.

Always run tests **through the scripts** in `scripts/`: they load `.env.<env>`, set the load parameters and create the results folder. A plain `k6 run tests/...` fails with `Missing required env variable: BASE_URL`.

## Project structure

```text
tests/        scenarios (one file per flow)
lib/          shared code: login, config and load profiles, headers, accounts, report
scripts/      run scripts: scripts/<env>/run-<env>-<flow>-<smoke|load>.sh
              + run-timesheet-compare.sh and timesheet-report.py for the timesheet
users/        CSV files with accounts (only dev and the example are in git)
results/      run results: results/<env>/<flow>/<mode>/<date-time>/
docs/         reports on completed tests
instruction/  detailed guide and the prompt for generating a new flow from a HAR file (in Russian)
.env.<env>    environment URLs and the path to the accounts file
```

`lib/` holds shared logic only. Business scenarios live in `tests/`.

| Module | Purpose |
|---|---|
| `lib/auth.js` | Login via Ory Kratos: `browser` (form + csrf, returns cookies) or `api` (returns `session_token`) |
| `lib/config.js` | Reads env, smoke/load profiles, default thresholds |
| `lib/headers.js` | Shared headers for accounts / team |
| `lib/users.js` | Reads the accounts CSV. Virtual user N takes row N, wrapping around |
| `lib/helpers.js` | `json()`, `checkBatch()`, `truncate()` and other small helpers |
| `lib/summary.js` | Writes `summary.html` and `summary.json` |

## Environments and accounts

| Environment | env file | Hosts | Accounts |
|---|---|---|---|
| dev | `.env.dev` | `dev-sso.mylink.kz`, `dev-team.mylink.kz` | `users/users-dev.csv` (in git) |
| stage | `.env.stage` | `stage-sso.mylink.kz`, `stage-team.mylink.kz` | `users/users-stage.csv`; for the timesheet — `users/users-stage-timesheet.csv` |
| prod | `.env.prod` | production | `users/users-prod.csv` |

`.env.*` files contain only URLs and the accounts path. Load parameters are set in the `.sh` scripts.

CSV format (see `users/users-example.csv`):

```csv
identifier,password
user@example.com,password
```

Stage and prod accounts are not stored in git (see `.gitignore`) and are shared separately. Accounts must not require 2FA: with a second factor, requests get 401/403. The timesheet scenario needs the `hr` (or `timekeeper`) role.

## Run modes

**smoke** — a short check that the scenario passes (by default 1 user, 1 iteration). Always run it before load.

**load** — stepped load (`ramping-vus`):

```text
0 → VUS_1 over RAMP_1 → VUS over RAMP_2 → hold VUS for HOLD → 0 over RAMP_DOWN
```

Default thresholds: errors < 5%, p95 response time < 2 s, and each scenario's own checks ≥ 95%. If a threshold fails, k6 prints `thresholds … have been crossed`. That means the service missed the target, not that the test is broken.

Common variables (set in the scripts or before the command):

| Variable | Default | Description |
|---|---|---|
| `TEST_MODE` | `smoke` | `smoke` or `load` |
| `VUS`, `ITERATIONS`, `MAX_DURATION` | `1`, `1`, `1m` | smoke |
| `VUS_1`, `VUS`, `RAMP_1`, `RAMP_2`, `HOLD`, `RAMP_DOWN` | `500`, `2000`, `5m`, `10m`, `10m`, `5m` | load; the scripts set their own, much smaller values |
| `LOGIN_FLOW_MODE` | `browser` | `browser` (cookies) or `api` (Bearer token) |
| `THINK_TIME_SECONDS` | `1` | pause between user actions |

## Scenarios

### login — authentication

Tests only SSO: creating a login flow and submitting the username and password. Use it to load the SSO itself.

```bash
./scripts/dev/run-dev-login-smoke.sh
./scripts/dev/run-dev-login-load.sh      # 10 → 50 users, ~7 min
```

Scripts exist for dev, stage and prod.

### home — home page and individual wtm URLs

Logs in, fetches the employee profile and sends a batch of home page requests. Only `POST /service/wtm/api/v1/calendar/export/` (calendar export) is currently enabled. The other requests (widgets, marks, calendar, documents) are commented out in the file and can be enabled as needed.

```bash
./scripts/dev/run-dev-home-smoke.sh
./scripts/dev/run-dev-home-load.sh
```

**Load any single URL** without changing code, via variables:

```bash
SINGLE_REQUEST_URL='{{API_URL}}/service/wtm/api/v1/calendar/today-marks/' \
SINGLE_REQUEST_NAME='GET today-marks' \
./scripts/dev/run-dev-home-load.sh
```

| Variable | Description |
|---|---|
| `SINGLE_REQUEST_URL` | Request URL. Placeholders: `{{API_URL}}`, `{{BASE_URL}}`, `{{employeeId}}` |
| `SINGLE_REQUEST_METHOD` | `GET` by default |
| `SINGLE_REQUEST_BODY` | request body, same placeholders |
| `SINGLE_REQUEST_CONTENT_TYPE` | `application/json` by default |
| `SINGLE_REQUEST_NAME` | request name in the report |
| `SKIP_PROFILE` | `true` — skip the profile request (then `{{employeeId}}` is empty) |

### device — attendance terminals (iclock)

Simulates a ZKTeco terminal: heartbeat (`GET /service/wtm/iclock/getrequest`), check-in and check-out punches (`POST /service/wtm/iclock/cdata?table=ATTLOG`, the response must be `OK`). Works only with `LOGIN_FLOW_MODE=api`. **Creates punches** for employees with the given PINs.

There are no run scripts for it yet; run it manually:

```bash
set -a; source .env.dev; set +a
RESULTS_DIR="results/dev/device-flow/smoke/$(date +%F_%H-%M-%S)"; mkdir -p "$RESULTS_DIR"
TEST_MODE=smoke LOGIN_FLOW_MODE=api RESULTS_DIR="$RESULTS_DIR" k6 run tests/device-flow.js
```

| Variable | Default | Description |
|---|---|---|
| `DEVICE_SERIALS` | `WJA6244800003,HDP1254500162` | terminal serial numbers, assigned to users round-robin |
| `DEVICE_PINS` | empty | employee PINs, comma-separated; empty — `PIN_START … PIN_START+PINS_PER_DEVICE-1` |
| `PIN_START`, `PINS_PER_DEVICE` | `1`, `100` | PIN range |
| `SEND_HEARTBEAT` | `true` | send a heartbeat before the punches |
| `ICLOCK_BASE` | `${API_URL}/service/wtm` | iclock base URL |

### timesheet-hr — timesheet

One HR user per iteration:

1. Log in.
2. Timesheet list for the month, profile, roles, department tree.
3. If the department has no timesheet — create one (`POST /timesheets/`).
4. Open the timesheet: month grid, alerts, revision, employee filter, codes.
5. Edit employee/day cells (`PUT /timesheets/{year}/{month}/changes/`), then refresh: the whole month or a delta (see `AFTER_EDIT_MODE`).
6. Timesheet change history.

Submitting for approval, approving and returning for rework are **not** performed: they lock the timesheet for manual testing.

```bash
./scripts/dev/run-dev-timesheet-hr-smoke.sh
./scripts/dev/run-dev-timesheet-hr-load.sh    # 5 → 10 HR users, ~8 min
SMOKE_VUS=3 ./scripts/stage/run-stage-timesheet-hr-smoke.sh
```

**Before/after run in one command** (stage or dev):

```bash
./scripts/run-timesheet-compare.sh stage
```

The script checks VPN access, runs a smoke test to confirm that the delta endpoint returns the `employees` field (i.e. the backend optimization is deployed), runs load in `month` mode, then in `delta` mode, and prints a table ready to paste into Telegram. `ONLY=month` runs a single mode, `SKIP_FIX_CHECK=true` skips the delta check. You can build the table for any runs separately: `python3 scripts/timesheet-report.py <run_dir> [<run_dir> …]`.

| Variable | Default | Description |
|---|---|---|
| `AFTER_EDIT_MODE` | `month` | `month` — re-read the whole month after an edit (current frontend); `delta` — `GET …/changes/?since=<revision>` (new frontend) |
| `TIMESHEET_DEPARTMENT_IDS` | dev: "Папич", stage: "Бухгалтерия" | department IDs, comma-separated; empty — in-progress timesheets that have employees |
| `TIMESHEET_PERIOD` | current month | `YYYY-MM` |
| `EDITS_PER_ITERATION` | `2` | cells an HR user edits per iteration |
| `ALLOW_CREATE` | `true` | create the timesheet if it does not exist |
| `SMOKE_VUS` | `1` | users in smoke |
| `TIMESHEET_USERS_FILE` | stage: `users/users-stage-timesheet.csv` | separate accounts file for the timesheet |
| `FAIL_BACKOFF_SECONDS` | `10` | pause after an interrupted iteration |

Custom metrics: `timesheet_edits_done`, `timesheet_edit_conflicts` (409), `timesheet_failed_iterations`, `timesheet_grid_bytes`, `timesheet_delta_bytes`.

Timesheet test results: [docs/timesheet-load-report-2026-11-16.md](docs/timesheet-load-report-2026-11-16.md) (in Russian).

## Results

Each run writes to `results/<env>/<flow>/<mode>/<date-time>/`:

| File | Contents |
|---|---|
| `summary.html` | HTML report: checks, response time per request, errors. This is the file to share |
| `run.log` | full k6 output with error messages |
| `summary.json`, `summary-export.json` | the same totals, machine-readable |
| `metrics.csv.gz` | timing of every request (timesheet only for now), for per-second breakdowns |

Only the reference timesheet run is kept in git; other results are ignored.

## Adding a new scenario

1. Record a HAR in Chrome DevTools on dev or stage (never on prod).
2. Generate a k6 test with [instruction/prompt-har-to-k6.md](instruction/prompt-har-to-k6.md) or write it by hand in `tests/<name>-flow.js`, using `login()` from `lib/auth.js` and `buildOptions()` from `lib/config.js`.
3. Copy a pair of scripts `scripts/<env>/run-<env>-home-{smoke,load}.sh` and change `FLOW_NAME` and the test path.
4. Run smoke, then load.

Details and a template: [instruction/README.md](instruction/README.md) (in Russian).

## Rules

- Smoke first, then load.
- **Load on prod only after approval** from the people responsible: smoke first, then a small controlled load.
- The `device` and `timesheet-hr` scenarios create and change data — dev and stage only.
- Do not commit stage/prod accounts, HAR files (they contain cookies and tokens) or extra results.
- Do not run two load tests against the same environment at once: the load adds up and the numbers are wrong.

## Known caveats

- In `LOGIN_FLOW_MODE=browser`, the `Origin` and `Referer` headers for the login submit are hardcoded to `dev-sso.mylink.kz` (`lib/headers.js`, `loginSubmitHeaders`). On stage and prod, `LOGIN_FLOW_MODE=api` is more reliable.
- Under sustained load, the environment's firewall may temporarily block the IP the test runs from: the environment stops accepting TCP connections. The timesheet compare script checks access before and after each run.
