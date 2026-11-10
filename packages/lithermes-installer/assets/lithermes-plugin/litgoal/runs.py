"""Terminal runs this process observed: the only proof that can verify `green` evidence.

`post_tool_call` fires after the host ran a tool, outside the model's control, so a
record written there is an observation rather than a claim. Each record is signed
with an HMAC key generated at import and held only in memory: a line the agent
appends to `runs.jsonl` with its own shell, a line copied from another session or
workspace, an edited exit code, and a record written by an earlier process all fail
verification. The file is plain JSONL so a human can read what was cited.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import fingerprint, store

try:
    from ..redaction import redact_text
except (ImportError, ModuleNotFoundError):  # standalone import fallback
    try:
        from redaction import redact_text  # type: ignore
    except (ImportError, ModuleNotFoundError):
        def redact_text(value: str) -> str:  # type: ignore
            return str(value or "")

_KEY = secrets.token_bytes(32)
_LOCK = threading.Lock()
TERMINAL_TOOLS = frozenset({"terminal", "shell", "bash"})
RUN_REF_PREFIX = "run:"
_PREVIEW_MAX = 100
_BACKGROUND_STATUSES = frozenset({"started", "yielded_to_background"})
_BACKGROUND_OUTPUT = "background process started"
_SIGNED_FIELDS = ("id", "tool", "cmd_sha256", "cmd_preview", "exit_code", "at", "fp")


def runs_path(workspace: Path, session_id: Any = "") -> Path:
    return store.state_dir(workspace, session_id) / "runs.jsonl"


def _signature(workspace: Path, session_id: Any, record: dict[str, Any]) -> str:
    body = {
        "workspace": str(Path(workspace).resolve()),
        "session": store.normalize_session_id(session_id),
        **{field: record.get(field) for field in _SIGNED_FIELDS},
    }
    payload = json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hmac.new(_KEY, payload.encode("utf-8"), hashlib.sha256).hexdigest()


def _records(workspace: Path, session_id: Any) -> list[dict[str, Any]]:
    try:
        lines = runs_path(workspace, session_id).read_text(encoding="utf-8").splitlines()
    except (OSError, ValueError):
        return []
    records = []
    for line in lines:
        try:
            item = json.loads(line)
        except ValueError:
            continue
        if isinstance(item, dict):
            records.append(item)
    return records


def _authentic(workspace: Path, session_id: Any, record: dict[str, Any]) -> bool:
    sig = record.get("sig")
    return isinstance(sig, str) and hmac.compare_digest(
        sig, _signature(workspace, session_id, record)
    )


def recent_runs(workspace: Path, session_id: Any = "", limit: int = 5) -> list[dict[str, Any]]:
    """Runs this process signed for the session, oldest first."""
    try:
        records = [r for r in _records(workspace, session_id) if _authentic(workspace, session_id, r)]
    except ValueError:
        return []
    return records[-limit:] if limit > 0 else []


def verify_run(workspace: Path, session_id: Any, ref: str) -> dict[str, Any] | None:
    """The authentic exit-0 record a `run:<id>` ref cites, else None."""
    text = str(ref or "").strip()
    if not text.startswith(RUN_REF_PREFIX):
        return None
    run_id = text[len(RUN_REF_PREFIX):].strip()
    if not run_id:
        return None
    for record in recent_runs(workspace, session_id, limit=1 << 30):
        if record.get("id") == run_id and type(record.get("exit_code")) is int and record["exit_code"] == 0:
            return record
    return None


def _parsed(result: Any) -> dict[str, Any] | None:
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except ValueError:
            return None
    return result if isinstance(result, dict) else None


def _backgrounded(args: dict[str, Any], result: dict[str, Any]) -> bool:
    """A spawn, not a finish: the host answers exit_code 0 the moment a background process starts.

    `tools/terminal_tool_background.py` returns `{"output": "Background process started",
    "session_id", "pid", "exit_code": 0}` (plus `auto_backgrounded` for a converted command), so
    the 0 says nothing about the command itself.
    """
    flag = args.get("background")
    if flag is True or str(flag).strip().lower() in {"true", "1", "yes"}:
        return True
    if any(result.get(key) not in (None, "", False) for key in ("session_id", "pid", "auto_backgrounded")):
        return True
    return (
        str(result.get("status") or "").lower() in _BACKGROUND_STATUSES
        or str(result.get("output") or "").strip().lower() == _BACKGROUND_OUTPUT
    )


def _exit_code(result: dict[str, Any] | None) -> int | None:
    code = result.get("exit_code") if result is not None else None
    return code if type(code) is int else None


_NEXT: dict[tuple[str, str], int] = {}


def _next_number(workspace: Path, session_id: Any) -> int:
    """Run numbers only grow in this process, so truncating runs.jsonl never reissues an id."""
    key = (str(Path(workspace).resolve()), store.normalize_session_id(session_id))
    seen = 0
    for record in _records(workspace, session_id):
        digits = str(record.get("id") or "")[1:]
        seen = max(seen, int(digits) if digits.isdigit() else 0)
    _NEXT[key] = max(_NEXT.get(key, 0), seen) + 1
    return _NEXT[key]


def record_run(
    workspace: Path, session_id: Any, tool_name: str, args: Any, result: Any
) -> str | None:
    """Sign and append one finished terminal run. Returns its id, or None."""
    if str(tool_name or "") not in TERMINAL_TOOLS or not isinstance(args, dict):
        return None
    command = args.get("command")
    parsed = _parsed(result)
    exit_code = _exit_code(parsed)
    if not isinstance(command, str) or exit_code is None or _backgrounded(args, parsed):
        return None
    preview = redact_text(" ".join(command.split()))[:_PREVIEW_MAX]
    try:
        path = runs_path(workspace, session_id)
        store.assert_within_isolation(path)
        # Only a session that has a goal pays for the fingerprint; the walk or git calls
        # run before the lock so a slow capture never delays another session's record.
        fp = fingerprint.capture(workspace) if store.goals_path(workspace, session_id).is_file() else None
        with _LOCK:
            run_id = "R{0:03d}".format(_next_number(workspace, session_id))
            record: dict[str, Any] = {
                "id": run_id,
                "tool": str(tool_name),
                "cmd_sha256": hashlib.sha256(command.encode("utf-8")).hexdigest(),
                "cmd_preview": preview,
                "exit_code": exit_code,
                "at": datetime.now(timezone.utc).isoformat(),
                "fp": fp,
            }
            record["sig"] = _signature(workspace, session_id, record)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    except (OSError, ValueError):
        return None
    return run_id


def _session_workspace():
    """Bound late: the read-only dashboard loads this module by path, where the plugin's workspace module is absent."""
    try:
        from ..workspace import resolve
    except ImportError:  # standalone litgoal tests import this package at top level
        from workspace import resolve  # type: ignore
    return resolve


def observe_tool_call(**kwargs: Any) -> None:
    """`post_tool_call` entry point: record a finished terminal run, never raise."""
    session_id = str(kwargs.get("session_id") or kwargs.get("task_id") or "")
    try:
        resolve_workspace = _session_workspace()
        workspace = resolve_workspace(session_id=kwargs.get("session_id"), task_id=kwargs.get("task_id"))
        if workspace is None:
            return None
        recorded = record_run(
            workspace, session_id, str(kwargs.get("tool_name") or ""),
            kwargs.get("args"), kwargs.get("result"),
        )
        if recorded and store.goals_path(workspace, session_id).is_file():
            from . import runtime  # runtime imports this module, so it is bound late

            runtime.refresh_gate(workspace, session_id)
    except Exception:
        return None
    return None
