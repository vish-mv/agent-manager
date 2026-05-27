#!/usr/bin/env python3
"""Expand the matrix and filter cells by comma-separated inclusion lists.

Reads filter inputs from env vars (avoids shell-quoting hazards when called
from a GitHub Actions step with `${{ inputs.X }}` interpolations). Writes
a single line `cell_ids=<json>` to GITHUB_OUTPUT.

Env vars:
- FILTER_TRACELOOP_VERSIONS, FILTER_FRAMEWORKS, FILTER_FRAMEWORK_VERSIONS,
  FILTER_PYTHON_VERSIONS — each comma-separated, or the literal string "all".

Used by .github/workflows/instrumentation-matrix-manual.yaml.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from harness.manifest import expand_matrix, load_manifest  # noqa: E402


def _split(value: str) -> set[str] | None:
    """Parse a comma-separated filter into a set, or return None for
    match-everything.

    Treats empty input and any token equal to `all` (case-insensitive) as
    "match everything" — that way an operator who types `all,langchain`
    intending the union doesn't accidentally restrict to just `langchain`,
    and a blank input doesn't silently match nothing.
    """
    tokens = {v.strip() for v in value.split(",") if v.strip()}
    if not tokens or any(t.lower() == "all" for t in tokens):
        return None
    return tokens


def main() -> int:
    cells = expand_matrix(load_manifest(HERE / "matrix.yaml"))

    tlv = _split(os.environ.get("FILTER_TRACELOOP_VERSIONS", "all"))
    fw = _split(os.environ.get("FILTER_FRAMEWORKS", "all"))
    fwv = _split(os.environ.get("FILTER_FRAMEWORK_VERSIONS", "all"))
    pyv = _split(os.environ.get("FILTER_PYTHON_VERSIONS", "all"))

    filtered = [
        c
        for c in cells
        if (tlv is None or c.provider_version in tlv)
        and (fw is None or c.framework_name in fw)
        and (fwv is None or c.framework_version in fwv)
        and (pyv is None or c.python in pyv)
    ]

    ids = [c.id for c in filtered]
    payload = json.dumps(ids)

    gh_output = os.environ.get("GITHUB_OUTPUT")
    if gh_output:
        with open(gh_output, "a") as fh:
            fh.write(f"cell_ids={payload}\n")
            fh.write(f"count={len(ids)}\n")
    else:
        # Local dev: print so the operator can sanity-check filter inputs.
        print(payload)
    print(f"resolved {len(ids)} cell(s)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
