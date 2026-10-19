"""Changed-text LitHumanizer enforcement at Hermes' supported file hooks.

``pre_tool_call`` can deny ``write_file`` and ``patch`` before persistence. The
``post_tool_call`` observer cannot undo a completed Office/PDF export, so those
checks are advisory and ask for a source edit and rebuild.

A deliverable built by a script never passes through ``write_file``. For
``terminal`` and ``execute_code`` calls, ``transform_tool_result`` (the one
post-execution hook whose return value Hermes keeps) looks for DOCX, PPTX and
Markdown files modified while the call ran and, on a block-tier finding,
rewrites the tool result the model reads next. The file is already on disk, so
this instructs a rebuild; it cannot refuse the write.
"""

from __future__ import annotations

import difflib
import errno
import json
import os
import re
import stat
import subprocess
import sys
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


PLUGIN_ROOT = Path(__file__).resolve().parent
DETECTOR = PLUGIN_ROOT / "skills" / "lit-humanizer" / "scripts" / "detect.py"
MAX_SESSIONS = 64
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_DETECT_BYTES = 512 * 1024
MAX_DETECT_OUTPUT = 2 * 1024 * 1024
MAX_ARTIFACT_PATHS = 32
MAX_AGGREGATE_FILE_BYTES = 4 * 1024 * 1024
MAX_CONTEXT_LINES = 6
DETECT_TIMEOUT_SECONDS = 3
TEXT_SUFFIXES = frozenset({".adoc", ".csv", ".htm", ".html", ".md", ".mdx", ".rst", ".svg", ".tex", ".txt"})
OFFICE_SUFFIXES = frozenset({".docx", ".pptx", ".pdf"})
READER_FACING_SUFFIXES = TEXT_SUFFIXES | OFFICE_SUFFIXES
SCRIPT_TOOLS = frozenset({"terminal", "execute_code"})
SCRIPT_DELIVERABLE_SUFFIXES = frozenset({".docx", ".md", ".pptx"})
MAX_SCAN_ROOTS = 6
MAX_SCAN_DEPTH = 4
MAX_SCAN_ENTRIES_PER_ROOT = 4000
MAX_SCAN_FILES = 6
MAX_SCRIPT_OFFICE_BYTES = 16 * 1024 * 1024
MAX_SCRIPT_AGGREGATE_BYTES = 32 * 1024 * 1024
MAX_SCRIPT_TEXT_CHARS = 65_536
MTIME_SLACK_SECONDS = 2.0
_SKIP_SCAN_DIRS = frozenset({"node_modules", "__pycache__", "site-packages", "venv"})
_PATH_TOKEN = re.compile(r"[^\s'\"`=<>|;&(),]+\.(?:docx|pptx|md|py|mjs|js|sh)\b", re.I)

_QUOTED_SPAN = re.compile(
    r'"([^"\n]{1,2000})"|“([^”\n]{1,2000})”|'
    r"‘([^’\n]{1,2000})’|«([^»\n]{1,2000})»|"
    r"(?<!\w)'([^'\n]{8,1000})'(?!\w)"
)
_INTERNAL_FILE = re.compile(r"(?:^|/)(?:plans|evidence|ledgers?|\.hermes|\.lit[^/]*)(?:/|$)|(?:^|/)HANDOFF[^/]*$", re.I)
_V4A_FILE = re.compile(r"^\*\*\* (Add|Update|Delete) File: (.+)$")
_V4A_MOVE = re.compile(r"^\*\*\* Move to: (.+)$")
_RULE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")


@dataclass(frozen=True)
class _StableFile:
    data: bytes
    byte_count: int


class _ReadBudgetExceeded:
    pass


_READ_BUDGET_EXCEEDED = _ReadBudgetExceeded()
_ROOT_TURNS: dict[str, str] = {}
_USER_QUOTES: dict[str, tuple[str, ...]] = {}
_PENDING_ADVISORIES: dict[str, list[str]] = {}
# File versions (device, inode, mtime, size) a script check already judged, per
# session, so a later quick command does not repeat the same verdict.
_SCRIPT_CHECKED: dict[str, list[tuple[int, int, int, int]]] = {}


def reset_state() -> None:
    _ROOT_TURNS.clear()
    _USER_QUOTES.clear()
    _PENDING_ADVISORIES.clear()
    _SCRIPT_CHECKED.clear()


