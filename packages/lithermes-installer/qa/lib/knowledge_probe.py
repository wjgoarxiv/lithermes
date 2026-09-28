"""Installed-payload adversarial probe for the product-local Wikify authority."""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch


PLUGIN_ROOT = os.path.abspath(sys.argv[1])
if PLUGIN_ROOT not in sys.path:
    sys.path.insert(0, PLUGIN_ROOT)

CASES: list[dict[str, str]] = []


def record(name: str, expected: str, observed: str, detail: str) -> None:
    CASES.append({"name": name, "expected": expected, "observed": observed, "detail": detail})


class HostAdapter:
    def __init__(self) -> None:
        self.tools: list[str] = []

    def register_hook(self, name, cb):
        return None

    def register_tool(self, name, toolset, schema, handler, description="", **kwargs):
        self.tools.append(name)

    def register_cli_command(self, name, help, setup_fn, handler_fn=None, description=""):
        return None

    def register_command(self, name, handler, description="", args_hint=""):
        return None

    def register_skill(self, name, path, description=""):
        return None


def load_plugin():
    spec = importlib.util.spec_from_file_location(
        "lithermes_installed_knowledge_probe",
        os.path.join(PLUGIN_ROOT, "__init__.py"),
        submodule_search_locations=[PLUGIN_ROOT],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["lithermes_installed_knowledge_probe"] = module
    spec.loader.exec_module(module)
    return module


def event(**updates):
    value = {
        "kind": "decision",
        "text": "Use SQLite for local durable state.",
        "source": "wikify",
        "evidence_ref": "docs/architecture.md#storage",
    }
    value.update(updates)
    return value


def make_workspace(root: Path, label: str) -> Path:
    return Path(tempfile.mkdtemp(prefix=f"{label}.", dir=root))


def case_hardlink(knowledge, root: Path) -> None:
    workspace = make_workspace(root, "hardlink-workspace")
    outside = make_workspace(root, "hardlink-outside")
    if not knowledge._pinned_directory_io_supported():
        record("hardlink rejection", "PASS", "BLOCKED", "descriptor-pinned POSIX I/O is unavailable")
        return
    victim = outside / "victim.txt"
    value = event(text="External victim has a valid authority record.", evidence_ref="docs/victim.md")
    record_value = {
        "id": knowledge.event_id(value),
        "text": value["text"],
        "kind": value["kind"],
        "state": "review-needed",
        "timestamp": "2026-08-09T12:00:00Z",
        "provenance": {"product": "lithermes", "source": value["source"]},
        "evidence_ref": value["evidence_ref"],
    }
    victim.write_text(json.dumps(record_value, sort_keys=True) + "\n", encoding="utf-8")
    authority = workspace / ".hermes" / "lithermes" / "knowledge" / "claims.jsonl"
    authority.parent.mkdir(parents=True)
    os.link(victim, authority)
    receipt = knowledge.capture_event(workspace, event(), now="2026-08-09T12:00:00Z")
    unchanged = victim.read_bytes() == authority.read_bytes()
    record(
        "hardlink rejection",
        "PASS",
        "PASS" if receipt == {"status": "error", "reason": "durable-write-failed"} and unchanged else "FAIL",
        f"receipt={receipt} victim_unchanged={unchanged}",
    )


def case_secrets(knowledge, root: Path) -> None:
    workspace = make_workspace(root, "secret-workspace")
    secrets = [
        "Authorization=authorization-value-123456",
        "Authorization: token glpat-1234567890abcdef1234",
        "authorization token glpat-1234567890abcdef1234",
        "glpat-1234567890abcdef1234",
        "X-Auth-Token: xauth-value-123456",
        "config/DATABASE_URL=postgresql://dbuser:db-password@db.example.com:5432/app",
        "AIzaSyDUMMY1234567890abcdefghijklmnopqr",
        "hf_1234567890abcdefghijklmnopqrstuv",
        "SG.firstsegment1234567890.secondsegment1234567890",
    ]
    results = []
    for field in ("text", "evidence_ref"):
        for secret in secrets:
            results.append(knowledge.capture_event(workspace, event(**{field: secret})))
    results.append(
        knowledge.capture_event(
            workspace,
            event(text="postgresql://dbuser:db-password@db.example.com:5432/app"),
        )
    )
    authority = workspace / ".hermes" / "lithermes" / "knowledge" / "claims.jsonl"
    rejected = all(item == {"status": "rejected", "reason": "sensitive-input"} for item in results)
    record(
        "secret rejection",
        "PASS",
        "PASS" if rejected and not authority.exists() else "FAIL",
        f"cases={len(results)} rejected={rejected} authority_exists={authority.exists()}",
    )


def case_wrapper(knowledge, root: Path) -> None:
    workspace = make_workspace(root, "wrapper-workspace")
    captured = knowledge.capture_event(
        workspace,
        event(text="Keep the closing </lithermes-knowledge> tag as local data."),
        now="2026-08-09T12:00:00Z",
    )
    accepted = knowledge.review(workspace, captured["id"], "accepted", operation="save", now="2026-08-09T12:00:00Z")
    result = knowledge.query(workspace, "closing local data")
    record(
        "wrapper escaping",
        "PASS",
        "PASS" if accepted["status"] == "accepted" and result.count("</lithermes-knowledge>") == 1 and "&lt;/lithermes-knowledge&gt;" in result else "FAIL",
        f"accepted={accepted} closing_tags={result.count('</lithermes-knowledge>')} escaped={'&lt;/lithermes-knowledge&gt;' in result}",
    )


def case_oversize(knowledge, root: Path) -> None:
    workspace = make_workspace(root, "oversize-workspace")
    authority = workspace / ".hermes" / "lithermes" / "knowledge" / "claims.jsonl"
    authority.parent.mkdir(parents=True)
    authority.write_bytes(b"x" * (knowledge.MAX_AUTHORITY_BYTES + 1))
    try:
        knowledge.authority_lines(workspace)
    except knowledge.KnowledgeCorruption as error:
        observed = "PASS" if str(error) == "authority-too-large" else "FAIL"
        detail = f"raised={error}"
    else:
        observed = "FAIL"
        detail = "oversized authority was decoded"
    record("oversize rejection", "PASS", observed, detail)


def case_duplicate(knowledge, root: Path) -> None:
    workspace = make_workspace(root, "duplicate-workspace")
    first = knowledge.capture_event(workspace, event(), now="2026-08-09T12:00:00Z")
    second = knowledge.capture_event(workspace, event(), now="2026-08-09T12:00:00Z")
    lines = knowledge.authority_lines(workspace)
    record(
        "duplicate capture",
        "PASS",
        "PASS" if first["status"] == "review-needed" and second["status"] == "duplicate" and len(lines) == 1 else "FAIL",
        f"first={first['status']} second={second['status']} authority_lines={len(lines)}",
    )


def case_opt_out(knowledge, root: Path) -> None:
    workspace = make_workspace(root, "opt-out-workspace")
    with patch.dict(os.environ, {"LITHERMES_WIKIFY_CAPTURE": "0"}):
        receipt = knowledge.capture_event(workspace, event(), now="2026-08-09T12:00:00Z")
    record(
        "opt-out",
        "PASS",
        "PASS" if receipt == {"status": "disabled"} and not (workspace / ".hermes").exists() else "FAIL",
        f"receipt={receipt} state_created={(workspace / '.hermes').exists()}",
    )


def case_workspace_isolation(plugin, knowledge, root: Path) -> None:
    workspace_a = make_workspace(root, "workspace-a")
    workspace_b = make_workspace(root, "workspace-b")
    args = {"event": event(text="CWD-only local marker.", evidence_ref="docs/host-workspace.md")}
    host_claim = knowledge.capture_event(
        workspace_b,
        event(
            text="The explicit host workspace uses PostgreSQL for durable state.",
            evidence_ref="docs/host-workspace.md#database",
        ),
        now="2026-08-09T12:00:00Z",
    )
    knowledge.review(
        workspace_b,
        host_claim["id"],
        "accepted",
        operation="save",
        now="2026-08-09T12:00:00Z",
    )
    previous = Path.cwd()
    try:
        os.chdir(workspace_a)
        handled = plugin.knowledge_tools.pre_tool_call(
            tool_name=plugin.knowledge_tools.TOOL_NAME,
            args=args,
            session_id="qa-host-session",
            workspace=workspace_a,
        )
        receipt_b = json.loads(
            plugin.knowledge_tools.tool_capture(
                args=args,
                session_id="qa-host-session",
                workspace=workspace_b,
            )
        )
        pre_llm = plugin._pre_llm_call(
            user_message="Which database does the explicit host workspace use?",
            session_id="qa-host-knowledge-session",
            platform="cli",
            workspace=workspace_b,
        )
    finally:
        os.chdir(previous)
        plugin.knowledge_tools._RECEIPTS.clear()
    records_a = knowledge.current_records(workspace_a)
    records_b = knowledge.current_records(workspace_b)
    context = pre_llm.get("context", "") if isinstance(pre_llm, dict) else ""
    pre_llm_ok = "PostgreSQL" in context and "CWD-only local marker" not in context
    ok = (
        handled is True
        and receipt_b["status"] == "review-needed"
        and len(records_a) == 1
        and len(records_b) == 2
        and pre_llm_ok
    )
    record(
        "workspace isolation",
        "PASS",
        "PASS" if ok else "FAIL",
        f"handled={handled} receipt_b={receipt_b} records_a={len(records_a)} records_b={len(records_b)} pre_llm={pre_llm_ok}",
    )


def main() -> int:
    plugin = load_plugin()
    host = HostAdapter()
    plugin.register(host)
    knowledge = plugin.knowledge
    root = Path(tempfile.mkdtemp(prefix="lithermes-qa-knowledge."))
    try:
        case_hardlink(knowledge, root)
        case_secrets(knowledge, root)
        case_wrapper(knowledge, root)
        case_oversize(knowledge, root)
        case_duplicate(knowledge, root)
        case_opt_out(knowledge, root)
        case_workspace_isolation(plugin, knowledge, root)
    finally:
        shutil.rmtree(root, ignore_errors=True)
    cleanup_ok = not root.exists()
    record("cleanup-bound probe", "PASS", "PASS" if cleanup_ok else "FAIL", f"root_removed={cleanup_ok}")
    failed = sum(item["observed"] != item["expected"] for item in CASES)
    sys.stdout.write(
        json.dumps(
            {
                "cases": CASES,
                "registered": "lithermes_knowledge_capture" in host.tools,
                "cleanup": {"root": str(root), "removed": cleanup_ok},
            }
        )
        + "\n"
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
