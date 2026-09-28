"""Changed-text LitHumanizer enforcement at Hermes' supported file hooks.

``pre_tool_call`` can deny ``write_file`` and ``patch`` before persistence. The
``post_tool_call`` observer cannot undo a completed Office/PDF export, so those
checks are advisory and ask for a source edit and rebuild.
"""

from __future__ import annotations

import difflib
import json
import os
import re
import stat
import subprocess
import sys
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


def reset_state() -> None:
    _ROOT_TURNS.clear()
    _USER_QUOTES.clear()
    _PENDING_ADVISORIES.clear()


def release_session(session_id: object) -> None:
    key = str(session_id or "")
    if key:
        _ROOT_TURNS.pop(key, None)
        _USER_QUOTES.pop(key, None)
        _PENDING_ADVISORIES.pop(key, None)


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


def _relative_artifact_path(path_text: str, workspace: Path) -> Path | None:
    candidate = Path(path_text).expanduser()
    target = candidate if candidate.is_absolute() else workspace / candidate
    absolute = Path(os.path.abspath(os.fspath(target)))
    try:
        relative = absolute.relative_to(workspace)
    except ValueError:
        return None
    if (
        not relative.parts
        or any(part in {"", ".", ".."} for part in relative.parts)
        or relative.suffix.lower() not in READER_FACING_SUFFIXES
        or _INTERNAL_FILE.search(relative.as_posix())
    ):
        return None
    return relative


def _read_stable_file_result(
    path_text: str,
    workspace: Path,
    byte_limit: int,
) -> _StableFile | _ReadBudgetExceeded | None:
    relative = _relative_artifact_path(path_text, workspace)
    directory_flags = _directory_flags()
    if relative is None or directory_flags is None or byte_limit < 0:
        return None
    read_limit = min(MAX_FILE_BYTES, byte_limit)
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
        if not stat.S_ISREG(initial.st_mode) or initial.st_size > MAX_FILE_BYTES:
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
        ):
            return None
    return findings


def _changed_findings(text: str, path_text: str, changed: set[int], session_id: str) -> list[dict] | None:
    findings = _run_detector(_mask_exact_user_quotes(text, session_id), path_text)
    if findings is None:
        return None
    return [
        finding
        for finding in findings
        if any(finding["line"] <= line <= finding["line_end"] for line in changed)
    ]


def _block_message(findings: list[dict]) -> dict[str, str] | None:
    blocks = [finding for finding in findings if finding["severity"] == "block"]
    if not blocks:
        return None
    refs = ", ".join(f"{item['rule']}:{item['line']}" for item in blocks[:5])
    extra = f" (+{len(blocks) - 5})" if len(blocks) > 5 else ""
    return {
        "action": "block",
        "message": f"LitHumanizer blocked {len(blocks)} block-tier finding(s) in added prose ({refs}{extra}). Revise the added wording; warnings remain contextual review signals.",
    }


def _warn_if_needed(session_id: str, findings: list[dict]) -> None:
    warnings = [finding for finding in findings if finding["severity"] == "warn"]
    if warnings:
        refs = ", ".join(f"{item['rule']}:{item['line']}" for item in warnings[:5])
        _queue_advisory(session_id, f"LitHumanizer warning-tier review signal(s) in added prose: {refs}. Consider them in context; they are not a ban or authorship judgment.")


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
    if result is None and not target.exists() and not target.is_symlink():
        return ""
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
    if len(previous.encode("utf-8")) > MAX_DETECT_BYTES:
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


def _patch_added_chunks(patch_text: str) -> list[tuple[str, str]]:
    chunks: list[tuple[str, str]] = []
    path = ""
    kind = ""
    added: list[str] = []

    def flush() -> None:
        nonlocal added
        if path and kind in {"Add", "Update"} and added:
            chunks.append((path, "\n".join(added)))
        added = []

    for line in patch_text.splitlines():
        header = _V4A_FILE.match(line)
        if header:
            flush()
            kind, path = header.group(1), header.group(2).strip()
        elif _V4A_MOVE.match(line):
            flush()
        elif line.startswith("+++") or line.startswith("---"):
            flush()
        elif line.startswith("+"):
            added.append(line[1:])
        else:
            flush()
    flush()
    return chunks


def pre_tool_call(
    tool_name: object,
    args: object,
    session_id: object,
    *,
    workspace: object = None,
) -> dict[str, str] | None:
    """Block block-tier findings before Hermes persists a supported text edit."""
    name = str(tool_name or "")
    payload = args if isinstance(args, dict) else {}
    key = str(session_id or "")
    if not key or name not in {"write_file", "patch"}:
        return None
    try:
        root = Path(workspace or Path.cwd()).expanduser().resolve(strict=True)
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
        if previous is None or old_string not in previous:
            _fail_open(key)
            return None
        proposed = previous.replace(old_string, new_string) if payload.get("replace_all") else previous.replace(old_string, new_string, 1)
        return _check_text_change(key, path_text, proposed, root)
    if mode == "patch" and isinstance(payload.get("patch"), str):
        for path_text, added_text in _patch_added_chunks(payload["patch"]):
            if not _path_is_reader_copy(path_text, root):
                continue
            findings = _changed_findings(added_text, path_text, set(range(1, len(added_text.splitlines()) + 1)), key)
            if findings is None:
                _fail_open(key)
                continue
            _warn_if_needed(key, findings)
            denial = _block_message(findings)
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
