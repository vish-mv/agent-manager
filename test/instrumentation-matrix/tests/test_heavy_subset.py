from pathlib import Path

from harness.heavy_subset import select_heavy_subset
from harness.manifest import (
    DefaultCell,
    FrameworkEntry,
    HeavyTier,
    Manifest,
    ProviderEntry,
    expand_matrix,
    load_manifest,
)

FIXTURE = Path(__file__).parent / "fixtures" / "manifest_minimal.yaml"


def test_subset_is_one_cell_for_minimal_fixture():
    m = load_manifest(FIXTURE)
    cells = expand_matrix(m)
    sub = select_heavy_subset(cells, m)
    assert len(sub) == 1
    assert sub[0].framework_name == "langchain"


def _multi_manifest() -> Manifest:
    """Two traceloop versions × two frameworks × one python."""
    return Manifest(
        schema_version=1,
        providers={
            "traceloop": ProviderEntry(
                name="traceloop",
                versions=["0.60.0", "0.61.0"],
                contract_schema="v1",
                instrumentation_versions={"0.60.0": "0.2.1", "0.61.0": "0.3.0"},
            )
        },
        frameworks=[
            FrameworkEntry(
                name="langchain",
                package="langchain",
                versions=["0.3.27"],
                sample_path="cells/langchain_sample.py",
                span_kinds=["llm"],
            ),
            FrameworkEntry(
                name="crewai",
                package="crewai",
                versions=["1.1.0"],
                sample_path="cells/crewai_sample.py",
                span_kinds=["agent"],
            ),
        ],
        python_versions=["3.11"],
        default_cell=DefaultCell("traceloop", "0.60.0", "langchain", "0.3.27", "3.11"),
        heavy_tier=HeavyTier(1, 1),
    )


def test_subset_covers_each_traceloop_version_once_and_each_framework_once():
    m = _multi_manifest()
    cells = expand_matrix(m)
    sub = select_heavy_subset(cells, m)
    versions = {(c.provider_version, c.framework_name) for c in sub}
    # per-traceloop axis: each version paired with the default framework.
    assert ("0.60.0", "langchain") in versions
    assert ("0.61.0", "langchain") in versions
    # per-framework axis: each framework paired with the default traceloop.
    assert ("0.60.0", "crewai") in versions


def test_subset_deduplicates_overlapping_axes():
    """Default-traceloop × default-framework appears on both axes; only once."""
    m = _multi_manifest()
    cells = expand_matrix(m)
    sub = select_heavy_subset(cells, m)
    ids = [c.id for c in sub]
    assert len(ids) == len(set(ids))


def test_subset_uses_default_python_only():
    m = _multi_manifest()
    m.python_versions = ["3.10", "3.11", "3.12"]
    cells = expand_matrix(m)
    sub = select_heavy_subset(cells, m)
    assert all(c.python == "3.11" for c in sub)


def test_per_tl_axis_pins_default_framework_version():
    """If the default framework has multiple versions, the per-traceloop axis
    must pick only the default version — one cell per provider version, not
    one per (provider_version × framework_version)."""
    m = _multi_manifest()
    m.frameworks[0].versions = ["0.3.27", "0.4.0"]  # langchain (the default fw)
    cells = expand_matrix(m)
    sub = select_heavy_subset(cells, m)
    langchain = [c for c in sub if c.framework_name == "langchain"]
    # 2 traceloop versions × the single default framework_version = 2 cells.
    assert {c.framework_version for c in langchain} == {"0.3.27"}
    assert {c.provider_version for c in langchain} == {"0.60.0", "0.61.0"}
