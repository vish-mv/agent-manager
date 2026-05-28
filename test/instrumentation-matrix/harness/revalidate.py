"""Re-expand known-broken cells from the manifest.

The nightly `revalidate-known-broken` job runs every cell that's currently
gated under `matrix.yaml.known-broken` to detect upstream fixes — when a
known-broken cell starts passing, the next nightly opens an issue suggesting
the exemption be dropped (design §12.3).

This module is the single place that turns a `KnownBroken` entry's
camel-case `cell_match` pattern into actual `Cell` objects. The match is a
subset comparison: if every key:value in `cell_match` agrees with the cell,
it's selected. Missing keys widen the match (a `cell_match` of
`{provider, providerVersion}` matches every framework on that version).
"""
from __future__ import annotations

from harness.manifest import Cell, Manifest, expand_matrix

_FIELD_MAP = {
    "provider": "provider_name",
    "providerVersion": "provider_version",
    "framework": "framework_name",
    "frameworkVersion": "framework_version",
    "python": "python",
}


def _cell_matches(cell: Cell, pattern: dict[str, str]) -> bool:
    for key, want in pattern.items():
        attr = _FIELD_MAP.get(key)
        if attr is None:
            # An unknown match key means the manifest carries a pattern this
            # helper doesn't understand; treat as non-matching rather than
            # crashing the nightly. The matrix-manifest drift check is the
            # right place to enforce known-broken schema.
            return False
        if getattr(cell, attr) != want:
            return False
    return True


def cells_from_known_broken(manifest: Manifest) -> list[Cell]:
    if not manifest.known_broken:
        return []
    all_cells = expand_matrix(manifest)
    seen: set[str] = set()
    out: list[Cell] = []
    for kb in manifest.known_broken:
        for cell in all_cells:
            if not _cell_matches(cell, kb.cell_match):
                continue
            if cell.id in seen:
                continue
            seen.add(cell.id)
            out.append(cell)
    return out
