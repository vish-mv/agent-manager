import json
from pathlib import Path

from harness.reports import CellResult, load_cell_report, write_cell_report
from harness.triage import build_diff_markdown


def test_write_cell_report_creates_json(tmp_path):
    result = CellResult(
        cell_id="traceloop-0.60.0-langchain-0.3.27-py3.11",
        result="pass",
        category=None,
        skip_reason=None,
        durations={"install": 4.2, "scenario": 1.1, "validate": 0.3},
        coverage={"expected": ["llm"], "actual": ["llm"], "missing": []},
        violations=[],
        captured_spans=[{"name": "openai.chat", "kind": "CLIENT", "attributes": {}}],
    )
    out = write_cell_report(result, reports_dir=tmp_path)
    data = json.loads(Path(out).read_text())
    assert data["cellId"] == result.cell_id
    assert data["result"] == "pass"
    assert "capturedSpans" in data
    assert data["coverage"]["missing"] == []


def test_write_cell_report_includes_violations(tmp_path):
    result = CellResult(
        cell_id="x",
        result="fail",
        category="schema-violation",
        skip_reason=None,
        durations={},
        coverage={"expected": ["llm"], "actual": ["llm"], "missing": []},
        violations=[
            {
                "spanName": "openai.chat",
                "kind": "llm",
                "rule": "required",
                "path": "/attributes/gen_ai.system",
                "message": "is required",
            }
        ],
        captured_spans=[],
    )
    out = write_cell_report(result, reports_dir=tmp_path)
    data = json.loads(Path(out).read_text())
    assert data["category"] == "schema-violation"
    assert data["violations"][0]["path"] == "/attributes/gen_ai.system"


def test_load_cell_report_decodes_captured_spans(tmp_path):
    result = CellResult(
        cell_id="x",
        result="fail",
        category="schema-violation",
        skip_reason=None,
        durations={},
        coverage={"expected": ["llm"], "actual": ["llm"], "missing": []},
        violations=[],
        captured_spans=[
            {
                "name": "openai.chat",
                "kind": "CLIENT",
                "attributes": {
                    "gen_ai.provider.name": "openai",
                    "gen_ai.request.model": "gpt-4o-mini",
                },
            }
        ],
    )
    out = write_cell_report(result, reports_dir=tmp_path)
    loaded = load_cell_report(out)
    assert loaded["capturedSpansDecoded"][0]["name"] == "openai.chat"
    assert loaded["capturedSpansAttributes"] == [
        {
            "gen_ai.provider.name": "openai",
            "gen_ai.request.model": "gpt-4o-mini",
        }
    ]


def test_load_cell_report_feeds_triage_without_false_missing(tmp_path):
    """Round-trip: keys that ARE captured must not render as MISSING.

    Regression guard — earlier iteration of triage read the wrong field name
    and reported every required key as MISSING regardless of what was actually
    captured.
    """
    result = CellResult(
        cell_id="x",
        result="fail",
        category="schema-violation",
        skip_reason=None,
        durations={},
        coverage={"expected": ["llm"], "actual": ["llm"], "missing": []},
        violations=[],
        captured_spans=[
            {
                "name": "openai.chat",
                "kind": "CLIENT",
                "attributes": {
                    "gen_ai.provider.name": "openai",
                    "gen_ai.request.model": "gpt-4o-mini",
                },
            }
        ],
    )
    out = write_cell_report(result, reports_dir=tmp_path)
    loaded = load_cell_report(out)
    md = build_diff_markdown(
        loaded, schema_required=["gen_ai.provider.name", "gen_ai.request.model"]
    )
    assert "| `gen_ai.provider.name` | present |" in md
    assert "| `gen_ai.request.model` | present |" in md
    assert "MISSING" not in md


def test_report_round_trips_evidence(tmp_path):
    from harness.reports import CellResult, write_cell_report
    import json
    r = CellResult(
        cell_id="traceloop-0.61.0-langchain-0.3.27-py3.11",
        result="fail", category="ingest-rejected", skip_reason=None,
        evidence={"agent": "Failed to export batch code: 401"},
    )
    out = write_cell_report(r, reports_dir=tmp_path)
    payload = json.loads(out.read_text())
    assert payload["evidence"] == {"agent": "Failed to export batch code: 401"}
