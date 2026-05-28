"""k3d/kubectl helpers for the heavy-tier driver.

The cluster bring-up + readiness is owned by the dev `make setup` chain the
heavy CI job runs (it builds the AMP component images from the working tree
and loads them into k3d), so the driver no longer restores a snapshot or
waits for readiness itself. The only thing left here is per-cell OpenSearch
index hygiene.
"""
from __future__ import annotations

import subprocess


def reset_opensearch_indices() -> None:
    """Delete the spans-* indices so each cell starts from a clean slate.

    OpenSearch is installed by the openchoreo bring-up into the
    openchoreo-observability-plane namespace. Best-effort: a failure here
    means the index reset didn't land, which the driver detects later when
    polling traces returns stale results.
    """
    proc = subprocess.run(
        [
            "kubectl",
            "-n",
            "openchoreo-observability-plane",
            "exec",
            "deploy/opensearch",
            "--",
            "curl",
            "-s",
            "-X",
            "DELETE",
            "http://localhost:9200/spans-*",
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        # Best-effort, but don't swallow silently — a failed reset means the
        # next cell may see stale spans, which is worth a visible warning.
        print(
            f"::warning::OpenSearch index reset failed (rc={proc.returncode}): "
            f"{(proc.stderr or proc.stdout).strip()[:300]}"
        )
