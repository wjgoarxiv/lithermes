"""Test-weakening guard: a goal's test files may not quietly get weaker.

`goal_set` snapshots every test file in the workspace (test functions, assert
statements, skip/xfail/only markers). Each gate evaluation scans again; a file that
lost tests or asserts, gained a skip marker, or was deleted raises a review blocker
whose source is `testguard`. The blocker is derived from the scan, so it clears by
itself when the file is restored, and nothing the model can call resolves it:
only the user's `/lit-accept-tests <reason>` accepts the change and re-baselines.

Scans are bounded (file count, file size, walk size, a wall-clock budget) and use per-line
regexes with no nested quantifiers, so a hostile workspace cannot stall the gate. A baselined file
that exists but can no longer be scanned (a symlink now, over the size cap, unreadable, or not
reached before the budget ran out) is reported like a weakened one: unverified is never "fine",
and the blocker clears only once a scan can see the file again.
"""

from __future__ import annotations

import json
import os
import re
import stat
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import model, store

try:
    from ..redaction import redact_text
except (ImportError, ModuleNotFoundError):  # standalone import fallback
    try:
        from redaction import redact_text  # type: ignore
    except (ImportError, ModuleNotFoundError):
        def redact_text(value: str) -> str:  # type: ignore
            return str(value or "")

SOURCE = "testguard"
MAX_FILES = 2000
MAX_ENTRIES = 50000
MAX_BYTES = 1 << 20
SCAN_BUDGET = 5.0  # seconds; the host cuts a hook off at 30 s and then fails open
MAX_REPORTED = 3
SKIP_DIRS = frozenset(
    {"node_modules", "venv", "__pycache__", "dist", "build", "site-packages", "target", "coverage"}
)
_PY_FILE = re.compile(r"^(?:test_.+|.+_test)\.py$")
_JS_FILE = re.compile(r"^.+\.(?:test|spec)\.[cm]?[jt]sx?$")
_PY = (
    re.compile(r"^\s*(?:async\s+)?def\s+test_"),
    re.compile(r"^\s*assert\b|\bself\.assert[A-Za-z]*\("),
    re.compile(r"@pytest\.mark\.(?:skip|xfail)|\bpytest\.(?:skip|xfail)\(|@unittest\.skip|\bself\.skipTest\("),
)
_JS = (
    re.compile(r"(?<![\w.$])(?:it|test)\s*\("),
    re.compile(r"(?<![\w.$])(?:expect|assert)\s*\(|\bassert\.\w+\s*\("),
    re.compile(r"\.(?:skip|only)\s*\(|(?<![\w.$])(?:xit|xtest|xdescribe)\s*\("),
)
_PY_COMMENT = ("#",)
_JS_COMMENT = ("//", "/*", "*")
_COUNTERS = ("tests", "asserts", "skips")


def baseline_path(workspace: Path, session_id: Any = "") -> Path:
    return store.state_dir(workspace, session_id) / "testguard.json"


def _count(text: str, rules: tuple[re.Pattern[str], ...], comments: tuple[str, ...]) -> dict[str, int]:
    counts = dict.fromkeys(_COUNTERS, 0)
    for line in text.splitlines():
        if line.lstrip().startswith(comments):
            continue
        for name, rule in zip(_COUNTERS, rules):
            counts[name] += len(rule.findall(line))
    return counts


def _read(path: Path) -> str | None:
    """The file's text, or None for a symlink, a non-regular file, an oversized or unreadable one."""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        return None
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_BYTES:
            return None
        with os.fdopen(descriptor, "rb", closefd=False) as handle:
            data = handle.read(MAX_BYTES + 1)
    except OSError:
        return None
    finally:
        os.close(descriptor)
    return None if len(data) > MAX_BYTES else data.decode("utf-8", errors="replace")


