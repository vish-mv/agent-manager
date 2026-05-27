import json

import pytest

from harness.aggregator import build_summary, collect_metrics


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


# ── collect_metrics ───────────────────────────────────────────────────────


def _fail(cell_id, category="schema-violation", violations=None):
    return {
        "cellId": cell_id,
        "result": "fail",
        "category": category,
        "coverage": {"expected": ["llm"], "actual": ["llm"], "missing": []},
        "violations": violations or [],
    }


def test_collect_metrics_aggregates_counts_and_categories(tmp_path):
    (tmp_path / "a.json").write_text(json.dumps(_report("a", "pass")))
    (tmp_path / "b.json").write_text(
        json.dumps(_fail("traceloop-0.60.0-langchain-0.3.27-py3.11"))
    )
    (tmp_path / "c.json").write_text(
        json.dumps(_fail("traceloop-0.60.0-crewai-1.1.0-py3.11", category="pipeline-error"))
    )
    m = collect_metrics(tmp_path)
    assert m["counts"]["pass"] == 1
    assert m["counts"]["fail"] == 2
    assert m["categories"] == {"schema-violation": 1, "pipeline-error": 1}


def test_collect_metrics_likely_cause_provider_regression(tmp_path):
    """All failures share provider_version 0.61.0 and span multiple frameworks."""
    (tmp_path / "a.json").write_text(
        json.dumps(_fail("traceloop-0.61.0-langchain-0.3.27-py3.11"))
    )
    (tmp_path / "b.json").write_text(
        json.dumps(_fail("traceloop-0.61.0-crewai-1.1.0-py3.11"))
    )
    m = collect_metrics(tmp_path)
    assert m["likely_cause"] is not None
    assert "0.61.0" in m["likely_cause"]


def test_collect_metrics_likely_cause_schema_regression(tmp_path):
    """All failures share the same violation path across providers."""
    v = [{"path": "/attributes/gen_ai.system", "message": "is required", "spanName": "x", "kind": "llm"}]
    (tmp_path / "a.json").write_text(
        json.dumps(_fail("traceloop-0.60.0-langchain-0.3.27-py3.11", violations=v))
    )
    (tmp_path / "b.json").write_text(
        json.dumps(_fail("traceloop-0.61.0-langchain-0.3.27-py3.11", violations=v))
    )
    m = collect_metrics(tmp_path)
    assert m["likely_cause"] is not None
    assert "gen_ai.system" in m["likely_cause"]


def test_collect_metrics_no_likely_cause_when_mixed(tmp_path):
    """Failures span different versions AND different violation paths."""
    (tmp_path / "a.json").write_text(
        json.dumps(
            _fail(
                "traceloop-0.60.0-langchain-0.3.27-py3.11",
                violations=[{"path": "/a", "message": "x", "spanName": "x", "kind": "llm"}],
            )
        )
    )
    (tmp_path / "b.json").write_text(
        json.dumps(
            _fail(
                "traceloop-0.61.0-crewai-1.1.0-py3.11",
                violations=[{"path": "/b", "message": "y", "spanName": "x", "kind": "llm"}],
            )
        )
    )
    m = collect_metrics(tmp_path)
    assert m["likely_cause"] is None


def test_collect_metrics_no_likely_cause_when_single_failure(tmp_path):
    (tmp_path / "a.json").write_text(
        json.dumps(_fail("traceloop-0.60.0-langchain-0.3.27-py3.11"))
    )
    m = collect_metrics(tmp_path)
    assert m["likely_cause"] is None


def test_collect_metrics_handles_hyphenated_framework_names(tmp_path):
    """`llama-index`, `manual-rag`, `openai-direct` parse correctly."""
    (tmp_path / "a.json").write_text(
        json.dumps(_fail("traceloop-0.61.0-llama-index-0.12.0-py3.11"))
    )
    (tmp_path / "b.json").write_text(
        json.dumps(_fail("traceloop-0.61.0-openai-direct-2.38.0-py3.11"))
    )
    m = collect_metrics(tmp_path)
    # Both share 0.61.0, different frameworks → provider regression.
    assert m["likely_cause"] is not None and "0.61.0" in m["likely_cause"]


def test_collect_metrics_walks_multiple_dirs(tmp_path):
    """Heavy + emission dirs both contribute to counts and categories."""
    emission = tmp_path / "cells"
    heavy = tmp_path / "heavy"
    emission.mkdir()
    heavy.mkdir()
    (emission / "a.json").write_text(json.dumps(_report("a", "pass")))
    (heavy / "b.json").write_text(
        json.dumps(_fail("traceloop-0.60.0-langchain-0.3.27-py3.11", category="pipeline-error"))
    )
    m = collect_metrics([emission, heavy])
    assert m["counts"]["pass"] == 1
    assert m["counts"]["fail"] == 1
    assert m["categories"] == {"pipeline-error": 1}


def test_collect_metrics_tolerates_missing_dirs(tmp_path):
    """Heavy dir may not exist (no heavy run); single emission dir still works."""
    emission = tmp_path / "cells"
    heavy = tmp_path / "heavy"  # deliberately not created
    emission.mkdir()
    (emission / "a.json").write_text(json.dumps(_report("a", "pass")))
    m = collect_metrics([emission, heavy])
    assert m["counts"]["pass"] == 1
    assert m["counts"]["fail"] == 0


def test_collect_metrics_uses_manifest_for_framework_lookup(tmp_path):
    """A cell-id with a numeric framework segment (e.g. `gpt-4-tools`) would
    fool the regex parser; manifest lookup is the authoritative path."""
    from harness.manifest import (
        DefaultCell,
        FrameworkEntry,
        HeavyTier,
        Manifest,
        ProviderEntry,
    )

    m_obj = Manifest(
        schema_version=1,
        providers={
            "traceloop": ProviderEntry(
                "traceloop", ["0.61.0"], "v1", instrumentation_versions={}
            )
        },
        frameworks=[
            FrameworkEntry(
                "gpt-4-tools",
                "gpt-4-tools",
                ["0.1.0"],
                "cells/sample.py",
                ["llm"],
            ),
            FrameworkEntry(
                "langchain",
                "langchain",
                ["0.3.27"],
                "cells/langchain_sample.py",
                ["llm"],
            ),
        ],
        python_versions=["3.11"],
        default_cell=DefaultCell("traceloop", "0.61.0", "langchain", "0.3.27", "3.11"),
        heavy_tier=HeavyTier(1, 1),
    )

    (tmp_path / "a.json").write_text(
        json.dumps(_fail("traceloop-0.61.0-gpt-4-tools-0.1.0-py3.11"))
    )
    (tmp_path / "b.json").write_text(
        json.dumps(_fail("traceloop-0.61.0-langchain-0.3.27-py3.11"))
    )
    metrics = collect_metrics(tmp_path, manifest=m_obj)
    # Two different frameworks on the same version → provider regression.
    assert metrics["likely_cause"] is not None
    assert "0.61.0" in metrics["likely_cause"]


def test_collect_metrics_handles_empty_csv_filter():
    """Imported here to keep the test file self-contained for filter-related
    edge cases that aggregator.collect_metrics inherits via the workflow."""
    # No assertion — this placeholder documents that an empty-CSV input is
    # handled by scripts/expand_filter.py before metrics ever see it.
