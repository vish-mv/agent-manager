import json

import pytest

from harness.aggregator import build_summary


def _report(cell_id, result, category=None, missing=None, violations=None):
    return {
        "cellId": cell_id,
        "result": result,
        "category": category,
        "coverage": {
            "expected": ["llm"],
            "actual": ["llm"],
            "missing": missing or [],
        },
        "violations": violations or [],
    }


def test_summary_counts_results(tmp_path):
    (tmp_path / "a.json").write_text(json.dumps(_report("a", "pass")))
    (tmp_path / "b.json").write_text(
        json.dumps(_report("b", "fail", "schema-violation"))
    )
    (tmp_path / "c.json").write_text(json.dumps(_report("c", "skipped", missing=[])))
    s = build_summary(tmp_path, default_cell_id="a")
    assert "1 pass" in s and "1 fail" in s and "1 skipped" in s
    assert "✅ a" in s
    assert "❌ b" in s
    assert "⚠️ c" in s


def test_summary_marks_default_cell(tmp_path):
    (tmp_path / "a.json").write_text(json.dumps(_report("a", "pass")))
    s = build_summary(tmp_path, default_cell_id="a")
    assert "default cell, required" in s


def test_summary_uses_tier_label_in_header(tmp_path):
    (tmp_path / "a.json").write_text(json.dumps(_report("a", "pass")))
    emission = build_summary(tmp_path, default_cell_id="a")
    heavy = build_summary(tmp_path, default_cell_id="a", tier="heavy")
    assert "emission tier" in emission
    assert "heavy tier" in heavy


def test_summary_raises_on_unknown_result(tmp_path):
    (tmp_path / "a.json").write_text(
        json.dumps(_report("a", "skipped-known-broken"))
    )
    with pytest.raises(ValueError, match="unknown result 'skipped-known-broken'"):
        build_summary(tmp_path, default_cell_id="a")
