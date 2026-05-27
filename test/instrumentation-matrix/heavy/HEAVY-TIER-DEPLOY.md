# Heavy-tier deploy contract

The heavy tier deploys one agent per heavy-subset cell against the k3d
snapshot built by `.github/workflows/heavy-tier-snapshot.yaml`, invokes it,
polls `traces-observer-service`, and validates the resulting spans against
the contract. This doc captures the deploy mechanism and the operational
contract — what the driver assumes, what env vars it consumes, what timeouts
it enforces.

## Why not raw Workload manifests

The original Phase 7 sketch suggested rendering a `kind: Workload` YAML and
`kubectl apply`-ing it. AMP doesn't expose agents that way. Agents are
created through `agent-manager-service`'s REST API, which:

1. Reads its embedded instrumentation catalog (`baseline.json`, generated
   from `release-config.json`) to validate the requested
   `instrumentation_version`.
2. Renders the right init-container image
   (`ghcr.io/wso2/amp-python-instrumentation-provider:<instr>-python<X.Y>`)
   into the agent's pod spec.
3. Mints an API key, exposes a `/chat` endpoint, returns both to the caller.

`test/e2e/framework/shared_agent.go` is the canonical Go reference. The
heavy-tier Python driver mirrors that flow via `heavy.amp_client.AmpClient`.

## Required environment variables

AMP authenticates via Thunder IDP using the OAuth2 `client_credentials`
grant — there is no static admin token. The driver fetches a short-lived
access token at startup and refreshes as needed, mirroring
`test/e2e/framework/auth.go::FetchToken`.

| Variable | Source | Purpose |
|---|---|---|
| `AMP_API_BASE_URL` | snapshot workflow output | cluster-local URL of agent-manager-service, e.g. `http://agent-manager-service.default.svc.cluster.local:8080` |
| `TRACES_OBSERVER_BASE_URL` | snapshot workflow output | URL the driver polls — e.g. `http://traces-observer-service.default.svc.cluster.local:9098` |
| `IDP_TOKEN_URL` | constant per cluster | Thunder OAuth2 token endpoint, e.g. `http://thunder.amp.localhost:8080/oauth2/token` |
| `IDP_CLIENT_ID` | repo secret / cluster config | OAuth2 client ID (local-dev default: `amp-api-client`) |
| `IDP_CLIENT_SECRET` | repo secret / cluster config | OAuth2 client secret (local-dev default: `amp-api-client-secret`) |
| `OPENAI_API_KEY` | repo secret | real key — the deployed agent makes real LLM calls; cassettes are emission-tier only |
| `ANTHROPIC_API_KEY` | repo secret | as above, for anthropic-direct heavy cells |

All five AMP / IDP variables are required; `main()` fails fast in under a
second if any is unset, before the cluster wait kicks in. LLM keys are
required per the cells that need them (the driver deploys only cells whose
providers actually issue HTTP calls — i.e., it skips manual cells, which
run emission-only).

### Token fetch sequence

```
POST <IDP_TOKEN_URL>
  Authorization: Basic <base64(IDP_CLIENT_ID:IDP_CLIENT_SECRET)>
  Content-Type: application/x-www-form-urlencoded

  grant_type=client_credentials

→ 200 { "access_token": "...", "token_type": "Bearer", "expires_in": 3600 }
```

The access token goes into the `Authorization: Bearer <token>` header on
every subsequent call to `agent-manager-service`. Tokens expire — the
client refreshes proactively if `expires_in - elapsed < 30s`, again
mirroring the e2e Go reference.

## Deploy flow (per cell)

```
for cell in heavy_subset:
    if cell.instrumentation_version is None:    # manual provider
        skip
        continue

    k3d.reset_opensearch_indices()              # clean slate per cell

    deployed = client.deploy_agent(
        cell_id                  = cell.id,
        instrumentation_version  = cell.instrumentation_version,
        framework_package        = cell.framework_package,
        framework_version        = cell.framework_version,
        python_version           = cell.python,
    )                                            # blocks until build is Ready
    try:
        invoke_agent(deployed)                   # POST /chat — fixed prompt
        spans = observer.poll_traces(deployed)   # blocks until spans land
    finally:
        client.teardown_agent(deployed)          # always; even on validation fail

    validate(spans, cell.span_kinds)
    write_cell_report(...)
```

The cell records `(namespace, component, environment)` on the `DeployedAgent`
record at deploy time so the observer poll can form a valid
`GET /api/v1/traces` query without re-discovery.

## Observer query shape

`GET /api/v1/traces` requires:

```
?namespace=<ns>
&project=<project>
&component=<component>
&environment=<environment>
&startTime=<RFC 3339>
&endTime=<RFC 3339>
```

(verified against `traces-observer-service/handlers/handlers.go`). The
driver records `startTime` at deploy time and uses `now()` for `endTime` on
each poll.

## Timeout budget

- **Build readiness**: 240s. AMP's image pull + buildpack run + pod start
  can take ~3 min on a cold snapshot. Cells that don't reach `Ready` in
  240s are reported as `pipeline-error`.
- **Span emission**: 120s after the first `/chat` call returns 200. Most
  cells emit within 10s; the long tail accommodates OpenSearch indexing
  lag.
- **Teardown**: 60s. Best-effort; failures here log but don't fail the cell.

Total per-cell wall time is bounded by ~7 min in the worst case; the heavy
subset is currently 1–4 cells, so the whole tier fits inside a single
ubuntu-latest 60-minute budget.

## When this gets implemented

The function bodies in `heavy/amp_client.py` and `heavy/observer.py` raise
`NotImplementedError` today. They get filled in once the snapshot workflow
(Task 40) publishes its first artifact and the nightly workflow (Phase 8)
has something to dispatch against. Until then, `nox -s heavy` is dispatch-
able but will surface the NotImplementedError immediately — that's
intentional, since trying to land an unvalidated full implementation would
just rot.
