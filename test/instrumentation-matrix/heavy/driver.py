"""Heavy-tier driver.

Picks the heavy-tier subset, deploys each cell against the live AMP stack
via agent-manager-service's REST API, invokes the agent, polls
traces-observer-service for the resulting spans, validates against the
contract, and writes a per-cell report. Failures fall into the same
taxonomy the emission tier uses (categorize.FailureCategory).

The heavy CI job brings up AMP from the working tree via the dev
`make setup` chain (build-from-source — so the PR's observer +
instrumentation changes are actually exercised, unlike e2e's released
quick-start), then runs this driver. Service URLs + Thunder IDP creds
default to the values that bring-up exposes; only the LLM keys are real
secrets, forwarded into each deployed agent.

The deploy/invoke/poll bodies are implemented against the Go e2e reference
but have not yet run against a live stack. The heavy job stays
`continue-on-error: true` until a real run validates this end to end;
expect timing constants and the observer `/spans` param mapping to need a
tune on first run.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

import requests

from harness.heavy_subset import select_heavy_subset
from harness.manifest import Cell, expand_matrix, load_manifest
from harness.reports import CellResult, write_cell_report
from harness.validator import ContractValidator
from heavy import k3d
from heavy.amp_client import AmpClient, DeployedAgent, IdpCredentials
from heavy.observer import poll_traces
from providers import PROVIDERS

HERE = Path(__file__).resolve().parent.parent

# AMP service URLs + Thunder IDP credentials default to the values the dev
# `make setup` bring-up exposes (same defaults the e2e suite's config uses).
# They're env-overridable but never required as secrets — the only real
# secrets are the LLM keys, which are forwarded into the deployed agent.
_DEFAULTS = {
    # The dev `make setup` bring-up port-forwards these to localhost:
    # API 9000 (compose 9000:8080), traces-observer 9098, Thunder IDP 8090.
    # (The quick-start/e2e topology routes Thunder via thunder.amp.localhost
    # :8080 with a Host-header trick — that's NOT what the heavy tier uses.)
    "AMP_API_BASE_URL": "http://localhost:9000",
    "TRACES_OBSERVER_BASE_URL": "http://localhost:9098",
    "IDP_TOKEN_URL": "http://localhost:8090/oauth2/token",
    "IDP_CLIENT_ID": "amp-api-client",
    "IDP_CLIENT_SECRET": "amp-api-client-secret",
}

# LLM keys the deployed agent needs to make real calls. Forwarded as
# sensitive env vars into each agent at create time; absent keys are simply
# not forwarded (a cell whose framework needs one will then fail its call,
# which the matrix surfaces).
_LLM_ENV_KEYS = ("OPENAI_API_KEY", "ANTHROPIC_API_KEY")


def _env(name: str) -> str:
    return os.environ.get(name, _DEFAULTS[name])


def main() -> int:
    m = load_manifest(HERE / "matrix.yaml")
    cells = select_heavy_subset(expand_matrix(m), m)

    client = AmpClient(
        base_url=_env("AMP_API_BASE_URL"),
        idp=IdpCredentials(
            token_url=_env("IDP_TOKEN_URL"),
            client_id=_env("IDP_CLIENT_ID"),
            client_secret=_env("IDP_CLIENT_SECRET"),
        ),
    )
    observer_base_url = _env("TRACES_OBSERVER_BASE_URL")
    agent_env = {k: os.environ[k] for k in _LLM_ENV_KEYS if os.environ.get(k)}

    reports_dir = HERE / "reports" / "heavy"
    overall_fail = False
    for cell in cells:
        result = _run_cell(cell, client, observer_base_url, agent_env)
        write_cell_report(result, reports_dir=reports_dir)
        if result.result == "fail":
            overall_fail = True
    return 1 if overall_fail else 0


def _run_cell(
    cell: Cell, client: AmpClient, observer_base_url: str, agent_env: dict[str, str]
) -> CellResult:
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
        agent_env=agent_env,
    )
    try:
        _invoke_agent(deployed)
        spans = poll_traces(client, deployed, observer_base_url)
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


def _invoke_agent(deployed: DeployedAgent) -> None:
    """POST a fixed prompt to the deployed agent's `/chat` endpoint to drive
    trace emission. Auth is the `X-API-Key` header. Retries through the
    post-deploy warm-up window where the endpoint can briefly 502/503/401
    (API-key propagation to the gateway lags the mint call) — mirrors
    test/e2e/operations/agent/invoke_agent.go.

    Body + path match the deployed sample (samples/customer-support-agent):
    `POST <endpoint>/chat {"session_id", "message"}`. A single-turn prompt is
    enough — every cell sample bottoms out in one LLM call, which is the span
    we need.
    """
    url = deployed.endpoint_url.rstrip("/") + "/chat"
    body = {"session_id": f"matrix-{deployed.agent_name}",
            "message": "Answer in one word: capital of France?"}
    deadline = time.monotonic() + 180
    last = ""
    while time.monotonic() < deadline:
        try:
            resp = requests.post(
                url,
                json=body,
                headers={"X-API-Key": deployed.api_key},
                timeout=60,
            )
        except requests.RequestException as e:  # endpoint not reachable yet
            last = str(e)
            time.sleep(5)
            continue
        if resp.status_code in (401, 502, 503):  # warming up / key not propagated
            last = f"{resp.status_code}"
            time.sleep(5)
            continue
        if resp.status_code != 200:
            raise RuntimeError(
                f"agent invocation returned {resp.status_code}: {resp.text[:300]}"
            )
        return
    raise TimeoutError(f"agent endpoint never became ready (last: {last})")


if __name__ == "__main__":
    raise SystemExit(main())
