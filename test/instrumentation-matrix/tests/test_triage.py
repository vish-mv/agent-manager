import json
from pathlib import Path

from harness.triage import build_diff_markdown, required_keys_for_kinds


def test_diff_shows_missing_required_attribute():
    report = {
        "cellId": "x",
        "category": "schema-violation",
        "violations": [
            {
                "spanName": "openai.chat",
                "kind": "llm",
                "rule": "schema",
                "path": "/attributes/gen_ai.system",
                "message": "'gen_ai.system' is a required property",
            }
        ],
        "capturedSpansAttributes": [{"gen_ai.request.model": "gpt-4o-mini"}],
    }
    md = build_diff_markdown(
        report, schema_required=["gen_ai.system", "gen_ai.request.model"]
    )
    assert "# Triage — x" in md
    assert "## Violations" in md
    assert "openai.chat" in md
    assert "gen_ai.system" in md
    assert "MISSING" in md


def test_diff_marks_all_required_present_when_attrs_cover_them():
    report = {
        "cellId": "y",
        "category": "schema-violation",
        "violations": [],
        "capturedSpansAttributes": [
            {"gen_ai.system": "openai", "gen_ai.request.model": "gpt-4o-mini"}
        ],
    }
    md = build_diff_markdown(
        report, schema_required=["gen_ai.system", "gen_ai.request.model"]
    )
    assert "MISSING" not in md


def test_required_keys_for_kinds_reads_real_schemas(tmp_path):
    bundle = tmp_path / "traceloop/v1/kinds"
    bundle.mkdir(parents=True)
    (bundle / "llm.schema.json").write_text(
        json.dumps(
            {
                "properties": {
                    "attributes": {
                        "required": [
                            "gen_ai.request.model",
                            "gen_ai.usage.input_tokens",
                        ]
                    }
                }
            }
        )
    )
    (bundle / "tool.schema.json").write_text(
        json.dumps({"properties": {"attributes": {"required": ["gen_ai.tool.name"]}}})
    )
    keys = required_keys_for_kinds(tmp_path, "traceloop/v1", ["llm", "tool"])
    assert keys == [
        "gen_ai.request.model",
        "gen_ai.tool.name",
        "gen_ai.usage.input_tokens",
    ]


def test_required_keys_for_kinds_handles_real_traceloop_v1_bundle():
    """Smoke-test against the committed contract — guards against schema-shape drift."""
    contracts = Path(__file__).resolve().parent.parent / "contracts"
    keys = required_keys_for_kinds(contracts, "traceloop/v1", ["llm"])
    assert "gen_ai.request.model" in keys
    assert "gen_ai.system" not in keys  # vendor key is in anyOf, not top-level required
