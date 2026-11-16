#!/usr/bin/env bash
set -euo pipefail

# ВНИМАНИЕ: сценарий изменяет данные (создаёт табель, правит ячейки). Только dev/stage.
# Load запускать только после успешного smoke.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

ENV_NAME="stage"
FLOW_NAME="timesheet-hr-flow"
TEST_MODE_VALUE="load"
RUN_ID="$(date +"%Y-%m-%d_%H-%M-%S")"
RESULTS_DIR="results/${ENV_NAME}/${FLOW_NAME}/${TEST_MODE_VALUE}/${RUN_ID}"

mkdir -p "$RESULTS_DIR"

set -a
source .env.stage
set +a

# Подразделения через запятую; VU распределяются по ним по кругу.
# Пусто — берётся первый IN_PROGRESS табель из списка за период.
TIMESHEET_DEPARTMENT_IDS="${TIMESHEET_DEPARTMENT_IDS:-}"
# Период YYYY-MM, по умолчанию текущий месяц
TIMESHEET_PERIOD="${TIMESHEET_PERIOD:-}"

TEST_MODE="$TEST_MODE_VALUE" \
RESULTS_DIR="$RESULTS_DIR" \
VUS_1=5 \
VUS=10 \
RAMP_1=1m \
RAMP_2=1m \
HOLD=5m \
RAMP_DOWN=1m \
LOGIN_FLOW_MODE=api \
TIMESHEET_DEPARTMENT_IDS="$TIMESHEET_DEPARTMENT_IDS" \
TIMESHEET_PERIOD="$TIMESHEET_PERIOD" \
EDITS_PER_ITERATION=2 \
ALLOW_CREATE=true \
THINK_TIME_SECONDS=2 \
k6 run tests/timesheet-hr-flow.js \
  --summary-export "$RESULTS_DIR/summary-export.json" \
  2>&1 | tee "$RESULTS_DIR/run.log"