def _scan(workspace: Path, budget: float | None = None) -> tuple[dict[str, dict[str, int]], bool]:
    """(counts per test file, whether the time budget ran out), bounded and in a stable order."""
    found: dict[str, dict[str, int]] = {}
    seen = 0
    root = Path(workspace)
    deadline = time.monotonic() + (SCAN_BUDGET if budget is None else budget)
    for current, dirs, names in os.walk(root):
        dirs[:] = sorted(d for d in dirs if not d.startswith(".") and d not in SKIP_DIRS)
        for name in sorted(names):
            seen += 1
            if seen > MAX_ENTRIES or len(found) >= MAX_FILES:
                return found, False
            python = _PY_FILE.match(name)
            if not (python or _JS_FILE.match(name)):
                continue
            if time.monotonic() >= deadline:
                return found, True
            path = Path(current) / name
            text = _read(path)
            if text is None:
                continue
            rules, comments = (_PY, _PY_COMMENT) if python else (_JS, _JS_COMMENT)
            found[path.relative_to(root).as_posix()] = _count(text, rules, comments)
    return found, False


def scan(workspace: Path) -> dict[str, dict[str, int]]:
    """Counts for every test file under `workspace`, bounded and in a stable order."""
    return _scan(workspace)[0]


def _plural(count: int, word: str) -> str:
    return f"{count} {word}" + ("" if count == 1 else "s")


def _describe(path: str, was: dict[str, int], now: dict[str, int]) -> str:
    lost = [
        _plural(was.get(key, 0) - now.get(key, 0), word)
        for key, word in (("tests", "test"), ("asserts", "assertion"))
        if now.get(key, 0) < was.get(key, 0)
    ]
    gained = now.get("skips", 0) - was.get("skips", 0)
    parts = (["lost " + " and ".join(lost)] if lost else []) + (
        [f"gained {_plural(gained, 'skip')}"] if gained > 0 else []
    )
    return f"{path} {' and '.join(parts)} since the goal started" if parts else ""


def violations(workspace: Path, baseline: dict[str, dict[str, int]]) -> list[str]:
    """One sentence per test file that got weaker than `baseline` or can no longer be checked."""
    current, timed_out = _scan(workspace)
    found = []
    for path in sorted(baseline):
        if path in current:
            sentence = _describe(path, baseline[path], current[path])
            if sentence:
                found.append(sentence)
        elif not os.path.lexists(Path(workspace) / path):
            found.append(f"{path} was deleted since the goal started")
        elif timed_out:
            found.append(f"{path} could not be scanned in time, so its tests are unverified")
        else:
            found.append(
                f"{path} can no longer be scanned (a symlink now, over the size limit, or unreadable), "
                "so its tests are unverified"
            )
    return found


