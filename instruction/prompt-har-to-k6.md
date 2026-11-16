# Prompt: генерация k6 flow-теста из HAR

Этот файл нужен, для записи пользовательских flow через Chrome DevTools, сохранить HAR-файл и на его основе получить k6-тест под текущую структуру проекта.

---

## 1. Что тестировщик должен отправить вместе с HAR

Передай ChatGPT HAR-файл и заполни короткое описание:

```text
Название flow:
Например: document-flow / vacation-flow / approval-flow

Окружение, где записан HAR:
dev / stage

Что делал пользователь:
Кратко по шагам: открыл страницу, нажал кнопку, заполнил форму, отправил заявку и т.д.

Нужен ли логин:
да / нет

Можно ли flow создавать или изменять данные:
да / нет / не знаю

Что считается успешным результатом:
Например: список документов загрузился, заявка создалась, статус изменился

Какие endpoints точно важны, если известно:

Какие endpoints точно исключить, если известно:

Что нельзя включать в тест:
Например: создание реальной заявки, удаление данных, отправка уведомлений
```

Важно: не записывай HAR на prod и не запускай load test на prod без согласования.

---

## 2. Как подготовить HAR

1. Открой Chrome DevTools.
2. Перейди во вкладку **Network**.
3. Включи:

   * **Preserve log**
   * **Disable cache**
4. Очисти Network перед началом сценария.
5. Выполни flow с самого начала:

   * открой нужную страницу;
   * залогинься, если flow требует авторизацию;
   * выполни бизнес-сценарий;
   * дождись завершения всех API-запросов.
6. Не делай лишних действий в браузере.
7. Сохрани HAR:

   * Right click в Network;
   * **Save all as HAR with content**.
8. Передай HAR-файл в ChatGPT вместе с этим промтом.
9. Не записывай HAR с production, если нет отдельного разрешения.
10. После генерации обязательно проверь, что в код не попали:

* реальные пароли;
* access/refresh tokens;
* session cookies;
* csrf tokens;
* production credentials;
* персональные данные.

---

# Основной промт для ChatGPT

Ты — senior QA automation engineer / performance engineer.

Твоя задача — проанализировать приложенный HAR-файл, записанный из Chrome DevTools во время прохождения пользовательского flow, и на его основе подготовить корректный k6 нагрузочный тест под текущую структуру проекта.

---

## Контекст проекта

Проект использует k6.

Актуальная структура проекта:

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

Сейчас в проекте уже есть:

```text
tests/login-flow.js
tests/home-flow.js
```

Новые бизнес-flow нужно добавлять отдельными файлами в папку:

```text
tests/
```

Например:

```text
tests/document-flow.js
tests/vacation-flow.js
tests/profile-flow.js
tests/approval-flow.js
```

---

## Важная архитектура проекта

Не пиши весь k6-тест с нуля, если уже есть общие модули.

Используй существующую общую логику из `lib/`:

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

Если flow требует авторизацию, в начале сценария используй:

```js
const user = getUserByVuId(exec.vu.idInTest);

group('01_login', () => {
  login(user);
});
```

Не реализуй login заново и не копируй auth-код в новый flow.

---

## Что нужно сделать с HAR

Проанализируй HAR-файл и определи реальный бизнес-flow.

Не копируй слепо все запросы из HAR.

Исключи из k6-теста:

* static files: `.js`, `.css`, images, fonts, svg, ico, map;
* analytics/tracking requests;
* requests к сторонним доменам, если они не часть бизнес-flow;
* preflight `OPTIONS`;
* websocket/polling requests, если они не критичны для сценария;
* duplicate requests, если они не нужны для реальной нагрузки;
* browser-only requests, которые не влияют на бизнес-сценарий.

Оставь только API-запросы, которые реально участвуют в flow.

---

## Безопасность

Нельзя хардкодить:

* реальные логины;
* реальные пароли;
* Bearer tokens;
* cookies;
* csrf tokens;
* session ids;
* production credentials;
* персональные данные.

Если в HAR есть динамические значения:

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

нужно:

1. определить, откуда значение получается;
2. извлечь его из предыдущего response body/header/cookie;
3. переиспользовать дальше в тесте;
4. если источник значения непонятен — добавить `TODO` и объяснить, что нужно уточнить.

Не выдумывай значения, которых нет в HAR или проекте.

---

## Требования к k6 script

Новый flow должен быть отдельным файлом:

```text
tests/{flow-name}-flow.js
```

Options нужно создавать через:

```js
export const options = buildOptions('flow_name', {
  'checks{type:login}': ['rate>0.95'],
  'checks{type:flow_name}': ['rate>0.95'],
});
```

В конце файла обязательно добавь:

```js
export const handleSummary = createSummary();
```

Для каждого важного запроса добавь `check()`:

* status code;
* наличие обязательных полей в response body;
* отсутствие бизнес-ошибки, если её можно определить;
* наличие id, если следующий запрос зависит от этого id.

Для batch-запросов можно использовать:

```js
checkBatch(responses, 'group_name', 'flow_type');
```

---

## Требования к env

В `.env.dev`, `.env.stage`, `.env.prod` должны быть только URL и путь к users-файлу:

```env
BASE_URL=
API_URL=
ACCOUNTS_ORIGIN=
TEAM_ORIGIN=
USERS_FILE=users/users-dev.csv
```

Не добавляй в `.env.*` параметры нагрузки:

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

Параметры нагрузки должны быть только в shell-скриптах.

---

## Требования к shell scripts

Если создаёшь новый flow, предложи shell-скрипты минимум для dev и stage:

