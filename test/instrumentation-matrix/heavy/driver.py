"""Heavy-tier driver.

Picks the heavy-tier subset, deploys each cell against the snapshot cluster
via agent-manager-service's REST API, invokes the agent, polls
traces-observer-service for the resulting spans, validates against the
contract, and writes a per-cell report. Failures fall into the same
taxonomy the emission tier uses (categorize.FailureCategory).

This file is a scaffold — the heavy lifting in `heavy.amp_client` and
`heavy.observer` is `NotImplementedError` pending the first snapshot
artifact. The control flow is committed so Phase 8 can fill bodies
without restructuring.
"""
from __future__ import annotations

import os
from pathlib import Path

from harness.heavy_subset import select_heavy_subset
from harness.manifest import Cell, expand_matrix, load_manifest
from harness.reports import CellResult, write_cell_report
from harness.validator import ContractValidator
from heavy import k3d
from heavy.amp_client import AmpClient, IdpCredentials
from heavy.observer import poll_traces
from providers import PROVIDERS

HERE = Path(__file__).resolve().parent.parent

REQUIRED_ENV = (
    "AMP_API_BASE_URL",
    "TRACES_OBSERVER_BASE_URL",
    "IDP_TOKEN_URL",
    "IDP_CLIENT_ID",
    "IDP_CLIENT_SECRET",
)


def _require_env() -> None:
    """Fail fast on missing AMP / IDP env vars, before any cluster wait.

    A KeyError 25 minutes into `k3d.wait_ready()` is a terrible UX; this
    precheck surfaces the missing var in under a second with a pointer at
    the contract doc.
    """
    missing = [k for k in REQUIRED_ENV if k not in os.environ]
    if missing:
        raise SystemExit(
            "heavy tier missing required env vars: "
            f"{', '.join(missing)}. See heavy/HEAVY-TIER-DEPLOY.md."
        )


def main() -> int:
    _require_env()

    m = load_manifest(HERE / "matrix.yaml")
    cells = select_heavy_subset(expand_matrix(m), m)

    k3d.wait_ready()

    client = AmpClient(
        base_url=os.environ["AMP_API_BASE_URL"],
        idp=IdpCredentials(
            token_url=os.environ["IDP_TOKEN_URL"],
            client_id=os.environ["IDP_CLIENT_ID"],
            client_secret=os.environ["IDP_CLIENT_SECRET"],
        ),
    )

    reports_dir = HERE / "reports" / "heavy"
    overall_fail = False
    for cell in cells:
        result = _run_cell(cell, client)
        write_cell_report(result, reports_dir=reports_dir)
        if result.result == "fail":
            overall_fail = True
    return 1 if overall_fail else 0


def _run_cell(cell: Cell, client: AmpClient) -> CellResult:
    if cell.instrumentation_version is None:
        # Heavy tier only covers init-container-shipping providers today.
        # Manual cells are emission-only.
        return CellResult(
            cell_id=cell.id,
            result="skipped",
            category=None,
            skip_reason="no instrumentation_version (manual provider)",
            durations={},
            coverage={"expected": cell.span_kinds, "actual": [], "missing": []},
            violations=[],
            captured_spans=[],
        )

    k3d.reset_opensearch_indices()
    deployed = client.deploy_agent(
        cell_id=cell.id,
        instrumentation_version=cell.instrumentation_version,
        framework_package=cell.framework_package,
        framework_version=cell.framework_version,
        python_version=cell.python,
    )
    try:
        _invoke_agent(deployed)
        spans = poll_traces(deployed)
    finally:
        client.teardown_agent(deployed)

    if not spans:
        return CellResult(
            cell_id=cell.id,
            result="fail",
            category="no-spans-captured",
            skip_reason=None,
            durations={},
            coverage={
                "expected": cell.span_kinds,
                "actual": [],
                "missing": cell.span_kinds,
            },
            violations=[],
            captured_spans=[],
        )

    provider = PROVIDERS[cell.provider_name]
    validator = ContractValidator.load(provider.contract_schema_id())
    coverage = validator.assert_coverage(spans, expected_kinds=cell.span_kinds)
    shape_results = validator.validate_all(spans)
    violations = [
        {
            "spanName": r.span_name,
            "kind": r.kind,
            "rule": "schema",
            "path": r.path,
            "message": r.message,
        }
        for r in shape_results
        if not r.ok
    ]

    base_coverage = {
        "expected": cell.span_kinds,
        "actual": sorted(coverage.actual),
        "missing": sorted(coverage.missing),
    }
    if not coverage.ok:
        return CellResult(
            cell_id=cell.id,
            result="fail",
            category="missing-span-kind",
            skip_reason=None,
            durations={},
            coverage=base_coverage,
            violations=violations,
            captured_spans=spans,
        )
    if violations:
        return CellResult(
            cell_id=cell.id,
            result="fail",
            # See FailureCategory.PIPELINE_ERROR docstring for why heavy-tier
            # schema violations map here rather than to SCHEMA_VIOLATION.
            category="pipeline-error",
            skip_reason=None,
            durations={},
            coverage=base_coverage,
            violations=violations,
            captured_spans=spans,
        )
    return CellResult(
        cell_id=cell.id,
        result="pass",
        category=None,
        skip_reason=None,
        durations={},
        coverage=base_coverage,
        violations=[],
        captured_spans=spans,
    )


def _invoke_agent(deployed) -> None:
    """POST a known prompt at the deployed agent's `/chat` endpoint.

    All cell samples ultimately produce a single-turn LLM call, so a fixed
    prompt is enough to drive trace emission. Real implementation is in
    Phase 8 — see HEAVY-TIER-DEPLOY.md.
    """
    raise NotImplementedError(
        "Heavy-tier agent invocation is a scaffold (Phase 8); the deployed "
        "agent exposes a `/chat` endpoint authenticated by deployed.api_key."
    )


if __name__ == "__main__":
    raise SystemExit(main())
