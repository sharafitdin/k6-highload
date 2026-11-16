#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

ENV_NAME="dev"
FLOW_NAME="home-flow"
TEST_MODE_VALUE="load"
RUN_ID="$(date +"%Y-%m-%d_%H-%M-%S")"
RESULTS_DIR="results/${ENV_NAME}/${FLOW_NAME}/${TEST_MODE_VALUE}/${RUN_ID}"

mkdir -p "$RESULTS_DIR"

set -a
source .env.dev
set +a

TEST_MODE="$TEST_MODE_VALUE" \
RESULTS_DIR="$RESULTS_DIR" \
VUS_1=1 \
VUS=5 \
RAMP_1=1m \
RAMP_2=0m \
HOLD=1m \
RAMP_DOWN=1m \
LOGIN_FLOW_MODE=browser \
INCLUDE_DUPLICATES=false \
THINK_TIME_SECONDS=1 \
k6 run tests/home-flow.js \
  --summary-export "$RESULTS_DIR/summary-export.json" \
  2>&1 | tee "$RESULTS_DIR/run.log"