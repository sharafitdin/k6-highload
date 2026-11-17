#!/usr/bin/env bash
# Прогон «до/после» оптимизации табеля одной командой:
#   1) проверка доступа к стенду (VPN);
#   2) smoke в режиме delta — проверяем, что фикс выкачен (дельта отдаёт поле employees);
#   3) load month — как текущий фронт (после правки перечитывает весь месяц);
#   4) load delta — как новый фронт (после правки GET changes/?since=);
#   5) итоговая таблица в формате для Telegram.
#
# Использование:
#   ./scripts/run-timesheet-compare.sh stage
#   ./scripts/run-timesheet-compare.sh dev
#   SKIP_FIX_CHECK=true ./scripts/run-timesheet-compare.sh stage   # прогнать, даже если фикса нет
#   ONLY=month ./scripts/run-timesheet-compare.sh stage            # только один режим
#
# ВНИМАНИЕ: сценарий изменяет данные (правит ячейки табеля). Только dev/stage.
set -euo pipefail

ENV_NAME="${1:-}"
if [[ "$ENV_NAME" != "dev" && "$ENV_NAME" != "stage" ]]; then
  echo "Usage: $0 dev|stage" >&2
  exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

set -a
source ".env.${ENV_NAME}"
set +a

SMOKE="./scripts/${ENV_NAME}/run-${ENV_NAME}-timesheet-hr-smoke.sh"
LOAD="./scripts/${ENV_NAME}/run-${ENV_NAME}-timesheet-hr-load.sh"
RESULTS_ROOT="results/${ENV_NAME}/timesheet-hr-flow"
PAUSE_BETWEEN_RUNS="${PAUSE_BETWEEN_RUNS:-60}"
MODES="${ONLY:-month delta}"

check_access() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${TEAM_ORIGIN}/" || true)"
  if [[ "$code" != "200" ]]; then
    echo "❌ ${TEAM_ORIGIN} недоступен (HTTP ${code:-000}). Проверь VPN." >&2
    return 1
  fi
}

latest_dir() {
  ls -td "${RESULTS_ROOT}/$1/"*_"$2" 2>/dev/null | head -1
}

echo "▶ 1/4 Проверка доступа к ${ENV_NAME}"
check_access
echo "  ok"

if [[ "${SKIP_FIX_CHECK:-false}" != "true" && "$MODES" == *delta* ]]; then
  echo "▶ 2/4 Smoke delta — проверяем, что фикс выкачен"
  AFTER_EDIT_MODE=delta SMOKE_VUS=1 "$SMOKE" > /dev/null 2>&1 || true
  SMOKE_DIR="$(latest_dir smoke delta)"
  if grep -q "✓ delta has employees" "$SMOKE_DIR/run.log"; then
    echo "  ok: дельта отдаёт employees — фикс на ${ENV_NAME} есть"
  else
    echo "❌ Дельта на ${ENV_NAME} в старом формате (нет поля employees) — фикс не выкачен." >&2
    echo "   Лог: $SMOKE_DIR/run.log" >&2
    echo "   Запусти с SKIP_FIX_CHECK=true, чтобы всё равно прогнать, или ONLY=month для замера «до»." >&2
    exit 2
  fi
else
  echo "▶ 2/4 Проверка фикса пропущена"
fi

RUN_DIRS=()
step=3
for mode in $MODES; do
  echo "▶ ${step}/4 Load ${mode} (≈8 мин)"
  check_access
  AFTER_EDIT_MODE="$mode" "$LOAD" > /dev/null 2>&1 || true
  dir="$(latest_dir load "$mode")"
  RUN_DIRS+=("$dir")
  echo "  результат: $dir"
  if ! check_access; then
    echo "⚠️  После прогона ${mode} стенд недоступен — дальнейшие прогоны остановлены." >&2
    break
  fi
  step=$((step + 1))
  [[ "$mode" != "${MODES##* }" ]] && sleep "$PAUSE_BETWEEN_RUNS"
done

echo
echo "▶ Итог"
python3 -I "scripts/timesheet-report.py" "${RUN_DIRS[@]}"
