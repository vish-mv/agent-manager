"""Google Chat alert message builder.

Mirrors the shape `traceloop-release-watch.yaml` already uses: a Chat webhook
accepts a plain `{"text": "..."}` payload. The nightly workflow posts this to
a secret-held webhook URL — failure-only, quiet on success.
"""
from __future__ import annotations


def build_chat_message(
    *,
    run_url: str,
    issue_url: str | None,
    counts: dict[str, int],
    categories: dict[str, int],
    likely_cause: str | None,
) -> dict:
    lines = [
        "🔴 Instrumentation matrix — nightly run failed",
        f"Run: {run_url}",
    ]
    if issue_url:
        lines.append(f"Issue: {issue_url}")
    lines += [
        "",
        "Summary",
        f"  • {counts.get('fail', 0)} failed / "
        f"{counts.get('pass', 0)} passed / "
        f"{counts.get('skipped', 0)} skipped",
    ]
    if likely_cause:
        lines.append(f"  • Likely cause: {likely_cause}")
    if categories:
        lines += ["", "Top failing categories"]
        for cat, n in sorted(categories.items(), key=lambda kv: -kv[1]):
            lines.append(f"  • {cat}: {n}")
    return {"text": "\n".join(lines)}
