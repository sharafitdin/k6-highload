# Timesheet load test (HR role), dev

**Date:** 2026-11-16
**Service:** wtm (working time timesheet)
**Environment:** dev-team.mylink.kz
**Test:** `tests/timesheet-hr-flow.js`, results — `results/dev/timesheet-hr-flow/load/2026-11-16_11-09-07/`

## Scenario

An HR user performs typical timesheet actions:

1. Log in.
2. Open the list of timesheets for the month.
3. Open a department timesheet (grid of employees by day).
4. Edit cells (shift and hours worked), 2 cells per iteration.
5. View the change history.

Submitting for approval, approving and returning for rework were not part of the test.

## Load profile

- Gradual ramp-up to 10 concurrent HR users over 2 minutes, then hold.
- Overall request rate: about 2 requests per second.

## Results

| Metric | 1 HR | 3 HR | 10 HR |
|---|---|---|---|
| Opening the timesheet (grid), avg | 10 s | 11 s | 30 s (p95 — 60 s timeout) |
| Saving a cell, avg | 8 s | 12 s | 22 s (p95 — 50 s) |
| Successful saves | 100% | 100% | 45% |
| Request errors | 0% | 0% | 18.5% |
| Login | 100% | 100% | 100% |

## Findings

1. **The wtm service cannot handle 5–10 concurrent HR users.** About 2 minutes after the start it begins returning 502 on every timesheet endpoint: list, grid, history and save.
2. **Opening the timesheet is the heaviest operation.** The response is about 1 MB for a department of roughly 60 employees. Even with a single user the timesheet takes 10 s to open, and under load it does not fit into 60 s.
3. **Saving a cell is slow even without load** (8 s). With 10 HR users more than half of the saves fail.
4. **No conflicts during concurrent editing.** calendar_version locking works correctly.
5. **Login and other services are stable.** The problem is isolated to wtm.

## Recommendations

- Optimize timesheet loading: reduce the response size, add pagination or incremental loading, caching.
- Analyze the cell save time (`PUT /timesheets/{y}/{m}/changes/`).
- Check wtm resources and limits (CPU, memory, number of workers, load balancer timeouts).
- After the fixes, rerun the load test with the same scenario:

```bash
./scripts/dev/run-dev-timesheet-hr-load.sh
```
