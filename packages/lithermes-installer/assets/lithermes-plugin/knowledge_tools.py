"""Hermes tool and hook adapter for structured Wikify knowledge events."""

from __future__ import annotations

import hashlib
import json
import os
from collections import OrderedDict
from pathlib import Path
from typing import Any

from . import knowledge


TOOL_NAME = "lithermes_knowledge_capture"
TOOLSET = "lithermes-knowledge"
_RECEIPTS: OrderedDict[str, dict[str, str]] = OrderedDict()
_MAX_RECEIPTS = 64
_HOST_WORKSPACE_KEY = "workspace"


def _workspace_from_kwargs(kwargs: dict[str, Any]) -> Path | None:
    if _HOST_WORKSPACE_KEY not in kwargs:
        return Path.cwd()
    value = kwargs.get(_HOST_WORKSPACE_KEY)
    if not isinstance(value, (str, os.PathLike)):
        return None
    raw = os.fsdecode(os.fspath(value)).strip()
    return Path(raw) if raw else None


def _session_identity(kwargs: dict[str, Any]) -> str:
    return str(kwargs.get("session_id") or kwargs.get("task_id") or "")


def _workspace_identity(workspace: Path) -> str:
    try:
        return str(knowledge._canonical_workspace(workspace))
    except (OSError, ValueError):
        return str(workspace.absolute())


def _event_key(event: object, *, workspace: Path, session_id: str) -> str:
    encoded = json.dumps(
        {
            "event": event,
            "session_id": session_id,
            "workspace": _workspace_identity(workspace),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def pre_tool_call(**kwargs: Any) -> bool:
    if str(kwargs.get("tool_name") or "") != TOOL_NAME:
        return False
    args = kwargs.get("args")
    event = args.get("event") if isinstance(args, dict) else None
    workspace = _workspace_from_kwargs(kwargs)
    session_id = _session_identity(kwargs)
    if workspace is None:
        return True
    receipt = knowledge.capture_event(workspace, event)
    key = _event_key(event, workspace=workspace, session_id=session_id)
    _RECEIPTS[key] = receipt
    _RECEIPTS.move_to_end(key)
    while len(_RECEIPTS) > _MAX_RECEIPTS:
        _RECEIPTS.popitem(last=False)
    return True


def tool_capture(args: dict | None = None, **kwargs: Any) -> str:
    payload = args if isinstance(args, dict) else {}
    event = payload.get("event")
    workspace = _workspace_from_kwargs(kwargs)
    session_id = _session_identity(kwargs)
    if workspace is None:
        return json.dumps({"status": "error", "reason": "workspace-unavailable"}, ensure_ascii=True, sort_keys=True)
    receipt = _RECEIPTS.pop(
        _event_key(event, workspace=workspace, session_id=session_id),
        None,
    )
    if receipt is None:
        receipt = knowledge.capture_event(workspace, event)
    return json.dumps(receipt, ensure_ascii=True, sort_keys=True)


TOOL_SPEC = {
    "name": TOOL_NAME,
    "toolset": TOOLSET,
    "description": (
        "Capture one already-structured local Wikify event as review-needed. "
        "Never submit chat, source bodies, fetched text, credentials, secrets, tokens, "
        "or instruction-shaped text. Acceptance requires an explicit knowledge save or review command."
    ),
    "handler": tool_capture,
    "schema": {
        "type": "object",
        "properties": {
            "event": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": sorted(knowledge.KINDS)},
                    "text": {"type": "string", "maxLength": knowledge.TEXT_MAX_BYTES},
                    "source": {"type": "string", "enum": sorted(knowledge.SOURCES)},
                    "evidence_ref": {"type": "string", "maxLength": knowledge.EVIDENCE_MAX_BYTES},
                },
                "required": ["kind", "text", "source", "evidence_ref"],
                "additionalProperties": False,
            }
        },
        "required": ["event"],
        "additionalProperties": False,
    },
}


def register_tools(ctx) -> list[str]:
    ctx.register_tool(
        name=TOOL_SPEC["name"],
        toolset=TOOL_SPEC["toolset"],
        schema=TOOL_SPEC["schema"],
        handler=TOOL_SPEC["handler"],
        description=TOOL_SPEC["description"],
    )
    return [TOOL_NAME]
