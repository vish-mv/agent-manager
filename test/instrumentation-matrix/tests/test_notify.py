import json

from harness.notify import build_chat_message


def test_chat_message_includes_counts_and_run_link():
    msg = build_chat_message(
        run_url="https://github.com/wso2/agent-manager/actions/runs/123",
        issue_url="https://github.com/wso2/agent-manager/issues/456",
        counts={"pass": 92, "fail": 4, "skipped": 4},
        categories={"schema-violation": 3, "pipeline-error": 1},
        likely_cause="Traceloop 0.61.0 regression — all langchain cells red",
    )
    text = json.dumps(msg)
    assert "4 failed" in text and "92 passed" in text
    assert "Traceloop 0.61.0" in text
    assert "runs/123" in text and "issues/456" in text


def test_chat_message_omits_issue_when_absent():
    msg = build_chat_message(
        run_url="https://example/runs/1",
        issue_url=None,
        counts={"pass": 1, "fail": 1, "skipped": 0},
        categories={},
        likely_cause=None,
    )
    text = json.dumps(msg)
    assert "Issue:" not in text
    assert "Likely cause" not in text


def test_chat_message_orders_categories_by_count_desc():
    msg = build_chat_message(
        run_url="https://example/runs/1",
        issue_url=None,
        counts={"pass": 0, "fail": 5, "skipped": 0},
        categories={"schema-violation": 1, "pipeline-error": 3, "install-failure": 1},
        likely_cause=None,
    )
    text = msg["text"]
    assert text.index("pipeline-error") < text.index("schema-violation")
    assert text.index("pipeline-error") < text.index("install-failure")
