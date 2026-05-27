"""Map stage + error text to a categorical failure label.

The aggregator counts by category so triage starts with "what kind of failure
am I looking at" rather than "which cell". Keep the substring matches narrow
and case-insensitive; broaden only when a real failure surfaces a phrasing the
classifier missed.
"""
from __future__ import annotations

from enum import Enum


class FailureCategory(str, Enum):
    INSTALL_FAILURE = "install-failure"
    SAMPLE_IMPORT_FAILURE = "sample-import-failure"
    NO_SPANS_CAPTURED = "no-spans-captured"
    MISSING_SPAN_KIND = "missing-span-kind"
    SCHEMA_VIOLATION = "schema-violation"
    CASSETTE_MISS = "cassette-miss"
    PIPELINE_ERROR = "pipeline-error"
    INFRA_ERROR = "infra-error"
    UNKNOWN = "unknown"


def categorize(stage: str, error_text: str) -> FailureCategory:
    t = error_text.lower()
    if stage == "install":
        if "no matching distribution" in t or "could not find a version" in t:
            return FailureCategory.INSTALL_FAILURE
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