def release_session(session_id: object) -> None:
    key = str(session_id or "")
    if key:
        _ROOT_TURNS.pop(key, None)
        _USER_QUOTES.pop(key, None)
        _PENDING_ADVISORIES.pop(key, None)
        _SCRIPT_CHECKED.pop(key, None)


def _bounded_set(mapping: dict[str, object], key: str, value: object) -> None:
    mapping.pop(key, None)
    mapping[key] = value
    while len(mapping) > MAX_SESSIONS:
        mapping.pop(next(iter(mapping)), None)


def begin_root_turn(session_id: object, turn_id: object) -> None:
    key = str(session_id or "")
    identity = turn_id if isinstance(turn_id, str) else ""
    if not key or not identity or len(identity.encode("utf-8")) > 512:
        return
    if _ROOT_TURNS.get(key) != identity:
        _USER_QUOTES.pop(key, None)
        _bounded_set(_ROOT_TURNS, key, identity)


def capture_user_text(session_id: object, user_message: object, turn_id: object = None) -> None:
    """Keep only bounded exact quote spans, never the full user message."""
    key = str(session_id or "")
    message = user_message if isinstance(user_message, str) else ""
    if not key or not message:
        return
    identity = turn_id if isinstance(turn_id, str) else _ROOT_TURNS.get(key, "")
    if identity and _ROOT_TURNS.get(key) not in (None, identity):
        _USER_QUOTES.pop(key, None)
    quotes: list[str] = []
    used = 0
    for line in message.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("> ") and len(stripped) > 2:
            quote = stripped[2:].strip()
            if quote:
                quotes.append(quote[:2000])
    for match in _QUOTED_SPAN.finditer(message[:16_384]):
        quote = next((group for group in match.groups() if group), "")
        if quote:
            quotes.append(quote[:2000])
    bounded: list[str] = []
    for quote in quotes:
        quote = quote.strip()
        if quote and quote not in bounded and len(bounded) < 16 and used + len(quote) <= 8000:
            bounded.append(quote)
            used += len(quote)
    _bounded_set(_USER_QUOTES, key, tuple(bounded))


def _mask_exact_user_quotes(text: str, session_id: str) -> str:
    masked = text
    for quote in _USER_QUOTES.get(session_id, ()):
        masked = masked.replace(quote, "".join("\n" if char == "\n" else " " for char in quote))
    return masked


def activate_skill(session_id: object, route_or_skill: object) -> bool:
    """Compatibility no-op: reader-facing checks do not depend on skill genre."""
    return bool(str(session_id or ""))


def clear_active_skill(session_id: object) -> None:
    """Compatibility no-op; guards are always active for supported paths."""


def _directory_flags() -> int | None:
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    directory = getattr(os, "O_DIRECTORY", 0)
    if os.name != "posix" or not nofollow or not directory:
        return None
    return os.O_RDONLY | directory | nofollow | getattr(os, "O_CLOEXEC", 0)


def _project_root() -> Path | None:
    """The Hermes launch directory (this process's cwd), widened to the git toplevel above it."""
    try:
        launch = Path(os.getcwd()).resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    return next((folder for folder in (launch, *launch.parents) if (folder / ".git").exists()), launch)


def _locate_artifact(path_text: str, workspace: Path) -> tuple[Path, Path] | None:
    """(read root, path under it) for a reader copy, or None for internal and non-reader paths.

    A path outside the working directory (absolute, or ``../`` after a terminal ``cd``) is
    still a deliverable when it lies inside the launch project: it is judged by its path
    under the project and read under its own parent. Anything outside both is skipped.
    """
    candidate = Path(path_text).expanduser()
    target = candidate if candidate.is_absolute() else workspace / candidate
    absolute = Path(os.path.abspath(os.fspath(target)))
    try:
        root, relative = workspace, absolute.relative_to(workspace)
        judged = relative
    except ValueError:
        project = _project_root()
        root, relative = Path(os.path.realpath(absolute.parent)), Path(absolute.name)
        try:
            judged = (root / relative).relative_to(project) if project else None
        except ValueError:
            judged = None
        if judged is None:
            return None
    if (
        not relative.parts
        or any(part in {"", ".", ".."} for part in relative.parts)
        or relative.suffix.lower() not in READER_FACING_SUFFIXES
        or _INTERNAL_FILE.search(judged.as_posix())
    ):
        return None
    return root, relative


