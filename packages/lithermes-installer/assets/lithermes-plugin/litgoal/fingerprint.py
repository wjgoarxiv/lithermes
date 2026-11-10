"""Workspace fingerprint: what a terminal run saw, comparable with what the gate sees later.

A run that went green proves nothing about files edited after it. Each signed run
stores `capture(workspace)`; the gate captures again and `changed` decides whether
the evidence is stale. Inside a git work tree the fingerprint is HEAD plus a content tag for every
file that differs from HEAD or is untracked, so the reason can name the files. Outside git it hashes
(path, size, mtime) of the files under the directory, capped. Failure returns None, which callers
treat as stale.

git never sees the model's environment: it gets PATH, HOME, LANG and LC_ALL only, a 2 second budget
for the whole capture (file reads included), and only plumbing that reads names and object ids
(`rev-parse`, `ls-tree`, `ls-files`) with `core.fsmonitor` forced off. It never runs `git diff` or
`git status`: those apply the repository's `filter.<driver>.clean` programs (from `.gitattributes`
plus `.git/config`) to every modified file, and no command-line flag turns that off for drivers git
has not been told by name. Files are hashed here in Python instead, byte for byte, against the object
id HEAD records, which also keeps the fingerprint stable when only the index changes (`git add`).
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import time
from pathlib import Path
from typing import Any

GIT_TIMEOUT = 2.0
MAX_FILES = 5000
MAX_ENTRIES = 40000
MAX_NAMED = 100
BLOB_LIMIT = 64 << 20
SKIP_DIRS = frozenset(
    {".git", ".hermes", ".venv", "venv", "node_modules", "__pycache__", ".pytest_cache", ".mypy_cache"}
)
_ENV_KEYS = ("PATH", "HOME", "LANG", "LC_ALL")


class _Failed(Exception):
    """git could not answer in time; the fingerprint is unknowable."""


class _NotGit(Exception):
    """The directory is not a git work tree; use the file walk instead."""


def _env() -> dict[str, str]:
    return {key: os.environ[key] for key in _ENV_KEYS if key in os.environ}


def _junk(name: str) -> bool:
    return bool(SKIP_DIRS.intersection(name.split("/")[:-1])) or name.endswith(".pyc")


_BLOBS: dict[tuple[Any, ...], str] = {}
_BLOBS_MAX = 60000


def _blob_id(path: Path, algorithm: str, deadline: float) -> str:
    """The git object id of the file's raw bytes ("gone" if missing); symlinks hash their target.

    Cached by (path, algorithm, size, mtime, ctime, inode): ctime moves on every write or
    utime, so an edit cannot hide behind a restored mtime.
    """
    try:
        info = path.lstat()
    except OSError:
        return "gone"
    if stat.S_ISDIR(info.st_mode):
        return "dir"
    key = (str(path), algorithm, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_ino)
    cached = _BLOBS.get(key)
    if cached is not None:
        return cached
    if time.monotonic() >= deadline:
        raise _Failed()
    digest = hashlib.new(algorithm)
    try:
        if stat.S_ISLNK(info.st_mode):
            target = os.readlink(path).encode("utf-8", "surrogateescape")
            digest.update(b"blob %d\0" % len(target) + target)
        elif info.st_size > BLOB_LIMIT or not stat.S_ISREG(info.st_mode):
            return f"big:{info.st_size}:{info.st_mtime_ns}"
        else:
            digest.update(b"blob %d\0" % info.st_size)
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1 << 20), b""):
                    digest.update(chunk)
                    if time.monotonic() >= deadline:
                        raise _Failed()
    except OSError:
        return "gone"
    if len(_BLOBS) >= _BLOBS_MAX:
        _BLOBS.clear()
    _BLOBS[key] = digest.hexdigest()
    return _BLOBS[key]


def _head_blobs(listing: bytes) -> dict[str, str]:
    """{path: object id} from `git ls-tree -r -z`, skipping submodules."""
    blobs = {}
    for entry in listing.split(b"\0"):
        meta, _, name = entry.partition(b"\t")
        parts = meta.split()
        if len(parts) == 3 and parts[1] == b"blob":
            blobs[name.decode(errors="replace")] = parts[2].decode()
    return blobs


def _git_fingerprint(workspace: Path) -> dict[str, Any]:
    deadline = time.monotonic() + GIT_TIMEOUT

    def run(*args: str, ok: bool = False) -> bytes | None:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise _Failed()
        try:
            done = subprocess.run(
                ["git", "-c", "core.fsmonitor=false", "--no-pager", *args],
                cwd=str(workspace), env=_env(), stdin=subprocess.DEVNULL,
                capture_output=True, timeout=remaining,
            )
        except subprocess.TimeoutExpired as exc:
            raise _Failed() from exc
        if done.returncode == 0:
            return done.stdout
        if ok:
            return None
        raise _Failed()

    try:
        inside = run("rev-parse", "--is-inside-work-tree", ok=True)
    except OSError as exc:
        raise _NotGit() from exc
    if inside is None or inside.strip() != b"true":
        raise _NotGit()
    head = (run("rev-parse", "--verify", "-q", "HEAD", ok=True) or b"").decode().strip()
    in_head = _head_blobs(run("ls-tree", "-r", "-z", "HEAD", "--", ".") or b"") if head else {}
    indexed = (run("ls-files", "-z") or b"").decode(errors="replace").split("\0")
    untracked = (run("ls-files", "-o", "--exclude-standard", "-z") or b"").decode(errors="replace").split("\0")
    names = sorted(n for n in {*in_head, *indexed, *untracked} if n and not _junk(n))
    if len(names) > MAX_ENTRIES:
        raise _Failed()
    tags = {}
    for name in names:
        expected = in_head.get(name)
        algorithm = "sha256" if expected and len(expected) == 64 else "sha1"
        tag = _blob_id(workspace / name, algorithm, deadline)
        if tag != expected:
            tags[name] = tag[:16]
    files = dict(list(tags.items())[:MAX_NAMED])
    body = {"head": head, "files": tags}
    digest = hashlib.sha256(json.dumps(body, sort_keys=True).encode("utf-8")).hexdigest()
    return {"kind": "git", "digest": digest, "head": head[:12], "files": files}


def _walk_fingerprint(workspace: Path) -> dict[str, Any]:
    rows: list[tuple[str, int, int]] = []
    seen = 0
    for root, dirs, names in os.walk(workspace):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for name in sorted(names):
            seen += 1
            if len(rows) >= MAX_FILES or seen > MAX_ENTRIES:
                break
            full = Path(root) / name
            try:
                stat = full.lstat()
            except OSError:
                continue
            rows.append((str(full.relative_to(workspace)), stat.st_size, stat.st_mtime_ns))
        if len(rows) >= MAX_FILES or seen > MAX_ENTRIES:
            break
    digest = hashlib.sha256(json.dumps(rows).encode("utf-8")).hexdigest()
    return {"kind": "files", "digest": digest, "count": len(rows), "files": {}}


def capture(workspace: Path) -> dict[str, Any] | None:
    """The fingerprint of `workspace` now, or None when it cannot be computed."""
    workspace = Path(workspace)
    try:
        return _git_fingerprint(workspace)
    except (_Failed, OSError):
        return None
    except _NotGit:
        pass
    try:
        return _walk_fingerprint(workspace)
    except OSError:
        return None


def changed(old: Any, new: Any) -> tuple[bool, list[str]]:
    """Whether the workspace moved between two fingerprints, and which files (git only)."""
    if not isinstance(old, dict) or not isinstance(new, dict):
        return True, []
    if old.get("digest") == new.get("digest"):
        return False, []
    if old.get("kind") != "git" or new.get("kind") != "git":
        return True, []
    before, after = old.get("files") or {}, new.get("files") or {}
    return True, sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))


def describe(names: list[str]) -> str:
    """'' for no names, else 'a, b, c and N more' (three at most)."""
    shown = ", ".join(names[:3])
    return shown + (f" and {len(names) - 3} more" if len(names) > 3 else "")


class Current:
    """The workspace fingerprint now, captured at most once per gate evaluation."""

    def __init__(self, workspace: Path) -> None:
        self._workspace = Path(workspace)
        self._value: dict[str, Any] | None = None
        self._done = False

    def get(self) -> dict[str, Any] | None:
        if not self._done:
            self._value, self._done = capture(self._workspace), True
        return self._value
