from harness.categorize import FailureCategory, categorize


def test_install_failure_from_pip_stderr():
    out = "ERROR: No matching distribution found for traceloop-sdk==9.9.9"
    assert categorize(stage="install", error_text=out) == FailureCategory.INSTALL_FAILURE


def test_no_spans_captured_from_assertion():
    assert (
        categorize(stage="validate", error_text="no spans captured")
        == FailureCategory.NO_SPANS_CAPTURED
    )


def test_schema_violation_from_assertion():
    assert (
        categorize(stage="validate", error_text="is required")
        == FailureCategory.SCHEMA_VIOLATION
    )


def test_sample_import_failure():
    assert (
        categorize(stage="scenario", error_text="ImportError: cannot import name 'Foo'")
        == FailureCategory.SAMPLE_IMPORT_FAILURE
    )


def test_cassette_miss():
    assert (
        categorize(
            stage="scenario",
            error_text="vcr.errors.CannotOverwriteExistingCassetteException",
        )
        == FailureCategory.CASSETTE_MISS
    )


def test_install_stage_does_not_match_scenario_phrases():
    """A pip log that incidentally contains a scenario-stage phrase must not
    be misclassified — install can only emit install-stage categories."""
    assert (
        categorize(stage="install", error_text="ImportError: cannot import name 'x'")
        == FailureCategory.UNKNOWN
    )


def test_scenario_stage_does_not_match_install_phrases():
    assert (
        categorize(stage="scenario", error_text="No matching distribution found")
        == FailureCategory.UNKNOWN
    )
