from harness.manifest import (
    DefaultCell,
    FrameworkEntry,
    HeavyTier,
    KnownBroken,
    Manifest,
    ProviderEntry,
)
from harness.revalidate import cells_from_known_broken


def _manifest(known_broken: list[KnownBroken]) -> Manifest:
    return Manifest(
        schema_version=1,
        providers={
            "traceloop": ProviderEntry(
                name="traceloop", versions=["0.60.0", "0.61.0"], contract_schema="v1"
            )
        },
        frameworks=[
            FrameworkEntry(
                "langchain", "langchain", ["0.3.27"], "cells/langchain_sample.py", ["llm"]
            ),
            FrameworkEntry(
                "crewai", "crewai", ["1.1.0"], "cells/crewai_sample.py", ["agent"]
            ),
        ],
        python_versions=["3.11"],
        default_cell=DefaultCell("traceloop", "0.60.0", "langchain", "0.3.27", "3.11"),
        heavy_tier=HeavyTier(1, 1),
        known_broken=known_broken,
    )


def test_emits_one_cell_per_known_broken_entry():
    m = _manifest(
        [
            KnownBroken(
                cell_match={
                    "provider": "traceloop",
                    "providerVersion": "0.60.0",
                    "framework": "langchain",
                    "frameworkVersion": "0.3.27",
                },
                reason="upstream broken",
                until="2099-01-01",
            )
        ]
    )
    cells = cells_from_known_broken(m)
    assert len(cells) == 1
    assert cells[0].framework_name == "langchain"
    assert cells[0].provider_version == "0.60.0"


def test_partial_match_expands_to_multiple_cells():
    """A known-broken with only `provider` + `providerVersion` matches every
    framework on that version (revalidating the whole row)."""
    m = _manifest(
        [
            KnownBroken(
                cell_match={"provider": "traceloop", "providerVersion": "0.61.0"},
                reason="entire 0.61 row broken",
                until="2099-01-01",
            )
        ]
    )
    cells = cells_from_known_broken(m)
    assert {c.framework_name for c in cells} == {"langchain", "crewai"}
    assert all(c.provider_version == "0.61.0" for c in cells)


def test_multiple_entries_deduplicate():
    """Two known-broken entries hitting the same cell yield that cell once."""
    same = {
        "provider": "traceloop",
        "providerVersion": "0.60.0",
        "framework": "langchain",
        "frameworkVersion": "0.3.27",
    }
    m = _manifest(
        [
            KnownBroken(cell_match=same, reason="a", until="2099-01-01"),
            KnownBroken(cell_match=same, reason="b", until="2099-01-01"),
        ]
    )
    cells = cells_from_known_broken(m)
    assert len(cells) == 1


def test_field_map_keys_match_cell_attributes():
    """Invariant guard: every _FIELD_MAP value must be a real Cell attribute.

    Adding a new dimension to Cell without updating _FIELD_MAP would make
    known-broken patterns silently fail to match the new field; this test
    catches that drift without needing the field-name knowledge in two
    places to stay in sync manually.
    """
    from dataclasses import fields

    from harness.manifest import Cell
    from harness.revalidate import _FIELD_MAP

    cell_attrs = {f.name for f in fields(Cell)}
    assert set(_FIELD_MAP.values()) <= cell_attrs, (
        f"_FIELD_MAP references unknown Cell attrs: "
        f"{set(_FIELD_MAP.values()) - cell_attrs}"
    )


def test_unmatched_known_broken_is_silently_empty():
    """A known-broken pointing at a cell the matrix no longer expands yields
    no cells — common after a matrix.yaml prune. revalidate-known-broken's
    job is to re-run what's still there; cleanup is a separate workflow."""
    m = _manifest(
        [
            KnownBroken(
                cell_match={"provider": "traceloop", "providerVersion": "9.9.9"},
                reason="gone",
                until="2099-01-01",
            )
        ]
    )
    assert cells_from_known_broken(m) == []
