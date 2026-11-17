#!/usr/bin/env python3
"""Итоговая таблица по прогонам timesheet-hr-flow в формате для Telegram.

Использование:
    python3 scripts/timesheet-report.py <run_dir> [<run_dir> ...]

run_dir — папка прогона (results/<env>/timesheet-hr-flow/load/<timestamp>_<mode>/) с summary.json.
"""
import json
import os
import sys


def sec(ms):
    return f"{ms / 1000:.1f} с".replace(".", ",")


def pct(rate):
    return f"{rate * 100:.1f}%".replace(".0%", "%").replace(".", ",")


def load(run_dir):
    path = os.path.join(run_dir, "summary.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    m = data["metrics"]

    def v(name, key, default=0):
        return m.get(name, {}).get("values", {}).get(key, default)

    grid = "http_req_duration{name:GET timesheet grid}"
    put = "http_req_duration{name:PUT timesheet changes}"
    delta = "http_req_duration{name:GET timesheet changes delta}"
    duration_s = data.get("state", {}).get("testRunDurationMs", 0) / 1000

    return {
        "name": os.path.basename(run_dir.rstrip("/")).split("_")[-1],
        "Открытие табеля, avg": f"{sec(v(grid, 'avg'))} (p95 = {sec(v(grid, 'p(95)'))})",
        "Сохранение ячейки, avg": f"{sec(v(put, 'avg'))} (p95 = {sec(v(put, 'p(95)'))})",
        "Дельта после правки, avg": sec(v(delta, "avg")) if v(delta, "avg") else "—",
        "Успешные сохранения": pct(v("checks{type:timesheet_edit}", "rate")),
        "Сохранено ячеек": str(int(v("timesheet_edits_done", "count"))),
        "Ошибки запросов": pct(v("http_req_failed", "rate")),
        "Авторизация": pct(v("checks{type:login}", "rate", 1)),
        "Запросов всего / RPS": f"{int(v('http_reqs', 'count'))} / {v('http_reqs', 'rate'):.1f}".replace(".", ","),
        "Длительность": f"{int(duration_s // 60)} мин {int(duration_s % 60)} с",
    }


def main(dirs):
    runs = [load(d) for d in dirs if d and os.path.exists(os.path.join(d, "summary.json"))]
    if not runs:
        print("Нет summary.json в указанных папках")
        return 1

    rows = [k for k in runs[0] if k != "name"]
    headers = ["Показатель"] + [r["name"] for r in runs]
    table = [headers] + [[row] + [r[row] for r in runs] for row in rows]
    widths = [max(len(line[i]) for line in table) for i in range(len(headers))]

    def fmt(line):
        return " | ".join(cell.ljust(widths[i]) for i, cell in enumerate(line)).rstrip()

    print("```")
    print(fmt(table[0]))
    print("-+-".join("-" * w for w in widths))
    for line in table[1:]:
        print(fmt(line))
    print("```")
    print()
    for d in dirs:
        print(f"Отчёт: {d}/summary.html")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
