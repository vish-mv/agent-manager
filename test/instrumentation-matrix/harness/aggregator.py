"""Aggregate per-cell reports into the PR-comment Markdown summary."""
from __future__ import annotations

import json
from pathlib import Path

EMOJI = {"pass": "✅", "fail": "❌", "skipped": "⚠️"}


def build_summary(
    reports_dir: Path, *, default_cell_id: str, tier: str = "emission"
) -> str:
    """Render a per-tier Markdown table from a directory of per-cell reports.

    `tier` is used in the section header so the same renderer produces both
    the emission-tier and heavy-tier sections of summary.md.
    """
    files = sorted(Path(reports_dir).glob("*.json"))
    rows: list[str] = []
    counts = {"pass": 0, "fail": 0, "skipped": 0}
    for f in files:
        r = json.loads(f.read_text())
        result = r["result"]
        if result not in EMOJI:
            raise ValueError(
                f"{f.name}: unknown result {result!r}; "
                f"expected one of {sorted(EMOJI)}. "
                "Add the new status to harness/aggregator.EMOJI "
                "(and the counts seed) before emitting it."
            )
        counts[result] += 1
        cell = r["cellId"]
        detail = _detail(r)
        marker = " (default cell, required)" if cell == default_cell_id else ""
        rows.append(f"| {EMOJI[result]} {cell} | {result} | {detail}{marker} |")
    body = [
        f"## Instrumentation matrix — {tier} tier",
        "",
        "| Cell | Result | Detail |",
        "|---|---|---|",
        *rows,
        "",
        f"Total: {counts['pass']} pass · "
        f"{counts['fail']} fail · "
        f"{counts['skipped']} skipped",
    ]
    return "\n".join(body)


def _detail(r: dict) -> str:
    if r["result"] == "pass":
        return ""
    if r["result"] == "skipped":
        return r.get("skipReason") or r.get("category") or ""
    cat = r.get("category", "") or ""
    if r.get("violations"):
        v = r["violations"][0]
        return f"{cat}: `{v.get('path', '')}` {v.get('message', '')}"
    missing = (r.get("coverage") or {}).get("missing") or []
    if missing:
        return f"{cat}: missing {missing}"
    return cat
