"""Path resolution + atomic persistence for the litgoal durable runtime."""

from __future__ import annotations

import json
import os
import tempfile
from json import JSONDecodeError
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import model

# Anchor every litgoal path under the constant declared in core (dual-context).
try:  # installed as lithermes.litgoal.store
    from ..core import LITGOAL_STATE_DIRNAME
except (ImportError, ModuleNotFoundError):  # pragma: no cover - standalone import fallback
    try:
        from core import LITGOAL_STATE_DIRNAME  # type: ignore
    except (ImportError, ModuleNotFoundError):
        LITGOAL_STATE_DIRNAME = "litgoal"

try:
    from ..redaction import redact_obj
except (ImportError, ModuleNotFoundError):  # pragma: no cover - standalone import fallback
    try:
        from redaction import redact_obj  # type: ignore
    except (ImportError, ModuleNotFoundError):
        def redact_obj(value):  # type: ignore
            return value

# The second append primitive in the payload. Guarded for the same reason as
# core_runtime.append_jsonl: a caller that hands this an absolute path resolved
# from the environment would write outside a declared isolation root.
try:
    from ..core_runtime import assert_within_isolation
except (ImportError, ModuleNotFoundError):  # pragma: no cover - standalone import fallback
    try:
        from core_runtime import assert_within_isolation  # type: ignore
    except (ImportError, ModuleNotFoundError):
        def assert_within_isolation(path):  # type: ignore
            return None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# One ledger file, one vocabulary. Every entry written here is stamped with this
# schema id and uses `kind` as its event-type field. The run ledger
# (`.hermes/lithermes/runs/<id>/ledger.jsonl`) is a DIFFERENT file with a
# different id and an `event` field — see core_runs.RUN_LEDGER_SCHEMA.
LEDGER_SCHEMA = "lithermes.litgoal.ledger/v1"
LEDGER_KINDS = (
    "goal_created",
    "criterion_added",
    "criterion_status",
    "criterion_retry",
    "evidence_added",
    "checkpoint",
    "steer",
    "steering_rejected",
    "review_blocker",
    "review_blocker_resolved",
    "goal_status",
    "goal_completed",
)

_SESSION_SUBDIR = "sessions"
_SESSION_ID_SAFE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"


def normalize_session_id(session_id: Any) -> str:
    """Reject a session id that could escape the state directory.

    A session id becomes a path segment, so `..`, separators, and empty strings
    are refused rather than sanitized — silently rewriting an id would make two
    different sessions share one state file, which is the bug being fixed.
    """
    raw = str(session_id or "").strip()
    if not raw:
        return ""
    if len(raw) > 96 or any(char not in _SESSION_ID_SAFE for char in raw):
        raise ValueError(
            "invalid session id {0!r}: use letters, digits, dot, dash, or underscore "
            "(max 96 chars)".format(raw)
        )
    if raw in (".", "..") or raw.startswith("."):
        raise ValueError("invalid session id {0!r}: must not start with a dot".format(raw))
    return raw


def state_dir(workspace: Path, session_id: Any = "") -> Path:
    """Durable root for one litgoal aggregate.

    With no session id this is the legacy path, so existing state keeps loading.
    With one it is `.../litgoal/sessions/<id>/`, mirroring the reference layout
    (`.<product>/lit-loop/<sessionId>/`) so new work opens new state instead of
    writing into a finished aggregate.
    """
    base = Path(workspace) / ".hermes" / "lithermes" / LITGOAL_STATE_DIRNAME
    session = normalize_session_id(session_id)
    return base / _SESSION_SUBDIR / session if session else base


def list_sessions(workspace: Path) -> list[str]:
    root = Path(workspace) / ".hermes" / "lithermes" / LITGOAL_STATE_DIRNAME / _SESSION_SUBDIR
    try:
        return sorted(item.name for item in root.iterdir() if (item / "goals.json").is_file())
    except OSError:
        return []


def goals_path(workspace: Path, session_id: Any = "") -> Path:
    return state_dir(workspace, session_id) / "goals.json"


def ledger_path(workspace: Path, session_id: Any = "") -> Path:
    return state_dir(workspace, session_id) / "ledger.jsonl"


def evidence_dir(workspace: Path, session_id: Any = "") -> Path:
    return state_dir(workspace, session_id) / "evidence"


