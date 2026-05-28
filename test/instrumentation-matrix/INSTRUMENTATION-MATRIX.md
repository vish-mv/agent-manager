# Instrumentation Matrix — operational guide

Day-to-day runbook for the instrumentation-matrix suite: how to extend it,
read its output, and keep it honest. For *why* it's built this way, see the
[design doc](./INSTRUMENTATION-MATRIX-DESIGN.md). For the running log of
upstream gaps and schema concessions, see [`FINDINGS.md`](./FINDINGS.md).

## 1. What the matrix is (and isn't)

The matrix validates AMP's **instrumentation contract** — "does a given
`(provider × provider-version × framework × framework-version × python)` cell
emit spans the observer can parse" — across the combinations declared in
[`matrix.yaml`](./matrix.yaml). It runs in two tiers:

- **Emission tier** (fast, every relevant PR): runs each cell's sample agent
  in an isolated venv, captures spans via an in-memory exporter with VCR
  cassettes replacing live LLM calls, and validates them against the
  JSON-schema contract.
- **Heavy tier** (nightly / on-demand): deploys a representative subset of
  cells against a real AMP stack on k3d and validates the spans that survive
  the full pipeline. (Heavy-tier deploy/poll is implemented but not yet
  validated against a live stack; see §7.)

It is **not** a correctness test of the agents themselves, a load test, or a
console/UI test — it asserts the *shape* of emitted telemetry, nothing more.

## 2. Add a framework, a framework version, or a Traceloop version

All three are edits to [`matrix.yaml`](./matrix.yaml):

- **New framework version**: add it to that framework's `versions:` list. No
  cassette re-record needed — different framework versions produce different
  *spans* but identical *HTTP* (the cassette captures the latter).
- **New framework**: add a `frameworks:` block (`name`, `package`, `versions`,
  `samplePath`, `spanKinds`, optional `extras`), add a sample under
  `cells/<framework>_sample.py`, and record its cassette (§4 of the design,
  and `scripts/record_cassette.py`).
- **New Traceloop version**: add it to `providers.traceloop.versions` **and**
  add a `providers.traceloop.instrumentationVersions["<ver>"]` entry mapping
  it to the init-container `instrumentation_version` (needed by the heavy
  tier — see §7). `make check-matrix-manifest` enforces that this map covers
  every version `release-config.json` currently ships.

After any edit, sanity-check locally:

```bash
cd test/instrumentation-matrix
nox -s emission -- --cell-id=<the-new-cell-id>     # one cell
nox -s emission -k <framework>                      # all cells for a framework
```

## 3. Onboard a new Traceloop release (the canary workflow)

The matrix shadow-tests a new Traceloop release *before* AMP baselines it:

1. `traceloop-release-watch.yaml` opens a `traceloop-release` issue when a new
   `traceloop-sdk` publishes — that's the trigger.
2. Add the new version to `matrix.yaml` (`versions` + `instrumentationVersions`).
   No baseline change yet.
3. Open a PR. The emission tier runs the full cross-product against the new
   version; every new-version cell is **advisory** because it isn't the
   `defaultCell`, so a regression doesn't block the PR.
4. Read the matrix summary (§4) to see exactly which
   `(framework × framework-version × python)` cells regressed.
5. Decide:
   - **All green** → follow-up PR bumps `release-config.json`, regenerates
     `baseline.json`, and (optionally) promotes `defaultCell`.
   - **Acceptable reds** → onboard with `known-broken` entries (§6) tracking
     each regression and its `until:` date.
   - **Too red** → leave it gated or revert the matrix addition; the watcher
     issue stays open.

Promoting `defaultCell` is the explicit moment a version goes from
"shadow-tested" to "shipped and PR-required."

## 4. Triage a red cell

A red emission cell is diagnosed from the run, no local repro needed:

1. **Summary table** — on the `publish-matrix-summary` job's page (GitHub
   step summary, not a PR comment — fork PRs can't comment). One row per
   cell with result + a one-line detail (`category: missing <kinds>` or a
   `path` + message for a schema violation).
2. **Per-cell JSON** — `reports/cells/<id>.json`, with the coverage map,
   violations, and gzipped captured spans. In CI the full matrix bundles
   these into the `matrix-reports` artifact (the gating default cell also
   uploads `default-cell-report`); locally they're written under
   `reports/cells/`.
3. **Triage diff** — `reports/diffs/<cell-id>.diff.md` lists the schema's
   required keys vs what the cell actually captured. `nox -s report`
   generates these for failing cells.

The `category` tells you whose problem it likely is (design §12.1):
`install-failure` (manifest), `sample-import-failure` (sample/framework),
`no-spans-captured` / `missing-span-kind` (provider), `schema-violation`
(provider or observer), `cassette-miss` (sample or provider),
`pipeline-error` / `infra-error` (heavy-tier infra/observer).

If a regression is upstream and you can't fix it now, record it in
[`FINDINGS.md`](./FINDINGS.md) with an `F-NNN` id and gate the cell with
`known-broken` (§6).

