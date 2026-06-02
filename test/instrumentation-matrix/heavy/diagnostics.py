"""Heavy-tier failure diagnostics: capture pipeline-boundary evidence when a
cell captures 0 spans, and classify which boundary the trail went cold at.

Evidence is gathered best-effort from `kubectl logs` (agent pod + otel
collector); any kubectl failure leaves the corresponding field None
(indeterminate) and never raises. The classifier is pure so it unit-tests
without a cluster.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from harness.categorize import FailureCategory


@dataclass
class Evidence:
    agent_init: str | None = None          # "ok" | "failed" | None (marker not found)
    agent_export_status: int | None = None # HTTP status parsed from an OTLP exporter error line
    agent_export_error: str | None = None  # short excerpt of the exporter error
    collector_received: bool | None = None # True / False / None (indeterminate)
    raw: dict[str, str] = field(default_factory=dict)  # truncated log excerpts, for the report


def classify_no_spans(ev: Evidence) -> FailureCategory:
    """Map boundary evidence to a failure category. Order matters: a gateway
    rejection (401/403) is the most specific and actionable signal."""
    if ev.agent_export_status in (401, 403):
        return FailureCategory.INGEST_REJECTED
    if (
        ev.agent_init == "failed"
        or (ev.agent_export_status is not None and ev.agent_export_status >= 500)
        or (ev.agent_export_error is not None and ev.agent_export_status is None)
    ):
        return FailureCategory.EXPORT_FAILED
    if ev.agent_init == "ok" and ev.agent_export_error is None and ev.collector_received is False:
        return FailureCategory.COLLECTOR_NOT_RECEIVED
    return FailureCategory.NO_SPANS_CAPTURED
