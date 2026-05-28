"""Map stage + error text to a categorical failure label.

The aggregator counts by category so triage starts with "what kind of failure
am I looking at" rather than "which cell". Each branch is gated on the stage
that *can* produce it, so future error strings can't drift between categories
just because they happen to share a substring with an unrelated stage.

Branches are matched in order; the first hit wins. Keep the substring matches
narrow and case-insensitive; broaden only when a real failure surfaces a
phrasing the classifier missed.

TODO: wire this into ``harness/test_cell.py`` so install and scenario errors
get categorized at the source. Today the per-cell pytest body assigns
category strings directly from validator outcomes; pip / sample-import paths
don't flow through this classifier yet.
"""
from __future__ import annotations

from enum import Enum

_SCENARIO_STAGES = {"scenario", "validate"}


class FailureCategory(str, Enum):
    INSTALL_FAILURE = "install-failure"
    SAMPLE_IMPORT_FAILURE = "sample-import-failure"
    NO_SPANS_CAPTURED = "no-spans-captured"
    MISSING_SPAN_KIND = "missing-span-kind"
    SCHEMA_VIOLATION = "schema-violation"  # emission tier — provider emits wrong shape
    CASSETTE_MISS = "cassette-miss"
    # Heavy-tier-specific: by the time spans reach the observer they've been
    # through the enrichment pipeline, so a contract failure on those spans
    # is more likely a pipeline/observer issue than a provider bug. The
    # heavy driver maps schema violations to this category, not to
    # SCHEMA_VIOLATION, to preserve that distinction in triage.
    PIPELINE_ERROR = "pipeline-error"
    INFRA_ERROR = "infra-error"
    UNKNOWN = "unknown"


def categorize(stage: str, error_text: str) -> FailureCategory:
    t = error_text.lower()
    if stage == "install":
        if "no matching distribution" in t or "could not find a version" in t:
            return FailureCategory.INSTALL_FAILURE
        return FailureCategory.UNKNOWN
    if stage in _SCENARIO_STAGES:
        if "cannotoverwriteexistingcassette" in t or "no match was found" in t:
            return FailureCategory.CASSETTE_MISS
        if "no spans captured" in t:
            return FailureCategory.NO_SPANS_CAPTURED
        if "missing span kinds" in t:
            return FailureCategory.MISSING_SPAN_KIND
        if "importerror" in t or "modulenotfounderror" in t:
            return FailureCategory.SAMPLE_IMPORT_FAILURE
        if "is required" in t or "does not match" in t or "is not of type" in t:
            return FailureCategory.SCHEMA_VIOLATION
    return FailureCategory.UNKNOWN