def _load(workspace: Path, session_id: Any) -> dict[str, Any]:
    try:
        data = json.loads(baseline_path(workspace, session_id).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _stricter(old: dict[str, int], new: dict[str, int]) -> dict[str, int]:
    """Per-counter strictest of two baselines: more tests and asserts, fewer skips."""
    return {
        key: (min if key == "skips" else max)(int(old.get(key, 0)), int(new.get(key, 0)))
        for key in _COUNTERS
    }


def snapshot(workspace: Path, session_id: Any, goal_id: str, *, inherit: bool = True) -> None:
    """Record the test files as they are now for `goal_id`; never raises.

    A new goal inherits the stricter per-file counts of the session's latest baseline,
    so opening another goal cannot launder tests that were already weakened.
    """
    try:
        data = _load(workspace, session_id)
        files = scan(workspace)
        if inherit and data:
            older = list(data.values())[-1].get("files", {})
            for path, old in older.items():
                files[path] = _stricter(old, files[path]) if path in files else dict(old)
        data.pop(goal_id, None)
        data[goal_id] = {"at": datetime.now(timezone.utc).isoformat(), "files": files}
        store.write_json_atomic(baseline_path(workspace, session_id), data)
    except Exception:  # noqa: BLE001 - a snapshot problem (even an isolation refusal) never fails goal creation
        return None


def _summary(sentences: list[str]) -> str:
    text = "; ".join(sentences[:MAX_REPORTED])
    extra = len(sentences) - MAX_REPORTED
    return text + (f"; and {extra} more test files" if extra > 0 else "")


def sync(workspace: Path, session_id: Any, goal: model.Goal) -> tuple[bool, list[dict[str, Any]]]:
    """Make the goal's testguard blockers match the scan. Returns (changed, ledger events)."""
    baseline = _load(workspace, session_id).get(goal.id)
    if not isinstance(baseline, dict) or not isinstance(baseline.get("files"), dict):
        return False, []
    sentences = violations(workspace, baseline["files"])
    opened = [b for b in goal.review_blockers if b.source == SOURCE and not b.resolved]
    if not sentences:
        for blocker in opened:
            blocker.resolved = True
        return bool(opened), [
            {"kind": "review_blocker_resolved", "blocker_id": b.id, "auto": "tests restored"} for b in opened
        ]
    text = _summary(sentences)
    if opened:
        changed = opened[0].detail != text
        opened[0].detail = text
        return changed, []
    used = {b.id for b in goal.review_blockers}
    number = 1
    while f"B{number:03d}" in used:
        number += 1
    blocker = model.ReviewBlocker(id=f"B{number:03d}", detail=text, source=SOURCE)
    goal.review_blockers.append(blocker)
    return True, [{"kind": "review_blocker", "goal_id": goal.id, "blocker_id": blocker.id, "source": SOURCE}]


def accept(workspace: Path, reason: str, sessions: list[str] | None = None) -> int:
    """Resolve the open testguard blockers of `sessions` (default: every session in the workspace)
    and re-baseline them. Returns the count."""
    from . import runtime

    resolved = 0
    for session_id in ["", *store.list_sessions(workspace)] if sessions is None else sessions:
        try:
            state = store.load_or_create(workspace, session_id)
        except ValueError:
            continue
        goal = state.active_goal()
        opened = [b for b in goal.review_blockers if b.source == SOURCE and not b.resolved] if goal else []
        if goal is None or goal.status == "complete" or not opened:
            continue
        for blocker in opened:
            blocker.resolved = True
        runtime._sync_goal_status(goal)
        store.save(workspace, state, session_id)
        snapshot(workspace, session_id, goal.id, inherit=False)
        store.append_ledger(
            workspace,
            {"kind": "testguard_accepted", "goal_id": goal.id, "reason": reason,
             "blockers": [b.id for b in opened]},
            session_id,
        )
        resolved += len(opened)
    return resolved


ALL_SESSIONS_FLAG = "--all-sessions"


def command_accept_tests(raw_args: str) -> str:
    """`/lit-accept-tests [--all-sessions] <reason>`: the user's way to clear a test-weakening blocker.

    By default only the session that most recently ran a turn here is accepted; the flag widens it
    to every session of that workspace.
    """
    text = str(raw_args or "").strip()
    everywhere = text.startswith(ALL_SESSIONS_FLAG + " ") or text == ALL_SESSIONS_FLAG
    reason = redact_text(text[len(ALL_SESSIONS_FLAG):] if everywhere else text).strip()
    if not reason:
        return (
            f"Usage: /lit-accept-tests [{ALL_SESSIONS_FLAG}] <reason> - a reason is required; "
            "it is recorded in the litgoal ledger."
        )
    try:
        from .. import workspace as workspaces
    except ImportError:  # standalone litgoal tests import this package at top level
        import workspace as workspaces  # type: ignore
    active = workspaces.last_active()
    if active is None and not everywhere:
        return (
            "Nothing to accept: no session has run a turn here yet, so there is no current session; "
            f"use /lit-accept-tests {ALL_SESSIONS_FLAG} <reason> to accept for every session of the workspace."
        )
    workspace = active[1] if active else workspaces.resolve()
    if workspace is None:
        return "Nothing to accept: this session has no project workspace (it runs from the Hermes home)."
    count = accept(workspace, reason, None if everywhere else [active[0]])
    if not count:
        return "Nothing to accept: no open test-weakening blocker in " + (
            "this workspace." if everywhere else "the current session."
        )
    return (
        f"Accepted {_plural(count, 'test-weakening blocker')}; the test baseline now matches the "
        "current files. Reason recorded in the litgoal ledger."
    )