```text
scripts/dev/run-dev-{flow}-smoke.sh
scripts/dev/run-dev-{flow}-load.sh
scripts/stage/run-stage-{flow}-smoke.sh
scripts/stage/run-stage-{flow}-load.sh
```

Prod scripts добавляй только как шаблон и обязательно с предупреждением:

```text
Load test на prod нельзя запускать без согласования с ответственными.
Сначала должен пройти smoke на dev/stage.
```

Каждый запуск должен сохранять результаты в отдельную папку:

```text
results/{env}/{flow}/{mode}/{timestamp}/
```

Внутри должны быть:

```text
run.log
summary.html
summary.json
summary-export.json
```

---

## Важно про production

Не предлагай сразу запускать load test на prod.

Для prod обязательно напиши предупреждение:

```text
Перед запуском на prod нужно получить разрешение ответственного лица и согласовать параметры нагрузки.
Сначала smoke, потом небольшой controlled load, только после этого полноценная нагрузка.
```

По умолчанию для проверки нового flow используй dev или stage.

---

## Если данных не хватает

Если из HAR непонятно, что именно является бизнес-сценарием, не генерируй тест вслепую.

Сначала уточни у пользователя:

1. Как называется flow?
2. Что пользователь делал в браузере?
3. Какой результат считается успешным?
4. Можно ли этому flow создавать или изменять данные?
5. Нужно ли тестировать только чтение данных или также POST/PATCH/DELETE?
6. На каком окружении планируется запуск: dev или stage?
7. Есть ли ограничения по нагрузке?

Если информации достаточно, сразу подготовь k6-тест.

---

## Что нужно вернуть в ответе

Верни результат в таком формате:

### 1. Краткое описание flow

Опиши, какой пользовательский сценарий найден в HAR.

### 2. Что вошло в тест

Список API endpoints, которые нужно оставить в k6-тесте.

Для каждого endpoint укажи:

```text
METHOD URL/PATH — зачем нужен
```

### 3. Что исключено из HAR

Список исключённых типов запросов и причину.

Например:

```text
/static/*.js — frontend static
*.css — стили
*.png/*.svg — изображения
OPTIONS — preflight
analytics — не часть бизнес-flow
```

### 4. Динамические данные

Определи динамические значения:

```text
csrf_token
flow id
employee id
document id
request id
tokens
cookies
```

Для каждого укажи:

```text
откуда берётся
где используется
как извлечь в k6
```

Если непонятно — добавь `TODO`.

### 5. Предлагаемое имя файла

Например:

```text
tests/document-flow.js
```

### 6. Полный код k6 flow-файла

Дай полный код нового файла.

Код должен использовать существующие модули из `lib/`.

### 7. Изменения в env

Если нужно добавить новые env-переменные, явно укажи:

```text
.env.dev
.env.stage
.env.prod
```

Если изменений не нужно, напиши:

```text
Изменения в .env.* не требуются.
```

### 8. Изменения в users CSV

Если нужны дополнительные поля в CSV, укажи их.

Например:

```csv
identifier,password,employee_id
```

Если изменений не нужно, напиши:

```text
Изменения в users CSV не требуются.
```

### 9. Shell scripts

Если нужен новый flow, предложи smoke/load scripts для dev и stage.

Prod scripts добавь только как шаблон и обязательно с предупреждением.

### 10. Как запустить smoke

Например:

```bash
./scripts/stage/run-stage-document-smoke.sh
```

### 11. Как запустить load

Например:

```bash
./scripts/stage/run-stage-document-load.sh
```

Перед load обязательно напиши:

```text
Сначала должен успешно пройти smoke.
```

### 12. TODO / вопросы

Если HAR не даёт полной информации, не выдумывай.

Добавь список вопросов:

```text
TODO:
1. Уточнить, откуда брать document_id.
2. Уточнить, можно ли создавать реальные заявки в stage.
3. Уточнить expected status для POST запроса.
```

---

## Дополнительные правила качества

1. Названия `group()` должны отражать реальные шаги пользователя.
2. Tags должны быть понятными:

```js
tags: {
  name: 'GET documents list',
  type: 'document',
}
```

3. Не добавляй лишние sleep после каждого запроса. Sleep нужен между пользовательскими действиями.
4. Не добавляй frontend static в нагрузочный тест.
5. Не создавай тест, который меняет данные, если непонятно, можно ли это делать.
6. Для POST/PATCH/DELETE запросов обязательно напиши предупреждение, что сценарий изменяет данные.
7. Если flow создаёт сущности, по возможности предложи cleanup или отдельные тестовые данные.
8. Если endpoint зависит от id из предыдущего ответа, этот id нужно извлекать динамически.
9. Если endpoint возвращает ошибку в HAR, не считай его успешным без объяснения.
10. Если есть сомнения — лучше добавить `TODO`, чем выдумывать.

---

## Self-check перед финальным ответом

Перед тем как дать финальный ответ, проверь:

```text
1. Новый flow лежит в tests/
2. Общая логика импортируется из lib/
3. login используется из lib/auth.js
4. Не скопированы лишние static/assets/analytics/OPTIONS
5. Нет захардкоженных tokens/cookies/passwords
6. Динамические ids извлекаются из response
7. Есть checks для важных запросов
8. Есть tags с понятным type
9. Есть smoke/load shell scripts
10. Results сохраняются в timestamp-папку
11. Есть инструкция запуска
12. Есть TODO, если данных из HAR не хватает
```

---

## Теперь проанализируй приложенный HAR-файл и подготовь k6 flow-тест под этот проект.
