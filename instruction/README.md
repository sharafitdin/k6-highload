# ATTENTION (read first)
“Записывайте HAR только на dev/stage; после генерации сначала запускайте smoke; load на prod только после согласования”. Это важно, потому что HAR легко записать с настоящими cookies/tokens, а load-тест может случайно создать реальную нагрузку или реальные бизнес-данные.


# k6 Highload Project

Проект используется для нагрузочного тестирования пользовательских flow через k6.

Сейчас в проекте реализованы сценарии:

```text
tests/login-flow.js          — проверяет только авторизацию
tests/home-flow.js           — проверяет логин + загрузку главной страницы
tests/device-flow.js         — отправка отметок с терминалов (iclock)
tests/timesheet-hr-flow.js   — табель: HR открывает, создаёт и редактирует табель (изменяет данные!)
```

Новые flow, например документы, отпуска, профиль или согласования, добавляются отдельными файлами в папку `tests/`.

---

## За что отвечает каждая папка

### `lib/`

Общая логика, которую переиспользуют все тесты.

```text
auth.js      — общий login/auth flow
config.js    — чтение env и настройка smoke/load options
headers.js   — общие headers для accounts/team API
helpers.js   — json(), checkBatch(), truncate(), encode() и другие helpers
summary.js   — сохранение summary.html / summary.json
users.js     — чтение пользователей из CSV
```

Важно: бизнес-сценарии сюда не добавляем.

---

### `tests/`

Здесь лежат k6 flow-тесты.

```text
login-flow.js   — тест только на логин
home-flow.js    — логин + главная страница
```

Если нужен новый сценарий, создаём новый файл:

```text
tests/document-flow.js
tests/vacation-flow.js
tests/approval-flow.js
```

---

### `users/`

CSV-файлы с тестовыми пользователями.

Формат:

```csv
identifier,password
user@example.com,password
```

Обязательные колонки:

```text
identifier
password
```

Не коммитить реальные логины и пароли.

---

### `scripts/`

Shell-скрипты для запуска тестов.

Скрипты разделены по окружениям:

```text
scripts/dev/
scripts/stage/
scripts/prod/
```

Параметры нагрузки находятся именно в `.sh` файлах, а не в `.env`.

---

### `results/`

Сюда сохраняются результаты запусков.

Структура:

```text
results/{env}/{flow}/{mode}/{timestamp}/
```

Пример:

```text
results/dev/home-flow/smoke/2026-06-08_15-45-30/
  run.log
  summary.html
  summary.json
  summary-export.json
```

---

## Env-файлы

В проекте есть:

```text
.env.dev
.env.stage
.env.prod
```

В них должны быть только URL и путь к users-файлу:

```env
BASE_URL=
API_URL=
ACCOUNTS_ORIGIN=
TEAM_ORIGIN=
USERS_FILE=users/users-dev.csv
```

Не нужно хранить в `.env.*` параметры нагрузки:

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

Они должны быть в `scripts/**/*.sh`.

---

## Как запускать

Перед первым запуском выдать права:

```bash
find scripts -type f -name "*.sh" -exec chmod +x {} \;
```

Запускать тесты нужно через shell-скрипты, а не напрямую через `k6 run`.

Правильно:

```bash
./scripts/dev/run-dev-home-smoke.sh 
```

Неправильно:

```bash
k6 run tests/home-flow.js
```

При прямом запуске `.env.dev` не подгружается автоматически, поэтому k6 может упасть с ошибкой `Missing required env variable: BASE_URL`.

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

Важно: load на prod запускать только после согласования с ответственными.

---

## Smoke и Load

### Smoke

Короткая проверка, что тест вообще работает.

Обычно:

```text
VUS=1
ITERATIONS=1
MAX_DURATION=1m
```

Smoke всегда запускается перед load.

### Load

Полноценный нагрузочный запуск.

Обычно используется:

```text
ramping-vus
RAMP_1
RAMP_2
HOLD
RAMP_DOWN
```

---

## Как добавить новый flow

Например, нужен flow для документов.

Создать файл:

```text
tests/document-flow.js
```

Внутри использовать общие модули:

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

Если flow требует авторизацию:

```js
const user = getUserByVuId(exec.vu.idInTest);

group('01_login', () => {
  login(user);
});
```

Не копировать код логина в новый flow. Логин уже реализован в:

```text
lib/auth.js
```

---

## Минимальный шаблон нового flow

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

## Правила поддержки

1. Новый бизнес-сценарий добавляем в `tests/`.
2. Общую логику добавляем в `lib/`.
3. URL не пишем прямо в JS-коде.
4. URL и users-файл храним в `.env.*`.
5. Параметры нагрузки храним в `scripts/**/*.sh`.
6. Результаты сохраняем в `results/`.
7. Перед load всегда запускаем smoke.
8. Реальные users CSV и результаты не коммитим.

---

## Рекомендуемый `.gitignore`

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

## Главное правило

```text
lib/      — общая логика
tests/    — конкретные flow-тесты
scripts/  — запуск тестов
users/    — тестовые пользователи
results/  — результаты запусков
.env.*    — настройки окружений
```
