# ATTENTION (read first)
"Record HAR files only on dev/stage; after generating a test, run smoke first; run load on prod only after approval." This matters because a HAR file can easily capture real cookies/tokens, and a load test can accidentally create real load or real business data.


# k6 Highload Project

The project is used for load testing user flows with k6.

Scenarios currently implemented:

```text
tests/login-flow.js          — tests login only
tests/home-flow.js           — tests login + loading the home page
tests/device-flow.js         — sends punches from terminals (iclock)
tests/timesheet-hr-flow.js   — timesheet: HR opens, creates and edits a timesheet (changes data!)
```

New flows, e.g. documents, vacations, profile or approvals, are added as separate files in the `tests/` folder.

---

## What each folder is for

### `lib/`

Shared logic reused by all tests.

```text
auth.js      — shared login/auth flow
config.js    — reads env and sets up smoke/load options
headers.js   — shared headers for the accounts/team APIs
helpers.js   — json(), checkBatch(), truncate(), encode() and other helpers
summary.js   — saves summary.html / summary.json
users.js     — reads users from CSV
```

Important: do not put business scenarios here.

---

### `tests/`

k6 flow tests live here.

```text
login-flow.js   — login-only test
home-flow.js    — login + home page
```

If you need a new scenario, create a new file:

```text
tests/document-flow.js
tests/vacation-flow.js
tests/approval-flow.js
```

---

### `users/`

CSV files with test users.

Format:

```csv
identifier,password
user@example.com,password
```

Required columns:

```text
identifier
password
```

Do not commit real logins and passwords.

---

### `scripts/`

Shell scripts for running tests.

Scripts are split by environment:

```text
scripts/dev/
scripts/stage/
scripts/prod/
```

Load parameters live in the `.sh` files, not in `.env`.

---

### `results/`

Run results are saved here.

Structure:

```text
results/{env}/{flow}/{mode}/{timestamp}/
```

Example:

```text
results/dev/home-flow/smoke/2026-06-08_15-45-30/
  run.log
  summary.html
  summary.json
  summary-export.json
```

---

## Env files

The project has:

```text
.env.dev
.env.stage
.env.prod
```

They must contain only URLs and the path to the users file:

```env
BASE_URL=
API_URL=
ACCOUNTS_ORIGIN=
TEAM_ORIGIN=
USERS_FILE=users/users-dev.csv
```

Do not keep load parameters in `.env.*`:

```text
VUS
ITERATIONS
VUS_1
RAMP_1
RAMP_2
HOLD
RAMP_DOWN
TEST_MODE
```

They belong in `scripts/**/*.sh`.

---

## How to run

Before the first run, make the scripts executable:

```bash
find scripts -type f -name "*.sh" -exec chmod +x {} \;
```

Run tests through the shell scripts, not directly with `k6 run`.

Correct:

```bash
./scripts/dev/run-dev-home-smoke.sh 
```

Wrong:

```bash
k6 run tests/home-flow.js
```

When run directly, `.env.dev` is not loaded automatically, so k6 may fail with `Missing required env variable: BASE_URL`.

---

## Dev

```bash
./scripts/dev/run-dev-login-smoke.sh
./scripts/dev/run-dev-login-load.sh
./scripts/dev/run-dev-home-smoke.sh
./scripts/dev/run-dev-home-load.sh
```

---

## Stage

```bash
./scripts/stage/run-stage-login-smoke.sh
./scripts/stage/run-stage-login-load.sh
./scripts/stage/run-stage-home-smoke.sh
./scripts/stage/run-stage-home-load.sh
```

---

## Prod

```bash
./scripts/prod/run-prod-login-smoke.sh
./scripts/prod/run-prod-login-load.sh
./scripts/prod/run-prod-home-smoke.sh
./scripts/prod/run-prod-home-load.sh
```

Important: run load on prod only after approval from the people responsible.

---

## Smoke and Load

### Smoke

A short check that the test works at all.

Usually:

```text
VUS=1
ITERATIONS=1
MAX_DURATION=1m
```

Smoke is always run before load.

### Load

A full load run.

Usually uses:

```text
ramping-vus
RAMP_1
RAMP_2
HOLD
RAMP_DOWN
```

---

## How to add a new flow

For example, you need a flow for documents.

Create a file:

```text
tests/document-flow.js
```

Use the shared modules inside it:

```js
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import exec from 'k6/execution';

import {
  API_URL,
  THINK_TIME_SECONDS,
  buildOptions,
} from '../lib/config.js';

import { getUserByVuId } from '../lib/users.js';
import { login } from '../lib/auth.js';
import { teamHeaders } from '../lib/headers.js';
import { createSummary } from '../lib/summary.js';
```

If the flow requires authorization:

```js
const user = getUserByVuId(exec.vu.idInTest);

group('01_login', () => {
  login(user);
});
```

Do not copy login code into the new flow. Login is already implemented in:

```text
lib/auth.js
```

---

## Minimal template for a new flow

```js
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import exec from 'k6/execution';

import {
  API_URL,
  THINK_TIME_SECONDS,
  buildOptions,
} from '../lib/config.js';

import { getUserByVuId } from '../lib/users.js';
import { login } from '../lib/auth.js';
import { teamHeaders } from '../lib/headers.js';
import { createSummary } from '../lib/summary.js';

export const options = buildOptions('new_flow', {
  'checks{type:login}': ['rate>0.95'],
  'checks{type:new_flow}': ['rate>0.95'],
});

export default function () {
  const user = getUserByVuId(exec.vu.idInTest);

  group('01_login', () => {
    login(user);
  });

  group('02_new_flow', () => {
    const res = http.get(`${API_URL}/some/api/path/`, {
      headers: teamHeaders().headers,
      tags: {
        name: 'GET some api path',
        type: 'new_flow',
      },
    });

    check(
      res,
      {
        'status is 200': (r) => r.status === 200,
      },
      { type: 'new_flow' },
    );
  });

  sleep(THINK_TIME_SECONDS);
}

export const handleSummary = createSummary();
```

---

## Maintenance rules

1. Add new business scenarios to `tests/`.
2. Add shared logic to `lib/`.
3. Do not write URLs directly in JS code.
4. Keep URLs and the users file in `.env.*`.
5. Keep load parameters in `scripts/**/*.sh`.
6. Save results to `results/`.
7. Always run smoke before load.
8. Do not commit real users CSV files or results.

---

## Recommended `.gitignore`

```gitignore
results/

.env.local
.env.*.local

users/users-dev.csv
users/users-stage.csv
users/users-prod.csv

!users/users-example.csv
```

---

## The main rule

```text
lib/      — shared logic
tests/    — specific flow tests
scripts/  — running tests
users/    — test users
results/  — run results
.env.*    — environment settings
```
