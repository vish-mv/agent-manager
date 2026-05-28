# AMP Instrumentation Matrix

Per-PR + nightly compatibility matrix for AMP instrumentation. Three docs:

- [`DESIGN.md`](./DESIGN.md) — architecture of the test system (the *why*).
- [`RUNBOOK.md`](./RUNBOOK.md) — operational how-to: adding cells, triaging
  reds, onboarding a Traceloop release, adding a provider, the heavy tier.
- [`FINDINGS.md`](./FINDINGS.md) — living `F-NNN` log of upstream gaps and
  schema concessions.

This README is the quickstart.

## Run locally

```bash
# one cell
nox -s emission -- --cell-id=traceloop-0.60.0-langchain-0.3.27-py3.11

# filter
nox -s emission -k langchain

# full matrix
nox -s emission

# build PR-comment summary
nox -s report
```

## Re-record cassettes

```bash
OPENAI_API_KEY=sk-... ANTHROPIC_API_KEY=sk-ant-... \
    python scripts/record_cassette.py <framework> <scenario>
```

## Adding a new framework or version

1. Add the framework block (or extend an existing `versions:` list) in
   `matrix.yaml`.
2. Add a sample under `cells/<framework>_sample.py` if new.
3. Record cassettes for any new scenarios.
4. Open a PR; the
   [Tier 1 workflow](../../.github/workflows/instrumentation-matrix-pr.yaml)
   will run the new cells as advisory checks. `default-cell-required` is the
   required status check; the rest of the matrix runs `continue-on-error`.
   The per-cell summary table is rendered on the `publish-matrix-summary`
   job's page (GitHub step summary) and the full reports are uploaded as the
   `matrix-reports` artifact — both work on fork PRs, where a PR comment
   can't be posted with the read-only token.

## Triggering nightly + heavy tier on demand

Use **Actions → Instrumentation matrix — manual** (Tier 3) with inputs for
target versions / frameworks. See
[`.github/workflows/instrumentation-matrix-manual.yaml`](../../.github/workflows/instrumentation-matrix-manual.yaml)
(landing in Phase 8).

## Findings log

Upstream gaps and schema concessions discovered while building cells are
tracked in [`FINDINGS.md`](FINDINGS.md). Each entry has an `F-NNN` id,
the affected provider/framework combo, what we mitigated, and the
upstream change that would let us tighten back.