def _relative_artifact_path(path_text: str, workspace: Path) -> Path | None:
    located = _locate_artifact(path_text, workspace)
    return located[1] if located else None


def _read_stable_file_result(
    path_text: str,
    workspace: Path,
    byte_limit: int,
    max_file_bytes: int = MAX_FILE_BYTES,
) -> _StableFile | _ReadBudgetExceeded | None:
    located = _locate_artifact(path_text, workspace)
    directory_flags = _directory_flags()
    if located is None or directory_flags is None or byte_limit < 0:
        return None
    workspace, relative = located
    read_limit = min(max_file_bytes, byte_limit)
    root_parts = tuple(part for part in workspace.parts if part != os.path.sep)
    directory_fds: list[int] = []
    edges: list[tuple[int, str, tuple[int, int], bool]] = []
    artifact_fd = -1

    def open_directory(name: str) -> bool:
        child_fd = -1
        try:
            parent_fd = directory_fds[-1]
            child_fd = os.open(name, directory_flags, dir_fd=parent_fd)
            opened = os.fstat(child_fd)
            if not stat.S_ISDIR(opened.st_mode):
                return False
            edges.append((parent_fd, name, (opened.st_dev, opened.st_ino), True))
            directory_fds.append(child_fd)
            child_fd = -1
            return True
        except OSError:
            return False
        finally:
            if child_fd >= 0:
                os.close(child_fd)

    try:
        directory_fds.append(os.open(os.path.sep, directory_flags))
        for part in (*root_parts, *relative.parts[:-1]):
            if not open_directory(part):
                return None
        parent_fd = directory_fds[-1]
        artifact_fd = os.open(
            relative.parts[-1],
            os.O_RDONLY
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_NONBLOCK", 0)
            | getattr(os, "O_CLOEXEC", 0),
            dir_fd=parent_fd,
        )
        initial = os.fstat(artifact_fd)
        if not stat.S_ISREG(initial.st_mode) or initial.st_size > max_file_bytes:
            return None
        if initial.st_size > read_limit:
            return _READ_BUDGET_EXCEEDED
        edges.append((parent_fd, relative.parts[-1], (initial.st_dev, initial.st_ino), False))
        chunks: list[bytes] = []
        total = 0
        while total <= read_limit:
            chunk = os.read(artifact_fd, min(65_536, read_limit + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
        data = b"".join(chunks)
        if len(data) > read_limit:
            return _READ_BUDGET_EXCEEDED
        final = os.fstat(artifact_fd)
        if (
            not stat.S_ISREG(final.st_mode)
            or (final.st_dev, final.st_ino) != (initial.st_dev, initial.st_ino)
            or final.st_size != initial.st_size
            or final.st_mtime_ns != initial.st_mtime_ns
            or final.st_ctime_ns != initial.st_ctime_ns
            or len(data) != initial.st_size
        ):
            return None
        for parent_fd, name, identity, is_directory in edges:
            current = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            correct_type = stat.S_ISDIR(current.st_mode) if is_directory else stat.S_ISREG(current.st_mode)
            if (current.st_dev, current.st_ino) != identity or not correct_type:
                return None
        return _StableFile(data, len(data))
    except (OSError, ValueError):
        return None
    finally:
        if artifact_fd >= 0:
            try:
                os.close(artifact_fd)
            except OSError:
                pass
        for descriptor in reversed(directory_fds):
            try:
                os.close(descriptor)
            except OSError:
                pass


def _read_stable_text_file_result(
    path_text: str,
    workspace: Path,
    byte_limit: int,
) -> _StableFile | _ReadBudgetExceeded | None:
    result = _read_stable_file_result(path_text, workspace, byte_limit)
    if isinstance(result, _StableFile) and Path(path_text).suffix.lower() not in TEXT_SUFFIXES:
        return None
    return result


def _read_stable_text_file(path_text: str, workspace: Path) -> str | None:
    result = _read_stable_text_file_result(path_text, workspace, MAX_FILE_BYTES)
    if not isinstance(result, _StableFile):
        return None
    try:
        return result.data.decode("utf-8")
    except UnicodeError:
        return None


def _bounded_artifact_paths(paths: Iterable[object]) -> list[object] | None:
    if isinstance(paths, (str, bytes)):
        return None
    try:
        iterator = iter(paths)
    except TypeError:
        return None
    bounded: list[object] = []
    for raw_path in iterator:
        if len(bounded) >= MAX_ARTIFACT_PATHS:
            return None
        bounded.append(raw_path)
    return bounded


def _queue_advisory(session_id: str, message: str) -> None:
    if not session_id:
        return
    pending = list(_PENDING_ADVISORIES.get(session_id, ()))
    if message not in pending:
        pending.append(message)
    _bounded_set(_PENDING_ADVISORIES, session_id, pending[-8:])


def consume_context(session_id: object) -> str:
    key = str(session_id or "")
    messages = _PENDING_ADVISORIES.pop(key, ())
    return "\n".join(messages)


def _path_is_reader_copy(path_text: str, workspace: Path) -> bool:
    return _relative_artifact_path(path_text, workspace) is not None


def _changed_lines(previous: str, proposed: str) -> set[int]:
    old_lines = previous.splitlines(keepends=True)
    new_lines = proposed.splitlines(keepends=True)
    changed: set[int] = set()
    for tag, _old_start, _old_end, new_start, new_end in difflib.SequenceMatcher(
        None, old_lines, new_lines, autojunk=True
    ).get_opcodes():
        if tag in {"replace", "insert"}:
            changed.update(range(new_start + 1, new_end + 1))
    return changed


def _run_detector(text: str, path_text: str) -> list[dict] | None:
    encoded = text.encode("utf-8")
    if len(encoded) > MAX_DETECT_BYTES:
        return None
    payload = json.dumps({"text": text, "file": path_text}, ensure_ascii=False).encode("utf-8")
    if len(payload) > MAX_DETECT_BYTES + 16_384:
        return None
    try:
        result = subprocess.run(
            [sys.executable, "-B", "-I", str(DETECTOR), "--stdin-json"],
            input=payload,
            capture_output=True,
            timeout=DETECT_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0 or len(result.stdout) > MAX_DETECT_OUTPUT:
        return None
    try:
        findings = json.loads(result.stdout.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(findings, list) or len(findings) > 4096:
        return None
    for finding in findings:
        if (
            not isinstance(finding, dict)
            or not _RULE_ID.fullmatch(str(finding.get("rule") or ""))
            or finding.get("severity") not in {"block", "warn"}
            or not isinstance(finding.get("line"), int)
            or not isinstance(finding.get("line_end"), int)
            or finding["line"] < 1
            or finding["line_end"] < finding["line"]
            or not isinstance(finding.get("match"), str)
            or not isinstance(finding.get("lines", []), list)
            or not all(isinstance(line, int) for line in finding.get("lines", []))
        ):
            return None
    return findings


def _touches_changed(finding: dict, changed: set[int]) -> bool:
    """A document-scope finding lists its occurrence lines; any other finding counts its whole span."""
    if "lines" in finding:
        return any(line in changed for line in finding["lines"])
    return any(finding["line"] <= line <= finding["line_end"] for line in changed)


def _changed_findings(text: str, path_text: str, changed: set[int], session_id: str) -> list[dict] | None:
    findings = _run_detector(_mask_exact_user_quotes(text, session_id), path_text)
    if findings is None:
        return None
    return [finding for finding in findings if _touches_changed(finding, changed)]


NEGATION_ADVICE = (
    "negation-cluster: several negations sit in one place. Say what the thing is first, then add the caveat once. "
    "Example: write \"18,420 visits in total, including repeat visits\" instead of \"18,420 is not the number of residents\"."
)


def _block_message(findings: list[dict]) -> dict[str, str] | None:
    blocks = [finding for finding in findings if finding["severity"] == "block"]
    if not blocks:
        return None
    refs = ", ".join(f"{item['rule']}:{item['line']}" for item in blocks[:5])
    extra = f" (+{len(blocks) - 5})" if len(blocks) > 5 else ""
    advice = f" {NEGATION_ADVICE}" if any(item["rule"] == "negation-cluster" for item in blocks) else ""
    return {
        "action": "block",
        "message": f"LitHumanizer blocked {len(blocks)} block-tier finding(s) in added prose ({refs}{extra}). Revise the added wording; warnings remain contextual review signals.{advice}",
    }


def _warn_if_needed(session_id: str, findings: list[dict]) -> None:
    warnings = [finding for finding in findings if finding["severity"] == "warn"]
    if warnings:
        refs = ", ".join(f"{item['rule']}:{item['line']}" for item in warnings[:5])
        _queue_advisory(session_id, f"LitHumanizer warning-tier review signal(s) in added prose: {refs}. Consider them in context; they are not a ban or authorship judgment.")
        if any(item["rule"] == "negation-cluster" for item in warnings):
            _queue_advisory(session_id, NEGATION_ADVICE)


def _fail_open(session_id: str) -> None:
    _queue_advisory(session_id, "LitHumanizer check unavailable; the write was allowed. Run the detector manually before delivery.")


def _read_previous(path_text: str, workspace: Path) -> str | None:
    result = _read_stable_text_file_result(path_text, workspace, MAX_FILE_BYTES)
    if isinstance(result, _StableFile):
        try:
            return result.data.decode("utf-8")
        except UnicodeError:
            return None
    target = Path(path_text).expanduser()
    target = target if target.is_absolute() else workspace / target
    try:
        if result is None and not target.exists() and not target.is_symlink():
            return ""
    except OSError as error:
        # No file can sit at a path the system refuses to name, so the whole edit is new text.
        return "" if error.errno == errno.ENAMETOOLONG else None
    return None


def _check_text_change(session_id: str, path_text: str, proposed: str, workspace: Path) -> dict[str, str] | None:
    if not _path_is_reader_copy(path_text, workspace):
        return None
    if len(proposed.encode("utf-8")) > MAX_DETECT_BYTES:
        _fail_open(session_id)
        return None
    previous = _read_previous(path_text, workspace)
    if previous is None:
        _fail_open(session_id)
        return None
    return _check_proposed(session_id, path_text, previous, proposed)


def _check_proposed(session_id: str, path_text: str, previous: str, proposed: str) -> dict[str, str] | None:
    if len(proposed.encode("utf-8")) > MAX_DETECT_BYTES or len(previous.encode("utf-8")) > MAX_DETECT_BYTES:
        _fail_open(session_id)
        return None
    changed = _changed_lines(previous, proposed)
    if not changed:
        return None
    findings = _changed_findings(proposed, path_text, changed, session_id)
    if findings is None:
        _fail_open(session_id)
        return None
    _warn_if_needed(session_id, findings)
    return _block_message(findings)


def _patch_operations(patch_text: str) -> list[tuple[str, str, list[tuple[str, list[tuple[str, str]]]]]]:
    """V4A Add/Update operations as (kind, path, hunks); a hunk is (context hint, [(prefix, line)])."""
    operations: list[tuple[str, str, list[tuple[str, list[tuple[str, str]]]]]] = []
    hunks: list[tuple[str, list[tuple[str, str]]]] | None = None
    for raw in patch_text.split("\n"):
        line = raw[:-1] if raw.endswith("\r") else raw
        header = _V4A_FILE.match(line)
        if header:
            hunks = [] if header.group(1) in {"Add", "Update"} else None
            if hunks is not None:
                operations.append((header.group(1), header.group(2).strip(), hunks))
        elif _V4A_MOVE.match(line) or line.startswith("*** "):
            continue
        elif hunks is None or not line or line.startswith(("+++", "---", "\\")):
            continue
        elif line.startswith("@@"):
            hint = re.match(r"@@\s*(.+?)\s*@@", line)
            hunks.append((hint.group(1) if hint else "", []))
        else:
            if not hunks:
                hunks.append(("", []))
            hunks[-1][1].append((line[0], line[1:]) if line[0] in "+- " else (" ", line))
    return [(kind, path, [hunk for hunk in found if hunk[1]]) for kind, path, found in operations]


def _apply_hunks(previous: str, hunks: list[tuple[str, list[tuple[str, str]]]]) -> str | None:
    """Apply V4A hunks the way Hermes places them; None when a hunk does not match exactly once."""
    text = previous
    for hint, lines in hunks:
        search = [content for prefix, content in lines if prefix != "+"]
        replace = "\n".join(content for prefix, content in lines if prefix != "-")
        if not search:
            if hint and text.count(hint) > 1:
                return None
            if hint and hint in text:
                eol = text.find("\n", text.find(hint))
                text = text + "\n" + replace if eol == -1 else text[: eol + 1] + replace + "\n" + text[eol + 1 :]
            else:
                text = text.rstrip("\n") + "\n" + replace + "\n"
            continue
        pattern = "\n".join(search)
        if not pattern.strip() or text.count(pattern) != 1:
            return None
        text = text.replace(pattern, replace, 1)
    return text


def _hunk_text(hunks: list[tuple[str, list[tuple[str, str]]]]) -> tuple[str, set[int]]:
    """Context and added lines with a blank line at every hunk break; the added lines count as changed."""
    lines: list[str] = []
    changed: set[int] = set()
    for _hint, hunk in hunks:
        if lines:
            lines.append("")
        for prefix, content in hunk:
            if prefix == "-":
                continue
            lines.append(content)
            if prefix == "+":
                changed.add(len(lines))
    return "\n".join(lines) + "\n", changed


def _check_patch_operation(
    session_id: str, kind: str, path_text: str, hunks: list[tuple[str, list[tuple[str, str]]]], workspace: Path
) -> dict[str, str] | None:
    previous = _read_previous(path_text, workspace)
    if previous is not None:
        proposed = "\n".join(c for _h, hunk in hunks for p, c in hunk if p == "+") + "\n" if kind == "Add" else _apply_hunks(previous, hunks)
        if proposed is not None:
            return _check_proposed(session_id, path_text, previous, proposed)
    text, changed = _hunk_text(hunks)
    if not changed:
        return None
    if len(text.encode("utf-8")) > MAX_DETECT_BYTES:
        _fail_open(session_id)
        return None
    findings = _changed_findings(text, path_text, changed, session_id)
    if findings is None:
        _fail_open(session_id)
        return None
    _warn_if_needed(session_id, findings)
    return _block_message(findings)


def _file_tool_base(task_id: object) -> str:
    """The directory Hermes resolves a relative file-tool path against: the session cwd a terminal ``cd`` recorded."""
    terminal = sys.modules.get("tools.terminal_tool")
    session_cwd = getattr(terminal, "get_session_cwd", None)
    if callable(session_cwd):
        try:
            recorded = session_cwd(str(task_id or "") or None)
        except Exception:  # noqa: BLE001 - a host helper failure falls back to the next anchor
            recorded = None
        if isinstance(recorded, str) and os.path.isabs(recorded) and os.path.isdir(recorded):
            return recorded
    configured = os.environ.get("TERMINAL_CWD", "")
    if os.path.isabs(configured) and os.path.isdir(configured):
        return configured
    return os.getcwd()


def pre_tool_call(
    tool_name: object,
    args: object,
    session_id: object,
    *,
    workspace: object = None,
    task_id: object = None,
) -> dict[str, str] | None:
    """Block block-tier findings before Hermes persists a supported text edit."""
    name = str(tool_name or "")
    payload = args if isinstance(args, dict) else {}
    key = str(session_id or "")
    if not key or name not in {"write_file", "patch"}:
        return None
    try:
        root = Path(workspace or _file_tool_base(task_id)).expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        _fail_open(key)
        return None
    if name == "write_file":
        path_text = str(payload.get("path") or "")
        content = payload.get("content")
        if isinstance(content, str):
            return _check_text_change(key, path_text, content, root)
        return None
    mode = str(payload.get("mode") or "replace").lower()
    if mode == "replace":
        path_text = str(payload.get("path") or "")
        old_string = payload.get("old_string")
        new_string = payload.get("new_string")
        if not isinstance(old_string, str) or not isinstance(new_string, str):
            return None
        previous = _read_previous(path_text, root)
        if previous == "" and old_string:
            return _check_text_change(key, path_text, new_string, root)
        if previous is None or old_string not in previous:
            _fail_open(key)
            return None
        proposed = previous.replace(old_string, new_string) if payload.get("replace_all") else previous.replace(old_string, new_string, 1)
        return _check_text_change(key, path_text, proposed, root)
    if mode == "patch" and isinstance(payload.get("patch"), str):
        for kind, path_text, hunks in _patch_operations(payload["patch"]):
            if not _path_is_reader_copy(path_text, root):
                continue
            denial = _check_patch_operation(key, kind, path_text, hunks, root)
            if denial:
                return denial
    return None


def _extract_office(data: bytes, suffix: str) -> str:
    try:
        import humanizer_office
    except ImportError:
        from . import humanizer_office
    if suffix == ".pdf":
        return humanizer_office.extract_pdf_bytes(data)
    return humanizer_office.extract_office_bytes(data, suffix)


def observe_completed_paths(
    session_id: object,
    paths: Iterable[object],
    *,
    workspace: object = None,
) -> None:
    """Advise after supported Office/PDF exports; this observer cannot deny."""
    key = str(session_id or "")
    if not key:
        return
    bounded = _bounded_artifact_paths(paths)
    if bounded is None:
        _fail_open(key)
        return
    try:
        root = Path(workspace or Path.cwd()).expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        _fail_open(key)
        return
    candidates: list[tuple[str, bytes]] = []
    remaining = MAX_AGGREGATE_FILE_BYTES
    for raw_path in bounded:
        path_text = str(raw_path or "")
        relative = _relative_artifact_path(path_text, root)
        if relative is None or relative.suffix.lower() not in OFFICE_SUFFIXES:
            continue
        result = _read_stable_file_result(path_text, root, remaining)
        if result is _READ_BUDGET_EXCEEDED:
            _fail_open(key)
            return
        if not isinstance(result, _StableFile):
            _fail_open(key)
            continue
        candidates.append((relative.suffix.lower(), result.data))
        remaining -= result.byte_count
    for suffix, data in candidates:
        try:
            text = _extract_office(data, suffix)
        except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired, ImportError):
            _fail_open(key)
            continue
        findings = _run_detector(text, "post-write" + suffix)
        if findings is None:
            _fail_open(key)
            continue
        if findings:
            blocks = sum(item["severity"] == "block" for item in findings)
            warnings = sum(item["severity"] == "warn" for item in findings)
            _queue_advisory(
                key,
                "LIT_HUMANIZER_POSTWRITE_ADVISORY: the completed Office/PDF export has "
                f"{blocks} block-tier and {warnings} warning-tier finding(s). Edit the source and rebuild; Hermes cannot undo a completed export.",
            )


def _script_scan_roots(payload: dict, parsed: object, task_id: str, text: str) -> list[Path]:
    """Directories a script call could have written into, most specific first."""
    named: list[object] = [parsed.get("cwd") if isinstance(parsed, dict) else None, payload.get("workdir")]
    terminal = sys.modules.get("tools.terminal_tool")
    session_cwd = getattr(terminal, "get_session_cwd", None)
    if callable(session_cwd) and task_id:
        try:
            named.append(session_cwd(task_id))
        except Exception:  # noqa: BLE001 - a host helper failure only drops one candidate
            pass
    named.append(os.getcwd())
    base = next((Path(str(item)).expanduser() for item in named if isinstance(item, str) and item and os.path.isdir(item)), Path.cwd())
    for token in _PATH_TOKEN.findall(text)[:32]:
        candidate = Path(token).expanduser()
        named.insert(len(named) - 1, os.fspath((candidate if candidate.is_absolute() else base / candidate).parent))
    roots: list[Path] = []
    for item in named:
        if not isinstance(item, str) or not item:
            continue
        try:
            root = Path(item).expanduser().resolve(strict=True)
        except (OSError, RuntimeError):
            continue
        if root.is_dir() and root not in roots:
            roots.append(root)
        if len(roots) >= MAX_SCAN_ROOTS:
            break
    return roots


def _recent_deliverables(
    roots: list[Path], since: float, checked: list[tuple[int, int, int, int]]
) -> list[tuple[Path, Path, tuple[int, int, int, int]]]:
    """Bounded breadth-first walk for deliverables modified at or after ``since``."""
    found: list[tuple[Path, Path, tuple[int, int, int, int]]] = []
    seen: set[tuple[int, int]] = set()
    for root in roots:
        queue: deque[tuple[Path, int]] = deque([(root, 0)])
        entries = 0
        while queue and entries < MAX_SCAN_ENTRIES_PER_ROOT:
            directory, depth = queue.popleft()
            try:
                with os.scandir(directory) as iterator:
                    for entry in iterator:
                        entries += 1
                        if entries > MAX_SCAN_ENTRIES_PER_ROOT:
                            break
                        name = entry.name
                        if entry.is_dir(follow_symlinks=False):
                            if (
                                depth < MAX_SCAN_DEPTH
                                and not name.startswith(".")
                                and name not in _SKIP_SCAN_DIRS
                                and not _INTERNAL_FILE.search(name)
                            ):
                                queue.append((Path(entry.path), depth + 1))
                            continue
                        if os.path.splitext(name)[1].lower() not in SCRIPT_DELIVERABLE_SUFFIXES:
                            continue
                        info = entry.stat(follow_symlinks=False)
                        identity = (info.st_dev, info.st_ino)
                        version = (info.st_dev, info.st_ino, info.st_mtime_ns, info.st_size)
                        if (
                            not stat.S_ISREG(info.st_mode)
                            or info.st_mtime < since
                            or identity in seen
                            or version in checked
                        ):
                            continue
                        relative = Path(entry.path).relative_to(root)
                        if _relative_artifact_path(relative.as_posix(), root) is None:
                            continue
                        seen.add(identity)
                        found.append((root, relative, version))
                        if len(found) >= MAX_SCAN_FILES:
                            return found
            except OSError:
                continue
    return found


def _script_block_message(hits: list[tuple[str, list[dict]]]) -> str:
    parts = []
    for name, blocks in hits:
        refs = ", ".join(
            f"{item['rule']}:{item['line']} \"{' '.join(item['match'].split())[:60]}\"" for item in blocks[:5]
        )
        extra = f" (+{len(blocks) - 5})" if len(blocks) > 5 else ""
        parts.append(f"{name} ({refs}{extra})")
    return (
        "LIT_HUMANIZER_SCRIPT_DELIVERABLE_BLOCK: this call wrote reader-facing file(s) with block-tier "
        f"LitHumanizer findings: {'; '.join(parts)}. The file is already on disk and is not ready to present. "
        "Rewrite those sentences in the build source, then rebuild: state a real limit once as a fact beside "
        "the number it affects, and say what the document is not for in your chat reply, not in the file."
    )


def transform_tool_result(
    tool_name: object = None,
    args: object = None,
    result: object = None,
    session_id: object = None,
    task_id: object = None,
    duration_ms: object = 0,
    **_: object,
) -> str | None:
    """Check deliverables a terminal/execute_code call just built; rewrite its result on a block hit."""
    if str(tool_name or "") not in SCRIPT_TOOLS or not isinstance(result, str):
        return None
    key = str(session_id or "") or str(task_id or "")
    payload = args if isinstance(args, dict) else {}
    try:
        parsed = json.loads(result)
    except (TypeError, ValueError):
        parsed = None
    elapsed = duration_ms / 1000 if isinstance(duration_ms, (int, float)) and duration_ms > 0 else 0.0
    since = time.time() - elapsed - MTIME_SLACK_SECONDS
    output = parsed.get("output") if isinstance(parsed, dict) else result
    text = "\n".join(
        str(value)[:MAX_SCRIPT_TEXT_CHARS]
        for value in (payload.get("command"), payload.get("code"), output)
        if isinstance(value, str)
    )
    roots = _script_scan_roots(payload, parsed, str(task_id or ""), text)
    hits: list[tuple[str, list[dict]]] = []
    remaining = MAX_SCRIPT_AGGREGATE_BYTES
    checked = _SCRIPT_CHECKED.get(key, [])
    for root, relative, version in _recent_deliverables(roots, since, checked):
        suffix = relative.suffix.lower()
        cap = MAX_SCRIPT_OFFICE_BYTES if suffix in OFFICE_SUFFIXES else MAX_FILE_BYTES
        read = _read_stable_file_result(relative.as_posix(), root, remaining, max_file_bytes=cap)
        if not isinstance(read, _StableFile):
            _fail_open(key)
            continue
        remaining -= read.byte_count
        try:
            content = read.data.decode("utf-8") if suffix == ".md" else _extract_office(read.data, suffix)
        except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired, ImportError):
            _fail_open(key)
            continue
        findings = _run_detector(_mask_exact_user_quotes(content, key), relative.as_posix())
        if findings is None:
            _fail_open(key)
            continue
        checked = [*checked, version][-64:]
        if key:
            _bounded_set(_SCRIPT_CHECKED, key, checked)
        blocks = [item for item in findings if item["severity"] == "block"]
        if blocks:
            hits.append((relative.as_posix(), blocks))
    if not hits:
        return None
    message = _script_block_message(hits)
    if isinstance(parsed, dict):
        previous = parsed.get("error")
        parsed["error"] = f"{previous}\n{message}" if previous else message
        return json.dumps(parsed, ensure_ascii=False)
    return f"{result}\n\n{message}"
