"""Pick a representative subset of cells for the heavy tier.

The heavy tier is expensive — every cell deploys a real agent against a k3d
snapshot, hits the API, polls the observer. So we run a sample, not the full
matrix. The sample is chosen along two axes:

1. **Per-traceloop axis** — one cell per traceloop version, pinning the
   framework + python to the manifest's `defaultCell`. Surfaces regressions
   that ride along with a Traceloop bump.
2. **Per-framework axis** — one cell per framework, pinning traceloop +
   python to the default. Surfaces regressions in framework-specific
   instrumentation wrappers.

Cells that satisfy both axes (default-traceloop × default-framework) appear
once, not twice.
"""
from __future__ import annotations

from harness.manifest import Cell, Manifest


def select_heavy_subset(cells: list[Cell], manifest: Manifest) -> list[Cell]:
    default = manifest.default_cell

    # Per-traceloop axis: each version of the default provider, pinned to the
    # default framework + framework_version + python so it's exactly one cell
    # per provider version (not one per framework_version too).
    per_tl = [
        c
        for c in cells
        if c.provider_name == default.provider
        and c.framework_name == default.framework
        and c.framework_version == default.framework_version
        and c.python == default.python
    ]

    # Per-framework axis: each framework once, on the default provider
    # version + python.
    per_fw_seen: set[str] = set()
    per_fw: list[Cell] = []
    for c in cells:
        if (
            c.provider_name != default.provider
            or c.provider_version != default.provider_version
            or c.python != default.python
        ):
            continue
        if c.framework_name in per_fw_seen:
            continue
        per_fw_seen.add(c.framework_name)
        per_fw.append(c)

    seen: set[str] = set()
    out: list[Cell] = []
    for c in [*per_tl, *per_fw]:
        if c.id in seen:
            continue
        seen.add(c.id)
        out.append(c)
    return out
