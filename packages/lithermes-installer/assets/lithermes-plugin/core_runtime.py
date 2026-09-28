from __future__ import annotations

import importlib
import json
import os
import re
import shlex
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

try:
    from .redaction import redact_obj, redact_text
except (ImportError, ModuleNotFoundError):
    from redaction import redact_obj, redact_text

MAX_TASK_LEN = 4000
_SLUG_PATTERN = re.compile(r"[^a-z0-9]+")

try:
    get_hermes_home = importlib.import_module("hermes_constants").get_hermes_home
except Exception:
    import os

    def get_hermes_home() -> Path:
        val = (os.environ.get("HERMES_HOME") or "").strip()
        return Path(val).expanduser() if val else Path.home() / ".hermes"


# Durable litgoal runtime state lives under <workspace>/.hermes/lithermes/<dir>.
# This constant anchors every litgoal state path (goals/ledger/evidence).
LITGOAL_STATE_DIRNAME = "litgoal"

@dataclass(frozen=True)
class CommandArgs:
    positional: list[str]
    options: dict[str, str | bool]

def slugify(text: str, fallback: str = "lithermes-plan") -> str:
    lowered = text.strip().lower()
    slug = _SLUG_PATTERN.sub("-", lowered).strip("-")
    return (slug[:60].strip("-") or fallback)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def run_id(prefix: str = "run") -> str:
    return f"{prefix}-{utc_now().strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"


def parse_args(raw_args: str) -> CommandArgs:
    try:
        tokens = shlex.split(raw_args or "")
    except ValueError as exc:
        raise ValueError(f"could not parse arguments: {exc}") from exc

    positional: list[str] = []
    options: dict[str, str | bool] = {}
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if not token.startswith("--"):
            positional.append(token)
            i += 1
            continue

        key_value = token[2:]
        if not key_value:
            i += 1
            continue
        if "=" in key_value:
            key, value = key_value.split("=", 1)
            options[key] = value
            i += 1
            continue
        key = key_value
        if i + 1 < len(tokens) and not tokens[i + 1].startswith("--"):
            options[key] = tokens[i + 1]
            i += 2
        else:
            options[key] = True
            i += 1

    return CommandArgs(positional=positional, options=options)


def workspace_from_option(value: str | bool | None) -> Path:
    if isinstance(value, str) and value.strip():
        return Path(value).expanduser().resolve()
    return Path.cwd().resolve()


def plan_dir(workspace: Path) -> Path:
    return workspace / "plans"


def lithermes_dir(workspace: Path) -> Path:
    return workspace / ".hermes" / "lithermes"


def event_log_path() -> Path:
    return get_hermes_home() / "lithermes" / "events.jsonl"


class IsolationViolation(RuntimeError):
    """A durable write escaped the declared isolation root."""


# Set LITHERMES_ISOLATED_ROOT=<abs path> to declare "every durable write this
# process makes must land under here". Any append that resolves outside raises
# instead of silently succeeding.
#
# Why this lives at the EMITTER and not in each probe: the event ledger resolves
# its own path from HERMES_HOME/HOME (`get_hermes_home`, which the Hermes host
# owns in production), not from whatever workspace a caller passed. A probe can
# isolate the workspace perfectly — the plan artifact lands in a temp dir — while
# the ledger write still goes to the operator's real profile. That happened in
# this repo twice, from two different call sites, each fixed per-probe. One guard
# at the single write primitive covers every call site that exists now and every
# one added later.
#
# Inert in production: with the variable unset this is a no-op and behaviour is
# unchanged. It is the probe harness that sets it, once, for all probes.
_ISOLATED_ROOT_ENV = "LITHERMES_ISOLATED_ROOT"


def isolated_root() -> Path | None:
    raw = (os.environ.get(_ISOLATED_ROOT_ENV) or "").strip()
    if not raw:
        return None
    try:
        return Path(raw).expanduser().resolve()
    except OSError:
        return None


def assert_within_isolation(path: Path) -> None:
    """Raise IsolationViolation when `path` escapes a declared isolation root."""
    root = isolated_root()
    if root is None:
        return
    try:
        resolved = Path(path).expanduser().resolve()
    except OSError:
        resolved = Path(path)
    try:
        resolved.relative_to(root)
    except ValueError:
        raise IsolationViolation(
            "refusing to write outside the declared isolation root.\n"
            "  target : {0}\n"
            "  root   : {1}\n"
            "  {2} is set, so this write would have escaped the sandbox. "
            "The emitter resolves its own path from HERMES_HOME/HOME; isolating a "
            "workspace is not enough.".format(resolved, root, _ISOLATED_ROOT_ENV)
        )


def append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    assert_within_isolation(path)
    payload = redact_obj(payload)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, sort_keys=True) + "\n")


def record_event(event: str, **fields: Any) -> None:
    payload = {
        "event": event,
        "timestamp": utc_now().isoformat(),
        **fields,
    }
    try:
        append_jsonl(event_log_path(), payload)
    except OSError:
        pass


_REMOTE_REF_RE = re.compile(r"https?://[^\s,;\"'<>]+", re.IGNORECASE)


def _redact_local_only_preview(value: Any) -> str:
    """Small local-only diagnostic preview for event metadata.

    Delegate batch events must never become remote telemetry. Keep the preview
    bounded, secret-redacted, and URL-redacted so audit logs prove intent without
    preserving endpoints or pasted secret-bearing child context.
    """
    text = json.dumps(redact_obj(value), sort_keys=True) if not isinstance(value, str) else redact_text(value)
    text = _REMOTE_REF_RE.sub("[REDACTED_URL]", text)
    return text[:1000]


def record_delegate_batch_intent(
    *,
    workspace: Path,
    mode: str,
    lanes: Iterable[str],
    session_id: str = "",
    context: Any = None,
) -> dict[str, Any]:
    """Record a local, redacted intent event for a Hermes delegate_task batch.

    This is evidence only: it does not orchestrate workers, create persistent
    teams, or send telemetry anywhere. Hermes performs the actual short
    parallel work asynchronously and re-enters each child result separately; the parent owns receipt tracking, merging, and batch completion.
    """
    rid = run_id("lithermes")
    batch_id = run_id("delegate-batch")
    lane_list = [str(lane) for lane in lanes]
    artifact_dir = lithermes_dir(workspace) / "runs" / rid / "delegate_batches" / batch_id
    payload = {
        "event": "delegate_batch_intent",
        "timestamp": utc_now().isoformat(),
        "session_id": session_id,
        "run_id": rid,
        "batch_id": batch_id,
        "mode": mode,
        "lanes": lane_list,
        "artifact_dir": str(artifact_dir) + "/",
    }
    if context is not None:
        payload["context_preview"] = _redact_local_only_preview(context)
    try:
        artifact_dir.mkdir(parents=True, exist_ok=True)
        (artifact_dir / "summary.json").write_text(
            json.dumps(redact_obj(payload), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    except OSError:
        pass
    try:
        append_jsonl(event_log_path(), payload)
    except OSError:
        pass
    return redact_obj(payload)

def _clamp_task(task: str) -> str:
    """Bound a triggered task before it enters route context or run-state.

    A pasted multi-thousand-char prompt would otherwise inflate the injected
    LIT_CONTEXT and the persisted run-state. Clamp to MAX_TASK_LEN chars.
    """
    task = redact_text(task).strip()
    if len(task) > MAX_TASK_LEN:
        return task[:MAX_TASK_LEN].rstrip() + " […]"
    return task
