from harness.categorize import FailureCategory
from heavy.diagnostics import Evidence, classify_no_spans


def test_boundary_categories_exist():
    assert FailureCategory.INGEST_REJECTED.value == "ingest-rejected"
    assert FailureCategory.EXPORT_FAILED.value == "export-failed"
    assert FailureCategory.COLLECTOR_NOT_RECEIVED.value == "collector-not-received"


def test_classify_ingest_rejected_on_401():
    ev = Evidence(agent_init="ok", agent_export_status=401, agent_export_error="401 Unauthorized")
    assert classify_no_spans(ev) is FailureCategory.INGEST_REJECTED


def test_classify_ingest_rejected_on_403():
    ev = Evidence(agent_init="ok", agent_export_status=403)
    assert classify_no_spans(ev) is FailureCategory.INGEST_REJECTED


def test_classify_export_failed_on_init_failure():
    ev = Evidence(agent_init="failed")
    assert classify_no_spans(ev) is FailureCategory.EXPORT_FAILED


def test_classify_export_failed_on_5xx():
    ev = Evidence(agent_init="ok", agent_export_status=503, agent_export_error="503")
    assert classify_no_spans(ev) is FailureCategory.EXPORT_FAILED


def test_classify_export_failed_on_error_without_status():
    ev = Evidence(agent_init="ok", agent_export_error="connection refused")
    assert classify_no_spans(ev) is FailureCategory.EXPORT_FAILED


def test_classify_collector_not_received_when_agent_ok_but_collector_empty():
    ev = Evidence(agent_init="ok", collector_received=False)
    assert classify_no_spans(ev) is FailureCategory.COLLECTOR_NOT_RECEIVED


def test_classify_falls_back_to_no_spans_when_inconclusive():
    assert classify_no_spans(Evidence()) is FailureCategory.NO_SPANS_CAPTURED