def attempt_evidence_dir(workspace: Path, criterion_id: str, attempt: int, session_id: Any = "") -> Path:
    """Per-attempt artifact directory, so a retry cannot overwrite prior proof."""
    safe = normalize_session_id(criterion_id) or "unknown"
    return evidence_dir(workspace, session_id) / safe / "attempt-{0:03d}".format(max(1, int(attempt)))


def brief_path(workspace: Path, session_id: Any = "") -> Path:
    return state_dir(workspace, session_id) / "brief.md"


def _mapping(
    value: Any, location: str, keys: set[str], required: set[str] | None = None
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{location} must be an object")
    unknown = set(value) - keys
    if unknown:
        raise ValueError(f"{location} has unknown fields: {sorted(unknown)}")
    missing = (required or set()) - set(value)
    if missing:
        raise ValueError(f"{location} is missing required fields: {sorted(missing)}")
    return value


def _string_field(value: dict[str, Any], key: str, location: str) -> None:
    if key in value and not isinstance(value[key], str):
        raise ValueError(f"{location}.{key} must be a string")


def _id_field(value: dict[str, Any], key: str, location: str) -> str:
    _string_field(value, key, location)
    identifier = value[key]
    if not identifier:
        raise ValueError(f"{location}.{key} must be non-empty")
    return identifier


def _positive_int_field(value: dict[str, Any], key: str, location: str) -> None:
    if key not in value:
        return
    candidate = value[key]
    if isinstance(candidate, bool) or not isinstance(candidate, int) or candidate < 1:
        raise ValueError(f"{location}.{key} must be a positive integer")


def _list_field(value: dict[str, Any], key: str, location: str) -> list[Any]:
    candidate = value.get(key, [])
    if not isinstance(candidate, list):
        raise ValueError(f"{location}.{key} must be a list")
    return candidate


def _validate_evidence(value: Any, location: str) -> None:
    item = _mapping(
        value,
        location,
        {"kind", "ref", "detail", "at", "attempt"},
        {"kind", "ref"},
    )
    for key in ("kind", "ref", "detail", "at"):
        _string_field(item, key, location)
    if item.get("kind", "note") not in model.EVIDENCE_KINDS:
        raise ValueError(f"{location}.kind is invalid")
    _positive_int_field(item, "attempt", location)


def _validate_criterion(value: Any, location: str) -> str:
    item = _mapping(
        value,
        location,
        {"id", "scenario", "qa_channel", "test_ref", "status", "attempt", "evidence"},
        {"id", "scenario", "status", "evidence"},
    )
    for key in ("id", "scenario", "qa_channel", "test_ref", "status"):
        _string_field(item, key, location)
    if item.get("status", "pending") not in model.CRITERION_STATUSES:
        raise ValueError(f"{location}.status is invalid")
    _positive_int_field(item, "attempt", location)
    for index, evidence in enumerate(_list_field(item, "evidence", location)):
        _validate_evidence(evidence, f"{location}.evidence[{index}]")
    return _id_field(item, "id", location)


def _validate_checkpoint(value: Any, location: str) -> str:
    item = _mapping(
        value,
        location,
        {"id", "at", "summary", "active_criterion"},
        {"id", "at", "summary"},
    )
    for key in ("id", "at", "summary", "active_criterion"):
        _string_field(item, key, location)
    return _id_field(item, "id", location)


def _validate_steering(value: Any, location: str) -> str:
    item = _mapping(
        value,
        location,
        {"id", "at", "directive", "kind", "evidence", "rationale", "applied"},
        {"id", "at", "directive", "kind"},
    )
    for key in ("id", "at", "directive", "kind", "evidence", "rationale", "applied"):
        _string_field(item, key, location)
    if item.get("kind", "redirect") not in model.STEERING_KINDS:
        raise ValueError(f"{location}.kind is invalid")
    return _id_field(item, "id", location)


def _validate_review_blocker(value: Any, location: str) -> str:
    item = _mapping(
        value,
        location,
        {"id", "detail", "resolved"},
        {"id", "detail", "resolved"},
    )
    for key in ("id", "detail"):
        _string_field(item, key, location)
    if not isinstance(item["resolved"], bool):
        raise ValueError(f"{location}.resolved must be a boolean")
    return _id_field(item, "id", location)


def _validate_goal(value: Any, location: str) -> str:
    item = _mapping(
        value,
        location,
        {
            "id", "objective", "title", "status", "criteria", "checkpoints",
            "steering", "review_blockers",
        },
        {"id", "objective", "status", "criteria", "review_blockers"},
    )
    for key in ("id", "objective", "title", "status"):
        _string_field(item, key, location)
    if item.get("status", "active") not in model.GOAL_STATUSES:
        raise ValueError(f"{location}.status is invalid")
    criterion_ids = [
        _validate_criterion(criterion, f"{location}.criteria[{index}]")
        for index, criterion in enumerate(_list_field(item, "criteria", location))
    ]
    if len(criterion_ids) != len(set(criterion_ids)):
        raise ValueError(f"{location}.criteria contains duplicate ids")
    checkpoint_ids = [
        _validate_checkpoint(checkpoint, f"{location}.checkpoints[{index}]")
        for index, checkpoint in enumerate(_list_field(item, "checkpoints", location))
    ]
    if len(checkpoint_ids) != len(set(checkpoint_ids)):
        raise ValueError(f"{location}.checkpoints contains duplicate ids")
    steering_ids = [
        _validate_steering(steering, f"{location}.steering[{index}]")
        for index, steering in enumerate(_list_field(item, "steering", location))
    ]
    if len(steering_ids) != len(set(steering_ids)):
        raise ValueError(f"{location}.steering contains duplicate ids")
    blocker_ids = [
        _validate_review_blocker(blocker, f"{location}.review_blockers[{index}]")
        for index, blocker in enumerate(_list_field(item, "review_blockers", location))
    ]
    if len(blocker_ids) != len(set(blocker_ids)):
        raise ValueError(f"{location}.review_blockers contains duplicate ids")
    return _id_field(item, "id", location)


def _validate_state(value: Any) -> None:
    state = _mapping(
        value,
        "state",
        {"version", "created_at", "updated_at", "active_goal_id", "goals"},
        {"version", "active_goal_id", "goals"},
    )
    version = state["version"]
    if isinstance(version, bool) or not isinstance(version, int) or version != model.STATE_VERSION:
        raise ValueError(f"state.version must equal {model.STATE_VERSION}")
    for key in ("created_at", "updated_at", "active_goal_id"):
        _string_field(state, key, "state")
    goal_ids = [
        _validate_goal(goal, f"state.goals[{index}]")
        for index, goal in enumerate(_list_field(state, "goals", "state"))
    ]
    if len(goal_ids) != len(set(goal_ids)):
        raise ValueError("state.goals contains duplicate ids")
    active_goal_id = state["active_goal_id"]
    if (goal_ids and active_goal_id not in goal_ids) or (not goal_ids and active_goal_id):
        raise ValueError("state.active_goal_id does not identify a stored goal")


def load_or_create(workspace: Path, session_id: Any = "") -> model.LitgoalState:
    path = goals_path(workspace, session_id)
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except JSONDecodeError as exc:
            raise ValueError(f"malformed litgoal state at {path}: {exc}") from exc
        try:
            _validate_state(data)
        except ValueError as exc:
            raise ValueError(f"malformed litgoal state at {path}: {exc}") from exc
        return model.LitgoalState.from_dict(data)
    return model.LitgoalState(created_at=_utc_now(), updated_at=_utc_now())


def save(workspace: Path, state: model.LitgoalState, session_id: Any = "") -> None:
    state.updated_at = _utc_now()
    if not state.created_at:
        state.created_at = state.updated_at
    target = goals_path(workspace, session_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(model.to_dict(state), indent=2, sort_keys=False, ensure_ascii=False)
    # Atomic: write to a temp file in the same dir, fsync, then os.replace.
    fd, tmp_name = tempfile.mkstemp(dir=str(target.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, target)
        # Best-effort: fsync the parent directory so the rename is durable.
        try:
            dir_fd = os.open(str(target.parent), os.O_RDONLY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except (OSError, PermissionError):
            pass  # platforms that disallow dir-fsync degrade silently
    finally:
        if os.path.exists(tmp_name):
            os.remove(tmp_name)


def append_ledger(workspace: Path, event: dict[str, Any], session_id: Any = "") -> None:
    path = ledger_path(workspace, session_id)
    assert_within_isolation(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    entry = redact_obj({"schema": LEDGER_SCHEMA, "at": _utc_now(), **event})
    # NOTE: ledger appends are best-effort append-durable; no fsync here to keep
    # high-frequency event writes cheap. Data loss on crash is limited to the
    # last unflushed entry; goals.json (the source of truth) is fsync-durable.
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
