"""Rule-file discovery: project-root walk-up, source collection, distance.

Ordering inputs produced here (`distance`, `source`, `relative_path`) are what
`engine.sort_candidates` consumes; nothing in this module reads file contents.
Every filesystem call is read-only — the engine never creates, moves, or writes
a rule file.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    from . import constants as C
except (ImportError, ModuleNotFoundError):
    import constants as C


class RuleCandidate(object):
    __slots__ = (
        "path", "real_path", "source", "distance", "is_global",
        "is_single_file", "relative_path", "scope_dir", "boundary",
    )

    def __init__(
        self, path, real_path, source, distance, is_global, is_single_file,
        relative_path, scope_dir, boundary,
    ):
        self.path = path
        self.real_path = real_path
        self.source = source
        self.distance = distance
        self.is_global = is_global
        self.is_single_file = is_single_file
        self.relative_path = relative_path
        self.scope_dir = scope_dir
        self.boundary = boundary


def _posix(value) -> str:
    return str(value).replace("\\", "/")


def _relative_to(base, target) -> str:
    try:
        return _posix(Path(target).relative_to(Path(base)))
    except ValueError:
        return _posix(Path(target).name)


def find_project_root(start):
    """Walk up until a directory holds a PROJECT_MARKERS entry. None if unrooted."""
    try:
        current = Path(start).resolve()
    except OSError:
        return None
    if current.is_file():
        current = current.parent
    for _ in range(C.MAX_WALK_UP_DEPTH):
        for marker in C.PROJECT_MARKERS:
            try:
                if (current / marker).exists():
                    return current
            except OSError:
                continue
        if current.parent == current:
            return None
        current = current.parent
    return None


def _resolved_within(path, boundary):
    try:
        resolved = Path(path).resolve(strict=True)
        resolved.relative_to(Path(boundary).resolve(strict=True))
        return resolved
    except (OSError, ValueError):
        return None


def _scan_directory(directory, budget, boundary):
    """Recursively collect rule files under `directory`, newest-shallowest first."""
    found = []
    try:
        if directory.is_symlink() or not directory.is_dir():
            return found
    except OSError:
        return found
    if _resolved_within(directory, boundary) is None:
        return found
    stack = [directory]
    while stack and len(found) < budget:
        current = stack.pop(0)
        try:
            entries = sorted(current.iterdir(), key=lambda item: item.name)
        except OSError:
            continue
        for entry in entries:
            if len(found) >= budget:
                break
            try:
                if entry.is_symlink():
                    continue
                if entry.is_dir():
                    if entry.name not in C.SCANNER_EXCLUDED_DIRS:
                        stack.append(entry)
                elif (
                    entry.suffix.lower() in C.RULE_FILE_EXTENSIONS
                    and _resolved_within(entry, boundary) is not None
                ):
                    found.append(entry)
            except OSError:
                continue
    return found


def _anchor_chain(start_dir, project_root):
    """Directories from `start_dir` up to and including `project_root`.

    Index in this list IS the directory distance, so a rule in the edited file's
    own directory outranks the same rule at the project root.
    """
    chain = []
    try:
        current = Path(start_dir).resolve()
    except OSError:
        return chain
    if project_root is None:
        return [current]
    for _ in range(C.MAX_WALK_UP_DEPTH):
        chain.append(current)
        if current == project_root or current.parent == current:
            break
        current = current.parent
    if project_root not in chain:
        chain.append(project_root)
    return chain


def _real_path(path) -> str:
    try:
        return _posix(path.resolve())
    except OSError:
        return _posix(path)


def _hermes_home():
    raw = (os.environ.get("HERMES_HOME") or "").strip()
    return Path(raw).expanduser() if raw else Path.home() / ".hermes"


def _home_sources():
    """(directory, source-id) for the three user-home rule roots."""
    home = Path.home()
    return (
        (home / C.USER_HOME_LITHERMES, C.SOURCE_HOME_LITHERMES),
        (_hermes_home() / C.HERMES_HOME_RULES, C.SOURCE_HOME_HERMES),
        (home / C.USER_HOME_CLAUDE, C.SOURCE_HOME_CLAUDE),
    )


def find_candidates(start_dir, project_root=None, plugin_root=None, budget=None):
    """Collect every rule-file candidate visible from `start_dir`.

    `start_dir` is the edited file's directory in the dynamic lane and the
    workspace directory in the static lane.
    """
    budget = C.MAX_SCAN_FILES if budget is None else budget
    if project_root is None:
        project_root = find_project_root(start_dir)
    candidates = []
    seen_real = set()

    def add(path, source, distance, is_global, is_single_file, rel_base, scope_dir, boundary):
        try:
            if Path(path).is_symlink():
                return
        except OSError:
            return
        resolved = _resolved_within(path, boundary)
        if resolved is None:
            return
        real = _real_path(path)
        if real in seen_real or len(candidates) >= budget:
            return
        seen_real.add(real)
        candidates.append(RuleCandidate(
            path=_posix(path),
            real_path=real,
            source=source,
            distance=distance,
            is_global=is_global,
            is_single_file=is_single_file,
            relative_path=_relative_to(rel_base, path) if rel_base else _posix(Path(path).name),
            scope_dir=_posix(scope_dir) if scope_dir else "",
            boundary=_real_path(boundary),
        ))

    root_base = project_root or Path(start_dir)
    for distance, anchor in enumerate(_anchor_chain(start_dir, project_root)):
        for parent, subdir in C.PROJECT_RULE_SUBDIRS:
            source = "{0}/{1}".format(parent, subdir)
            for found in _scan_directory(anchor / parent / subdir, budget, anchor):
                add(found, source, distance, False, False, root_base, anchor, anchor)
        for relative in C.PROJECT_SINGLE_FILES:
            single = anchor / relative
            try:
                if single.is_file():
                    add(single, relative, distance, False, True, root_base, anchor, anchor)
            except OSError:
                continue

    home = Path.home()
    hermes_home = _hermes_home()
    for directory, source in _home_sources():
        boundary = hermes_home if source == C.SOURCE_HOME_HERMES else home
        for found in _scan_directory(directory, budget, boundary):
            add(found, source, C.GLOBAL_DISTANCE, True, False, directory, None, boundary)

    bundled_root = Path(plugin_root) if plugin_root is not None else Path(__file__).resolve().parent
    bundled = bundled_root / C.BUNDLED_RULE_SUBDIR
    for found in _scan_directory(bundled, budget, bundled_root):
        if not _bundled_rule_applies(found.name):
            continue
        add(
            found, C.SOURCE_BUNDLED, C.GLOBAL_DISTANCE, True, False,
            bundled, None, bundled_root,
        )

    return candidates


def _bundled_rule_applies(filename: str) -> bool:
    """Platform-gated bundled rules. Mirrors the reference's win32 filter."""
    if filename == C.WINDOWS_ONLY_BUNDLED_RULE:
        return sys.platform.startswith("win")
    return True


def resolve_target(target_file):
    """Absolute, symlink-resolved target path.

    Discovery anchors are resolved (`find_project_root` resolves), so the target
    must be too. On macOS a temp path is `/var/...` while its resolution is
    `/private/var/...`; comparing the two makes every `relative_to` fail and
    silently degrades every glob to a basename match.
    """
    path = Path(target_file)
    if not path.is_absolute():
        path = Path.cwd() / path
    try:
        return path.resolve()
    except OSError:
        return path


def path_bases(project_root, target_file, candidate):
    """The path spellings a glob is tried against, in match order.

    Mirrors the reference: project-relative first, then scope-relative (relative
    to the anchor directory that owned the rule), then the bare basename.
    """
    target = resolve_target(target_file)
    basename = target.name
    if project_root is None:
        return [basename]
    bases = [_relative_to(project_root, target)]
    if candidate is not None and candidate.scope_dir:
        scope_relative = _relative_to(candidate.scope_dir, target)
        if scope_relative not in bases:
            bases.append(scope_relative)
    if basename not in bases:
        bases.append(basename)
    return bases
