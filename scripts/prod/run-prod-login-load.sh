#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

ENV_NAME="prod"
FLOW_NAME="login-flow"
TEST_MODE_VALUE="load"
RUN_ID="$(date +"%Y-%m-%d_%H-%M-%S")"
RESULTS_DIR="results/${ENV_NAME}/${FLOW_NAME}/${TEST_MODE_VALUE}/${RUN_ID}"

mkdir -p "$RESULTS_DIR"

set -a
source .env.prod
set +a

TEST_MODE="$TEST_MODE_VALUE" \
RESULTS_DIR="$RESULTS_DIR" \
VUS_1=50 \
VUS=200 \
RAMP_1=5m \
RAMP_2=10m \
HOLD=10m \
RAMP_DOWN=5m \
LOGIN_FLOW_MODE=browser \
THINK_TIME_SECONDS=1 \
k6 run tests/login-flow.js \
  --summary-export "$RESULTS_DIR/summary-export.json" \
  2>&1 | tee "$RESULTS_DIR/run.log"