## 5. Add a new instrumentation provider

A *provider* is the swap point that lets the matrix test OpenInference /
OpenLit / vanilla-OTel later without rewriting cells. To add one:

1. Implement the `InstrumentationProvider` Protocol in
   `harness/provider.py` — see `providers/traceloop.py` and
   `providers/manual.py` as worked examples. You need:
   - `name`
   - `package_specs(version)` → pip specs the cell venv installs
   - `bootstrap_module()` → a sitecustomize-style module that initialises the
     SDK against an `InMemorySpanExporter` (mirror
     `providers/bootstrap/traceloop/sitecustomize.py`)
   - `contract_schema_id()` → which schema bundle validates its spans
   - `normalize_span(raw)` → optional namespace folding (default identity)
2. Register it in `providers/__init__.py`'s `PROVIDERS` dict.
3. Add a contract schema bundle under `contracts/<provider>/<version>/` if the
   provider emits a different shape (Traceloop and manual share `traceloop/v1`).
4. Reference it from `matrix.yaml` — either as a provider every framework
   cross-products with, or pinned to specific frameworks via a `provider:`
   restriction (as `manual-rag` does for the `manual` provider).

`ManualProvider` is the simplest worked example: it installs only stdlib
OpenTelemetry (`opentelemetry-sdk`/`-api`), and its sitecustomize wires a
`TracerProvider` + `InMemorySpanExporter` directly — deliberately *not*
calling `amp_instrumentation.init_otel()`, since that ships spans over OTLP
and the in-memory harness replaces that path. It validates against the
*same* `traceloop/v1` schema as the auto path — the observer reads one shape
regardless of source.

## 6. The `known-broken` workflow

When a cell exposes a regression you can't fix immediately:

1. Add an entry under `matrix.yaml.known-broken` with the `cell` match
   pattern (a subset of `provider`/`providerVersion`/`framework`/
   `frameworkVersion`/`python` — missing keys widen the match), a `reason`,
   and an `until:` ISO date.
2. The matrix still expands and reports the cell, but as
   `skipped-known-broken`, so it doesn't block the PR.
3. Nightly, the `revalidate-known-broken` job re-runs every known-broken cell
   unconditionally. If a previously-broken cell now **passes**, it opens an
   issue (titled "known-broken cells now passing — drop exemptions", labeled
   `instrumentation-matrix-revalidate`) suggesting you drop the exemption.
4. Past `until:`, the cell un-skips automatically — forcing a deliberate
   re-extend or fix rather than letting an exemption rot silently.

Pair every `known-broken` entry with an `F-NNN` entry in `FINDINGS.md` so the
"why" survives.

## 7. Heavy tier and snapshot maintenance

The heavy tier (`nox -s heavy`, `heavy/driver.py`) deploys a representative
cell subset (`harness/heavy_subset.py`: one per Traceloop version + one per
framework, on the default python) against a real AMP stack on k3d, then polls
`traces-observer-service` and validates the enriched spans. Deploy is via the
agent-manager-service REST API + Thunder OAuth2 — see
[`heavy/HEAVY-TIER-DEPLOY.md`](./heavy/HEAVY-TIER-DEPLOY.md) for the env-var
contract and flow.

**Status:** the deploy / invoke / poll bodies in `heavy/amp_client.py` and
`heavy/observer.py` are **implemented** against the Go e2e reference, with
mocked-HTTP unit tests (`tests/test_heavy_client.py`). They haven't run
against a live AMP stack yet (no snapshot exists), so the heavy jobs stay
`continue-on-error: true` in CI until a real run validates end to end —
expect the timing constants and the observer `/spans` param mapping to need
a tune on first run (see `heavy/HEAVY-TIER-DEPLOY.md` → "Implementation
status").

**Snapshot cadence:** `heavy-tier-snapshot.yaml` builds the pre-baked k3d
image set (every AMP service image + every init-container image from
`release-config.json`). It re-bakes on `workflow_dispatch` and whenever the
helm charts, the `setup-*.sh` scripts, the service Dockerfiles, or
`release-config.json` change — i.e., whenever the known-good combination it
bundles shifts. The heavy driver restores it with `k3d image import`.

## 8. Where the schemas come from

The JSON-schema contract under `contracts/traceloop/v1/` is **generated from
`traces-observer-service`'s parsers**, not hand-written:

```bash
make gen-instrumentation-contract     # regenerate schemas from the observer
make check-contract-drift             # fail if generated output != committed
```

`check-contract-drift` (run by the `verify-contract-and-manifest` CI job)
enforces both directions: if the observer adds a required attribute without
regenerating, or a schema is hand-edited without a matching observer change,
the build fails. Every deliberate concession (a relaxed `required`, a
stringified type) is justified by an `F-NNN` entry in `FINDINGS.md`.

`check-matrix-manifest` (same CI job) separately enforces that `matrix.yaml`
covers every `(traceloop_version, instrumentation_version, python_version)`
that `release-config.json` currently ships — the matrix may be a superset,
but never a subset, of what AMP baselines.
