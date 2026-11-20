# Prompt: generating a k6 flow test from a HAR file

Use this file to record user flows with Chrome DevTools, save a HAR file and get a k6 test for the current project structure based on it.

---

## 1. What the tester sends along with the HAR

Give ChatGPT the HAR file and fill in a short description:

```text
Flow name:
For example: document-flow / vacation-flow / approval-flow

Environment where the HAR was recorded:
dev / stage

What the user did:
Short steps: opened a page, clicked a button, filled in a form, submitted a request, etc.

Is login required:
yes / no

May the flow create or change data:
yes / no / don't know

What counts as a successful result:
For example: the document list loaded, the request was created, the status changed

Endpoints that definitely matter, if known:

Endpoints to definitely exclude, if known:

What must not be included in the test:
For example: creating a real request, deleting data, sending notifications
```

Important: do not record a HAR on prod and do not run a load test on prod without approval.

---

## 2. How to prepare the HAR

1. Open Chrome DevTools.
2. Go to the **Network** tab.
3. Enable:

   * **Preserve log**
   * **Disable cache**
4. Clear Network before starting the scenario.
5. Go through the flow from the very beginning:

   * open the required page;
   * log in if the flow requires authorization;
   * perform the business scenario;
   * wait until all API requests finish.
6. Do not do anything extra in the browser.
7. Save the HAR:

   * right-click in Network;
   * **Save all as HAR with content**.
8. Give the HAR file to ChatGPT together with this prompt.
9. Do not record a HAR on production without separate permission.
10. After generation, make sure the code does not contain:

* real passwords;
* access/refresh tokens;
* session cookies;
* csrf tokens;
* production credentials;
* personal data.

---

# Main prompt for ChatGPT

You are a senior QA automation engineer / performance engineer.

Your task is to analyze the attached HAR file, recorded in Chrome DevTools while going through a user flow, and use it to prepare a correct k6 load test for the current project structure.

---

## Project context

The project uses k6.

Current project structure:

```text
k6_highload/
  instruction/
    README.md
    prompt-har-to-k6.md

  lib/
    auth.js
    config.js
    headers.js
    helpers.js
    summary.js
    users.js

  tests/
    login-flow.js
    home-flow.js

  users/
    users-dev.csv
    users-stage.csv
    users-prod.csv

  scripts/
    dev/
      run-dev-login-smoke.sh
      run-dev-login-load.sh
      run-dev-home-smoke.sh
      run-dev-home-load.sh

    stage/
      run-stage-login-smoke.sh
      run-stage-login-load.sh
      run-stage-home-smoke.sh
      run-stage-home-load.sh

    prod/
      run-prod-login-smoke.sh
      run-prod-login-load.sh
      run-prod-home-smoke.sh
      run-prod-home-load.sh

  results/
    dev/
    stage/
    prod/

  .env.dev
  .env.stage
  .env.prod
```

The project already has:

```text
tests/login-flow.js
tests/home-flow.js
```

New business flows must be added as separate files in:

```text
tests/
```

For example:

```text
tests/document-flow.js
tests/vacation-flow.js
tests/profile-flow.js
tests/approval-flow.js
```

---

## Key project architecture

Do not write the whole k6 test from scratch when shared modules already exist.

Use the existing shared logic from `lib/`:

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
import { teamHeaders, accountHeaders } from '../lib/headers.js';
import { checkBatch, json, truncate, encode } from '../lib/helpers.js';
import { createSummary } from '../lib/summary.js';
```

If the flow requires authorization, start the scenario with:

```js
const user = getUserByVuId(exec.vu.idInTest);

