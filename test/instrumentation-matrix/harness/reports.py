"""Per-cell JSON report writer + reader."""
from __future__ import annotations

import base64
import gzip
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class CellResult:
    cell_id: str
    result: str  # "pass" | "fail" | "skipped"
    category: str | None
    skip_reason: str | None
    durations: dict[str, float] = field(default_factory=dict)
    coverage: dict[str, Any] = field(default_factory=dict)
    violations: list[dict[str, Any]] = field(default_factory=list)
    captured_spans: list[dict[str, Any]] = field(default_factory=list)
    evidence: dict[str, Any] | None = None


def write_cell_report(result: CellResult, reports_dir: Path) -> Path:
    reports_dir = Path(reports_dir)
    reports_dir.mkdir(parents=True, exist_ok=True)
    spans_blob = base64.b64encode(
        gzip.compress(json.dumps(result.captured_spans).encode("utf-8"))
    ).decode("ascii")
    payload = {
        "cellId": result.cell_id,
        "result": result.result,
        "category": result.category,
        "skipReason": result.skip_reason,
        "durations": result.durations,
        "coverage": result.coverage,
        "violations": result.violations,
        "capturedSpans": spans_blob,
        "evidence": result.evidence,
    }
    out = reports_dir / f"{result.cell_id}.json"
    out.write_text(json.dumps(payload, indent=2))
    return out


def load_cell_report(path: Path) -> dict[str, Any]:
    """Read a per-cell report and expand `capturedSpans` back into a list.

    The on-disk format gzips+base64s the captured spans to keep report files
    compact. Callers that triage failures need the decoded span list and a
    flat view of attribute keys — both are added to the returned dict as
    `capturedSpansDecoded` and `capturedSpansAttributes`. The original
    `capturedSpans` blob is left in place so the round-trip is non-lossy.
    """
    data = json.loads(Path(path).read_text())
    blob = data.get("capturedSpans") or ""
    spans: list = []
    if blob:
        try:
            spans = json.loads(gzip.decompress(base64.b64decode(blob)).decode("utf-8"))
        except (ValueError, OSError, gzip.BadGzipFile):
            # A truncated/corrupt blob shouldn't crash triage — treat as no
            # decoded spans (the raw blob is still on `data` for inspection).
            spans = []
    data["capturedSpansDecoded"] = spans
    data["capturedSpansAttributes"] = [
        s.get("attributes", {}) or {} for s in spans if isinstance(s, dict)
    ]
    return data
