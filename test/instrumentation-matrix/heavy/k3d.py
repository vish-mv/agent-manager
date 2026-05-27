"""Thin wrappers around k3d + kubectl. Used only by the heavy-tier driver in CI.

These functions are intentionally narrow: they shell out, check exit codes,
and return strings. The driver composes them; tests at the harness level
don't import this module, so it stays out of the unit-test surface.

References:
- The snapshot artifact is built by `.github/workflows/heavy-tier-snapshot.yaml`
  and contains a docker-save tarball of the AMP images.
- The namespace list mirrors what `deployments/scripts/setup-openchoreo.sh`
  creates, so local-dev and CI converge on the same ready signal.
- AMP-on-k3d operational notes are in MEMORY.md (host.k3d.internal DNS,
  Colima restart crash-loop).
"""
from __future__ import annotations

import subprocess

# AMP stack lands in these namespaces after setup-openchoreo.sh + the AMP
# helm installs complete. `kubectl wait` runs per-namespace because that's
# how the setup script already verifies readiness — wait selectors keyed on
# guessed `app=` labels missed the real `app.kubernetes.io/component=` ones.
AMP_NAMESPACES = (
    "openchoreo-control-plane",
    "openchoreo-data-plane",
    "openchoreo-workflow-plane",
    "openchoreo-observability-plane",
    "amp-thunder",
)


def restore_snapshot(snapshot_path: str, cluster_name: str = "amp-heavy") -> None:
    """Load the docker-saved image tarball into the named k3d cluster.

    The snapshot workflow produces this tarball via `docker save` against
    the AMP image set enumerated from `.github/release-config.json`.
    `k3d image import` loads it into every node in the cluster.
    """
    subprocess.run(
        ["k3d", "image", "import", "-c", cluster_name, snapshot_path],
        check=True,
    )


def wait_ready(timeout_s: int = 300) -> None:
    """Block until every deployment in the AMP namespaces is Available.

    Mirrors the per-namespace readiness pattern in
    `deployments/scripts/setup-openchoreo.sh` — `kubectl wait --for=condition
    =available deployment --all -n <ns>`. Each namespace gets its own wait;
    a missing or empty namespace is treated as "nothing to wait for" rather
    than an error, so the function tolerates partial installs (useful when
    iterating on the snapshot workflow itself).
    """
    for ns in AMP_NAMESPACES:
        # Skip namespaces that don't exist yet — `kubectl wait` against an
        # empty namespace prints a no-op message but exits 0; against a
        # missing namespace it errors. Probe first.
        probe = subprocess.run(
            ["kubectl", "get", "namespace", ns],
            capture_output=True,
        )
        if probe.returncode != 0:
            continue
        subprocess.run(
            [
                "kubectl",
                "wait",
                "-n",
                ns,
                "--for=condition=available",
                f"--timeout={timeout_s}s",
                "deployment",
                "--all",
            ],
            check=True,
        )


def reset_opensearch_indices() -> None:
    """Delete the spans-* indices so each cell starts from a clean slate.

    OpenSearch is installed by the openchoreo bring-up into the
    openchoreo-observability-plane namespace. Best-effort: a failure here
    means the index reset didn't land, which the driver detects later when
    polling traces returns stale results.
    """
    subprocess.run(
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
        check=False,
    )