group('01_login', () => {
  login(user);
});
```

Do not re-implement login and do not copy auth code into the new flow.

---

## What to do with the HAR

Analyze the HAR file and identify the real business flow.

Do not blindly copy every request from the HAR.

Exclude from the k6 test:

* static files: `.js`, `.css`, images, fonts, svg, ico, map;
* analytics/tracking requests;
* requests to third-party domains unless they are part of the business flow;
* preflight `OPTIONS`;
* websocket/polling requests unless they are critical for the scenario;
* duplicate requests unless they are needed for realistic load;
* browser-only requests that do not affect the business scenario.

Keep only the API requests that actually take part in the flow.

---

## Security

Never hardcode:

* real logins;
* real passwords;
* Bearer tokens;
* cookies;
* csrf tokens;
* session ids;
* production credentials;
* personal data.

If the HAR contains dynamic values:

```text
Authorization
Cookie
csrf_token
session
flow id
employee id
document id
request id
```

you must:

1. determine where the value comes from;
2. extract it from the previous response body/header/cookie;
3. reuse it later in the test;
4. if the source of the value is unclear — add a `TODO` and explain what needs to be clarified.

Do not make up values that are not in the HAR or the project.

---

## k6 script requirements

The new flow must be a separate file:

```text
tests/{flow-name}-flow.js
```

Create options with:

```js
export const options = buildOptions('flow_name', {
  'checks{type:login}': ['rate>0.95'],
  'checks{type:flow_name}': ['rate>0.95'],
});
```

Always add at the end of the file:

```js
export const handleSummary = createSummary();
```

Add a `check()` for every important request:

* status code;
* required fields present in the response body;
* no business error, if one can be detected;
* an id is present if the next request depends on it.

For batch requests you can use:

```js
checkBatch(responses, 'group_name', 'flow_type');
```

---

## Env requirements

`.env.dev`, `.env.stage`, `.env.prod` must contain only URLs and the path to the users file:

```env
BASE_URL=
API_URL=
ACCOUNTS_ORIGIN=
TEAM_ORIGIN=
USERS_FILE=users/users-dev.csv
```

Do not add load parameters to `.env.*`:

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

Load parameters belong only in the shell scripts.

---

## Shell script requirements

When creating a new flow, propose shell scripts for at least dev and stage:

```text
scripts/dev/run-dev-{flow}-smoke.sh
scripts/dev/run-dev-{flow}-load.sh
scripts/stage/run-stage-{flow}-smoke.sh
scripts/stage/run-stage-{flow}-load.sh
```

Add prod scripts only as a template and always with a warning:

```text
A load test on prod must not be run without approval from the people responsible.
Smoke on dev/stage must pass first.
```

Each run must save results to its own folder:

```text
results/{env}/{flow}/{mode}/{timestamp}/
```

It must contain:

```text
run.log
summary.html
summary.json
summary-export.json
```

---

## Important: production

Do not suggest running a load test on prod right away.

For prod, always include a warning:

```text
Before running on prod, get permission from the person responsible and agree on the load parameters.
Smoke first, then a small controlled load, and only after that the full load.
```

By default, use dev or stage to verify a new flow.

---

## If information is missing

If it is unclear from the HAR what the business scenario is, do not generate a test blindly.

First ask the user:

1. What is the flow called?
2. What did the user do in the browser?
3. What counts as a successful result?
4. May this flow create or change data?
5. Should only data reads be tested, or POST/PATCH/DELETE too?
6. Which environment will it run on: dev or stage?
7. Are there any load limits?

If there is enough information, prepare the k6 test right away.

---

## What to return in the answer

Return the result in this format:

### 1. Short flow description

Describe the user scenario found in the HAR.

### 2. What is included in the test

The list of API endpoints to keep in the k6 test.

For each endpoint, give:

```text
METHOD URL/PATH — why it is needed
```

### 3. What is excluded from the HAR

The list of excluded request types and the reason.

For example:

```text
/static/*.js — frontend static
*.css — styles
*.png/*.svg — images
OPTIONS — preflight
analytics — not part of the business flow
```

### 4. Dynamic data

Identify the dynamic values:

```text
csrf_token
flow id
employee id
document id
request id
tokens
cookies
```

For each, state:

```text
where it comes from
where it is used
how to extract it in k6
```

If unclear — add a `TODO`.

### 5. Proposed file name

For example:

```text
tests/document-flow.js
```

### 6. Full code of the k6 flow file

Give the full code of the new file.

The code must use the existing modules from `lib/`.

### 7. Env changes

If new env variables are needed, state explicitly:

```text
.env.dev
.env.stage
.env.prod
```

If no changes are needed, write:

```text
No changes to .env.* are required.
```

### 8. Users CSV changes

If extra fields are needed in the CSV, list them.

For example:

```csv
identifier,password,employee_id
```

If no changes are needed, write:

```text
No changes to the users CSV are required.
```

### 9. Shell scripts

If a new flow is needed, propose smoke/load scripts for dev and stage.

Add prod scripts only as a template and always with a warning.

### 10. How to run smoke

For example:

```bash
./scripts/stage/run-stage-document-smoke.sh
```

### 11. How to run load

For example:

```bash
./scripts/stage/run-stage-document-load.sh
```

Before load, always write:

```text
Smoke must pass successfully first.
```

### 12. TODO / questions

If the HAR does not give complete information, do not make things up.

Add a list of questions:

```text
TODO:
1. Clarify where to get document_id.
2. Clarify whether real requests may be created on stage.
3. Clarify the expected status for the POST request.
```

---

## Additional quality rules

1. `group()` names must reflect the real user steps.
2. Tags must be clear:

```js
tags: {
  name: 'GET documents list',
  type: 'document',
}
```

3. Do not add extra sleeps after every request. Sleep belongs between user actions.
4. Do not add frontend static files to the load test.
5. Do not create a test that changes data if it is unclear whether that is allowed.
6. For POST/PATCH/DELETE requests, always add a warning that the scenario changes data.
7. If the flow creates entities, suggest cleanup or separate test data where possible.
8. If an endpoint depends on an id from a previous response, that id must be extracted dynamically.
9. If an endpoint returns an error in the HAR, do not treat it as successful without explanation.
10. When in doubt — add a `TODO` rather than make things up.

---

## Self-check before the final answer

Before giving the final answer, check:

```text
1. The new flow is in tests/
2. Shared logic is imported from lib/
3. login is used from lib/auth.js
4. No extra static/assets/analytics/OPTIONS were copied
5. No hardcoded tokens/cookies/passwords
6. Dynamic ids are extracted from responses
7. Important requests have checks
8. Tags have a clear type
9. There are smoke/load shell scripts
10. Results are saved to a timestamp folder
11. There are run instructions
12. There is a TODO if the HAR lacks information
```

---

## Now analyze the attached HAR file and prepare a k6 flow test for this project.
