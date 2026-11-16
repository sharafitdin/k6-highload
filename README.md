# k6 Highload

Нагрузочные тесты пользовательских сценариев MyLink на [k6](https://k6.io).

Подробная документация по структуре проекта и добавлению новых flow — [instruction/README.md](instruction/README.md).

## Быстрый старт

1. Установить k6: `brew install k6` (macOS) или по [инструкции](https://grafana.com/docs/k6/latest/set-up/install-k6/).
2. Выдать права на скрипты:

   ```bash
   find scripts -type f -name "*.sh" -exec chmod +x {} \;
   ```

3. Проверить учётки в `users/users-<env>.csv` (формат — `users/users-example.csv`).
   В репозитории есть только тестовые dev-учётки; для stage/prod файл создаётся локально и не коммитится.
4. Запускать тесты только через скрипты из `scripts/<env>/` — они подгружают `.env.<env>` и сохраняют отчёт в `results/<env>/<flow>/<mode>/<timestamp>/`.

Всегда сначала smoke, потом load. Load на prod — только после согласования.

## Сценарии

| Flow | Файл | Что проверяет |
|---|---|---|
| login | `tests/login-flow.js` | Авторизация |
| home | `tests/home-flow.js` | Логин + главная страница |
| device | `tests/device-flow.js` | Отметки с терминалов |
| timesheet-hr | `tests/timesheet-hr-flow.js` | Табель глазами HR (изменяет данные) |

## Табель (timesheet-hr-flow)

Сценарий одного HR за итерацию:

1. Логин.
2. Список табелей за месяц, профиль, роли, дерево подразделений.
3. Если табеля по подразделению нет — создание (`POST /service/wtm/api/v1/timesheets/`).
4. Открытие табеля: сетка, alerts, revision, employee-filter, коды.
5. Правка ячеек сотрудник/день (`PUT /service/wtm/api/v1/timesheets/{y}/{m}/changes/`) + перечитывание сетки, истории дня и revision.
6. История изменений табеля.

Отправка на согласование, согласование и возврат на доработку **не** выполняются — они блокируют табель.

Запуск на dev:

```bash
./scripts/dev/run-dev-timesheet-hr-smoke.sh
./scripts/dev/run-dev-timesheet-hr-load.sh
```

Smoke под несколькими пользователями: `SMOKE_VUS=3 ./scripts/dev/run-dev-timesheet-hr-smoke.sh`.

Параметры (env, можно передать перед командой):

| Переменная | По умолчанию | Описание |
|---|---|---|
| `TIMESHEET_DEPARTMENT_IDS` | пусто | ID подразделений через запятую. Пусто — берутся табели `IN_PROGRESS` за период, где есть сотрудники |
| `TIMESHEET_PERIOD` | текущий месяц | Период `YYYY-MM` |
| `EDITS_PER_ITERATION` | `2` | Сколько ячеек правит HR за итерацию |
| `ALLOW_CREATE` | `true` | Создавать табель, если его нет |
| `THINK_TIME_SECONDS` | `2` | Пауза между действиями пользователя |
| `FAIL_BACKOFF_SECONDS` | `10` | Пауза после прерванной итерации |

Метрики сценария: `timesheet_edits_done`, `timesheet_edit_conflicts` (409), `timesheet_failed_iterations`, `timesheet_grid_bytes`.

Отчёт по прогону от 16.11.2026 — [docs/timesheet-load-report-2026-11-16.md](docs/timesheet-load-report-2026-11-16.md), сырые результаты — `results/dev/timesheet-hr-flow/load/2026-11-16_11-09-07/`.
