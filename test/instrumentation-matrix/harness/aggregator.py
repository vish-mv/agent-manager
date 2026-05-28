"""Aggregate per-cell reports into the PR-comment Markdown summary +
machine-readable metrics for the nightly Chat alert."""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from harness.manifest import Manifest, expand_matrix

EMOJI = {"pass": "✅", "fail": "❌", "skipped": "⚠️"}

# Pulls the provider_version segment out of a cell id like
# `traceloop-0.60.0-langchain-0.3.27-py3.11`. Fallback only — prefer
# manifest lookup when a Manifest is passed to collect_metrics.
_PROVIDER_VERSION_RE = re.compile(r"^[^-]+-([0-9][^-]*)-")


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


def collect_metrics(
    reports_dirs: Path | Iterable[Path],
    *,
    manifest: Manifest | None = None,
) -> dict[str, Any]:
    """Walk per-cell reports (one tier or several) and return counts, category
    histogram, and a likely-cause string for the nightly Chat alert.

    `reports_dirs` accepts a single Path (back-compat) or an iterable — the
    nightly passes `[reports/cells, reports/heavy]` so heavy-tier failures
    contribute to `has_failures` and surface in the Chat alert per design
    §12.4.

    `manifest` is optional. When provided, framework names are looked up
    from the expanded cell list rather than re-parsed from the cell id —
    that's the only fully-correct approach because cell ids with numeric
    framework-name segments (e.g. `gpt-4-...`) confuse the regex parser.
    The parser is kept as a fallback for callers that don't have the
    manifest handy.

    Heuristic (design §12.2): if every failure shares a `(provider, version)`
    and the failures span more than one framework, that's almost always a
    provider-version regression. If every failure shares the same violation
    `path`, that's a schema/observer regression. Otherwise None.
    """
    if isinstance(reports_dirs, Path):
        dirs = [reports_dirs]
    else:
        dirs = list(reports_dirs)

    files: list[Path] = []
    for d in dirs:
        files.extend(sorted(d.glob("*.json")) if d.exists() else [])

    counts: dict[str, int] = {"pass": 0, "fail": 0, "skipped": 0}
    categories: Counter[str] = Counter()
    failed: list[dict] = []
    for f in files:
        r = json.loads(f.read_text())
        result = r["result"]
        if result in counts:
            counts[result] += 1
        else:
            counts[result] = 1
        if result == "fail":
            failed.append(r)
            if r.get("category"):
                categories[r["category"]] += 1

    cell_framework = _framework_index(manifest) if manifest else {}

    return {
        "counts": counts,
        "categories": dict(categories),
        "likely_cause": _likely_cause(failed, cell_framework),
    }


def _framework_index(manifest: Manifest) -> dict[str, str]:
    return {cell.id: cell.framework_name for cell in expand_matrix(manifest)}


def _framework_of(cell_id: str, cell_framework: dict[str, str]) -> str | None:
    """Manifest-first lookup; regex parse as fallback for unknown ids."""
    if cell_id in cell_framework:
        return cell_framework[cell_id]
    return _extract_framework(cell_id)


def _likely_cause(failed: list[dict], cell_framework: dict[str, str]) -> str | None:
    if len(failed) < 2:
        return None

    # 1) Same provider_version across all failures, multiple frameworks → provider regression.
    pvs = {_extract_provider_version(r["cellId"]) for r in failed}
    pvs.discard(None)
    if len(pvs) == 1:
        frameworks = {_framework_of(r["cellId"], cell_framework) for r in failed}
        frameworks.discard(None)
        pv = next(iter(pvs))
        if len(frameworks) > 1:
            return f"Provider regression: every failing cell is on version {pv}."

    # 2) Same violation path across all failures → schema/observer regression.
    paths = []
    for r in failed:
        v = r.get("violations") or []
        if not v:
            paths.append(None)
            continue
        paths.append(v[0].get("path"))
    path_set = set(paths)
    path_set.discard(None)
    if path_set and len(path_set) == 1 and len([p for p in paths if p]) == len(failed):
        path = next(iter(path_set))
        return f"Schema/observer regression: every failure violates `{path}`."

    return None


def _extract_provider_version(cell_id: str) -> str | None:
    m = _PROVIDER_VERSION_RE.match(cell_id)
    return m.group(1) if m else None


def _extract_framework(cell_id: str) -> str | None:
    # cellId = "<provider>-<provider_version>-<framework>-<framework_version>-py<py>"
    # `<provider_version>` can contain dots; `<framework>` is the next segment
    # after the version. Split on '-py' to drop the python suffix, then take
    # everything between the version and the framework_version. Best-effort.
    body = cell_id.rsplit("-py", 1)[0]
    parts = body.split("-")
    # parts: [<provider>, <pver_segments...>, <framework>, <fver_segments...>]
    # The provider is always 1 segment; the framework_version starts at the
    # first segment that looks like a version (begins with digit + dot/letter).
    # Simpler heuristic: the framework name is the 3rd segment from the end
    # of parts when the framework_version has 3 dot-segments, but versions
    # vary — use re-parsing instead.
    # Find the framework name by looking for the segment after the provider
    # version. The provider version matches `_PROVIDER_VERSION_RE`; everything
    # between that and the next version-shaped run is the framework name.
    m = re.match(
        r"^[^-]+-[0-9][^-]*-([a-z][a-z0-9_-]*?)-[0-9]",
        cell_id,
    )
    return m.group(1) if m else None


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
