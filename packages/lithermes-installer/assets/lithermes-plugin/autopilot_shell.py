"""Shell-call classification for start-work autopilot runs on Hermes.

Hermes hands ``pre_tool_call`` the ``terminal`` tool's ``command`` string and
optional ``workdir``. This module reads that string without running it and
answers one question: may the call run now, is it parked for the user (tier B,
tier X, or held), or is it refused outright?

- ``allow``: a reader, an in-project script runner, or a charter commit.
- ``B``: every ``&&`` step is cd/touch/mkdir/cp/mv/git add on real paths inside
  the project, outside ``.git`` and outside every protected path. Replayed by
  plain ``lit approve``, natively in Python, never through a shell.
- ``X``: parked, and replayed only by the exact typed prompt ``lit approve x``.
- ``held``: parked with a reason; this reader cannot follow the command (a
  prefix verb, an assignment, a glob, an expansion, a nested shell...). Listed,
  never replayed.
- ``refused``: secrets, host homes, ``.git`` internals and denied commands.
  Never stored.

Nothing here executes a command. Replays live in ``autopilot.py``.
"""

from __future__ import annotations

import errno
import os
import re
import shlex
import sys
from dataclasses import dataclass, field
from pathlib import Path

CASE_FOLD = sys.platform in {"darwin", "win32"}

READERS = frozenset(
    {"cat", "head", "tail", "wc", "grep", "rg", "ls", "pwd", "stat", "file", "diff", "sort", "uniq", "cut", "jq", "find", "sed", "tree", "du"}
)
GIT_READERS = frozenset({"status", "diff", "log", "show", "blame", "ls-files", "rev-parse", "branch"})
B_VERBS = frozenset({"cd", "touch", "mkdir", "cp", "mv"})
SHELLS = frozenset({"sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh"})
# Verbs whose next word runs as another verb, or that move the shell somewhere
# the reader does not follow. A command led by one of these is held.
PREFIX_VERBS = frozenset(
    {
        "time", "nice", "nohup", "timeout", "stdbuf", "ionice", "chroot", "doas", "!", "sudo", "env",
        "command", "builtin", "exec", "eval", "source", ".", "xargs", "alias", "unalias", "set", "shopt",
        "trap", "enable", "pushd", "popd", "export", "unset", "declare", "typeset", "local", "readonly",
        "coproc", "then", "do", "if", "while", "until", "for", "case", "function", "watch", "parallel",
    }
)
_ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*\+?=")
_DECODERS = (
    ("base64", ("-d", "--decode", "-D")),
    ("xxd", ("-r",)),
    ("openssl", ("enc", "-d", "base64")),
    ("uudecode", ()),
)
HOME_SECRET_PARTS = (
    ".ssh", ".aws", ".gnupg", ".npmrc", ".netrc", ".pypirc", ".git-credentials", ".docker", ".kube",
    ".bashrc", ".bash_profile", ".bash_login", ".zshrc", ".zprofile", ".zshenv", ".zlogin", ".profile",
    ".hermes", ".config", ".azure", ".terraformrc", ".vault-token",
)
_ENV_SAFE_SUFFIXES = (".example", ".sample", ".template", ".dist")
SECRET_SUFFIXES = (".pem", ".key", ".p12", ".pfx", ".keystore")
SECRET_NAMES = frozenset({".envrc", ".mcp.json", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "credentials.json"})


@dataclass
class Verdict:
    kind: str  # allow | B | X | held | refused | hint
    reason: str = ""
    hint_parts: list[str] = field(default_factory=list)
    outward: bool = True


def _fold(text: str) -> str:
    return text.lower() if CASE_FOLD else text


def account_homes() -> list[Path]:
    """Every home this account owns: the replaced ``HOME`` and the real one."""
    homes: list[Path] = []
    try:
        import pwd

        homes.append(Path(pwd.getpwuid(os.getuid()).pw_dir))
    except (ImportError, KeyError, OSError, AttributeError):
        pass
    for name in ("HOME", "USERPROFILE"):
        value = os.environ.get(name)
        if value:
            homes.append(Path(value))
    seen: list[Path] = []
    for home in homes:
        for candidate in (home, _real(home)):
            if candidate not in seen:
                seen.append(candidate)
    return seen


def _real(path: Path) -> Path:
    try:
        return Path(os.path.realpath(path))
    except (OSError, ValueError):
        return path


def link_loop(path: Path) -> bool:
    """True when following ``path``'s links loops; ``_real`` follows a whole chain otherwise."""
    try:
        os.path.realpath(path, strict=True)
    except OSError as exc:
        return exc.errno == errno.ELOOP
    except (ValueError, TypeError):
        return False
    return False


def _inside(path: Path, root: Path) -> bool:
    a, b = _fold(str(path)), _fold(str(root))
    return a == b or a.startswith(b.rstrip(os.sep) + os.sep)


def _hidden_home_entries(home: Path, path: Path) -> list[Path]:
    """The hidden top-level entry of ``home`` that ``path`` falls in, as a host home.

    Agent hosts, shells and tools keep their settings and logins in dot folders
    directly under the home, so every one of them counts, by shape rather than
    by a list of names. The entry that holds the current folder is the project
    itself and stays open.
    """
    try:
        here: Path | None = Path(os.getcwd())
    except OSError:
        here = None
    entries: list[Path] = []
    for candidate in {path, _real(path)}:
        for base in {home, _real(home)}:
            try:
                relative = candidate.relative_to(base)
            except ValueError:
                continue
            if not relative.parts or not relative.parts[0].startswith(".") or relative.parts[0] in {".", ".."}:
                continue
            entry = base / relative.parts[0]
            if here is not None and (_inside(here, entry) or _inside(_real(here), _real(entry))):
                continue
            entries.append(entry)
    return entries


# Folders of a Hermes home (or one of its profiles) that hold the session's own
# transcripts and spilled tool output; a run may read them back, never write them.
_HERMES_READABLE = (("sessions",), ("cache", "spillover"), ("cache", "terminal-output"), ("hook_outputs",))


def _hermes_homes() -> list[Path]:
    homes = [home / ".hermes" for home in account_homes()]
    if os.environ.get("HERMES_HOME"):
        homes.insert(0, Path(os.environ["HERMES_HOME"]))
    return homes


def hermes_session_file(path: Path) -> bool:
    """True for a file under the Hermes home's session, spill or hook-output folders.

    Both the path as written and the path its links lead to must fall there, so a
    link cannot carry a read out of those folders or into them.
    """
    return _in_hermes_readable(path) and _in_hermes_readable(_real(path))


def _in_hermes_readable(candidate: Path) -> bool:
    for hermes in _hermes_homes():
        for base in {hermes, _real(hermes)}:
            try:
                parts = tuple(_fold(part) for part in candidate.relative_to(base).parts)
            except ValueError:
                continue
            if len(parts) > 2 and parts[0] == "profiles":
                parts = parts[2:]
            if ".." in parts:
                continue
            if any(parts[: len(folder)] == folder and len(parts) > len(folder) for folder in _HERMES_READABLE):
                return True
    return False


def protected_reason(path: Path, *, extra: tuple[Path, ...] = (), reading: bool = False) -> str:
    """Why touching ``path`` is refused outright, or an empty string.

    ``reading`` opens the session's own Hermes transcript and spill folders (S-A2-10).
    """
    if link_loop(path):
        return "a link loop, which cannot be followed to its end"
    name = _fold(path.name)
    if name == ".env" or (name.startswith(".env.") and not name.endswith(_ENV_SAFE_SUFFIXES)):
        return "an environment secrets file"
    if name in SECRET_NAMES or name.endswith(SECRET_SUFFIXES) or name.startswith(("id_rsa", "id_ed25519")):
        return "a secret or key file"
    if reading and hermes_session_file(path):
        return ""
    hermes_home = os.environ.get("HERMES_HOME")
    roots = [*extra]
    if hermes_home:
        roots.append(Path(hermes_home))
    for home in account_homes():
        roots.extend(home / part for part in HOME_SECRET_PARTS)
        roots.extend(_hidden_home_entries(home, path))
    for candidate in {path, _real(path)}:
        for root in roots:
            for variant in {root, _real(root)}:
                if _inside(candidate, variant):
                    return "a secret, host settings file or real host home"
    return ""


def git_internal(path: Path) -> bool:
    """True when any component of the lexical or real path is ``.git`` (case-folded)."""
    for candidate in (path, _real(path)):
        if any(part.lower() == ".git" for part in candidate.parts):
            return True
    return False


# --- splitting ---------------------------------------------------------------------------------


@dataclass
class Segment:
    text: str
    operator_before: str  # "" for the first segment


def split_command(command: str) -> tuple[list[Segment], str]:
    """Split on unquoted ``&&``, ``||``, ``;``, ``|`` and ``&``.

    Returns ``(segments, problem)``; ``problem`` names an unpaired quote.
    """
    segments: list[Segment] = []
    buf: list[str] = []
    quote = ""
    operator = ""
    i = 0
    while i < len(command):
        ch = command[i]
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = ""
            elif ch == "\\" and quote == '"' and i + 1 < len(command):
                buf.append(command[i + 1])
                i += 1
            i += 1
            continue
        if ch in "'\"":
            quote = ch
            buf.append(ch)
            i += 1
            continue
        if ch == "\\" and i + 1 < len(command):
            buf.append(ch)
            buf.append(command[i + 1])
            i += 2
            continue
        pair = command[i : i + 2]
        if pair in {"&&", "||"}:
            segments.append(Segment("".join(buf), operator))
            buf, operator = [], pair
            i += 2
            continue
        if ch in ";|":
            segments.append(Segment("".join(buf), operator))
            buf, operator = [], ch
            i += 1
            continue
        if ch == "&" and not (i > 0 and command[i - 1] in "<>") and command[i + 1 : i + 2] != ">":
            segments.append(Segment("".join(buf), operator))
            buf, operator = [], "&"
            i += 1
            continue
        buf.append(ch)
        i += 1
    if quote:
        return [], "its quotes do not pair"
    segments.append(Segment("".join(buf), operator))
    return segments, ""


def _unquoted(text: str) -> str:
    """The characters of ``text`` that sit outside quotes (escapes kept)."""
    out: list[str] = []
    quote = ""
    for ch in text:
        if quote:
            if ch == quote:
                quote = ""
            continue
        if ch in "'\"":
            quote = ch
            continue
        out.append(ch)
    return "".join(out)


_SAFE_REDIRECTS = re.compile(r"\s+2>&1\b|\s+2>/dev/null\b")


def uncheckable(segment: str) -> str:
    """Why the word reader cannot follow this segment, or an empty string."""
    raw = segment
    if "\n" in raw or "\r" in raw:
        return "it spans several lines"
    if "$" in raw or "`" in raw:
        return "it expands a variable or runs a nested command"
    if "\\" in raw:
        return "it uses an escape the reader does not decode"
    bare = _unquoted(_SAFE_REDIRECTS.sub("", raw))
    if re.search(r"[<>]", bare):
        return "it redirects input or output"
    if re.search(r"[*?\[\]]", bare):
        return "it uses a glob"
    if re.search(r"[{}]", bare):
        return "it uses brace expansion"
    if re.search(r"[()]", bare):
        return "it opens a subshell"
    if re.search(r"(^|\s)~", bare):
        return "it uses ~ home expansion"
    return ""


def words_of(segment: str) -> list[str] | None:
    try:
        return shlex.split(_SAFE_REDIRECTS.sub("", segment), posix=True)
    except ValueError:
        return None


def verb_hold(words: list[str]) -> str:
    """Hold reasons that depend on the parsed verb."""
    if not words:
        return "it has an empty step"
    first = words[0]
    if _ASSIGNMENT.match(first):
        return "an assignment before the verb still changes how it runs"
    base = os.path.basename(first)
    if first in PREFIX_VERBS or base in PREFIX_VERBS:
        return f"`{first}` runs or moves past another verb the reader does not follow"
    if base in SHELLS and any(word.startswith("-") and "c" in word for word in words[1:]):
        return "it starts a nested shell"
    for decoder, flags in _DECODERS:
        if base == decoder and (not flags or any(flag in words for flag in flags)):
            return "it decodes data that may become a command"
    if base == "cd" and len(words) > 1 and words[1] == "-":
        return "`cd -` goes to a folder the reader does not track"
    return ""


# --- protected-path scan ---------------------------------------------------------------------------


def _expand_user(word: str) -> Path | None:
    if word == "~" or word.startswith("~/"):
        homes = account_homes()
        return (homes[-1] if homes else Path.home()) / word[2:]
    return None


def resolve_word(word: str, cwd: Path) -> Path:
    expanded = _expand_user(word)
    if expanded is not None:
        return Path(os.path.normpath(expanded))
    path = Path(word)
    if not path.is_absolute():
        path = cwd / path
    return Path(os.path.normpath(path))


def _path_values(word: str) -> list[str]:
    """Every spelling of a path a word may carry: itself, after a redirect, after ``=``."""
    bare = re.sub(r"^\d*[<>]+&?", "", word)
    values = [] if word.startswith("-") else [bare]
    if "=" in bare:
        values.append(bare.split("=", 1)[1])
    attached = re.fullmatch(r"-[A-Za-z]([~/.].*)", word)
    if attached:
        values.append(attached.group(1))
    return values


def _scan_roots(words: list[str], cwd: Path) -> list[Path] | None:
    """The folders a recursive reader walks, or None when the reader does not recurse."""
    verb = os.path.basename(words[0])
    args = words[1:]
    operands = [w for w in args if not w.startswith("-")]
    letters = "".join(_short_letters(w) for w in args)
    named_pattern = any(w in {"-e", "--regexp", "-f", "--file"} or w.startswith(("--regexp=", "--file=")) for w in args)
    if verb in {"grep", "egrep", "fgrep"}:
        recurse = "r" in letters or "R" in letters or any(
            w in {"--recursive", "--dereference-recursive", "--directories=recurse", "-drecurse"} for w in args
        ) or any(w in {"-d", "--directories"} and args[i + 1 : i + 2] == ["recurse"] for i, w in enumerate(args))
        if not recurse:
            return None
        operands = [w for w in operands if w != "recurse"]
        if not named_pattern:
            operands = operands[1:]
    elif verb == "rg":
        if not named_pattern and "--files" not in args:
            operands = operands[1:]
    elif verb == "diff":
        if "r" not in letters and "R" not in letters and "--recursive" not in args:
            return None
    elif verb == "find":
        operands = []
        index = 0
        # Leading -H, -L, -P (link handling) and -D/-O options come before the start folders.
        while index < len(args) and (args[index] in {"-H", "-L", "-P"} or re.fullmatch(r"-O\d*", args[index])):
            index += 1
        while index < len(args) and args[index] == "-D":
            index += 2
        for w in args[index:]:
            if w.startswith(("-", "(", "!")):
                break
            operands.append(w)
    elif verb == "ls":
        if "R" not in letters and "--recursive" not in args:
            return None
    elif verb not in {"tree", "du"}:
        return None
    return [resolve_word(w, cwd) for w in operands] or [cwd]


def _recursive_home_scan(words: list[str], cwd: Path) -> bool:
    roots = _scan_roots(words, cwd)
    if not roots:
        return False
    homes = [*account_homes(), *_hermes_homes()]
    for root in roots:
        for home in homes:
            if _inside(home, root) or _inside(_real(home), _real(root)):
                return True
    return False


def refusal_for(command: str, cwd: Path, *, extra_protected: tuple[Path, ...] = ()) -> str:
    """A refusal reason when the command names a protected path (cd followed)."""
    segments, problem = split_command(command)
    if problem:
        segments = [Segment(command, "")]
    current = cwd
    for segment in segments:
        words = words_of(segment.text)
        if words is None:
            words = segment.text.replace('"', "").replace("'", "").split()
        if words and words[0] == "cd" and len(words) == 1:
            return "bare `cd` goes to the real home"
        reading = bool(words) and reader_allowed(words)
        if reading and _recursive_home_scan(words, current):
            return "it searches a home folder (or a folder above one) recursively"
        for word in words:
            if word.startswith("~") and not (word == "~" or word.startswith("~/")):
                return "`~user` names another account's home"
            if word.startswith("-") and "=" not in word and not re.fullmatch(r"-[A-Za-z][~/.].*", word):
                continue
            values = _path_values(word)
            if words[0] == "git" and ":" in word and not word.startswith("-"):
                # `git show REV:path` and `git cat-file -p REV:path` print a tracked file.
                values.append(word.split(":", 1)[1])
                values.append(word.rsplit(":", 1)[1])
            for value in values:
                if not value or value.startswith(("http://", "https://")):
                    continue
                target = resolve_word(value, current)
                reason = protected_reason(target, extra=extra_protected, reading=reading)
                if reason:
                    return f"it touches {reason}"
        if words and words[0] == "cd" and len(words) >= 2 and words[1] != "-":
            current = resolve_word(words[1], current)
    return ""


# --- B allowlist -------------------------------------------------------------------------------


def _dangling_on_path(path: Path, root: Path) -> bool:
    """True when the path or any of its ancestors is a link whose target is missing."""
    probe = path
    while True:
        if os.path.lexists(probe) and not os.path.exists(probe):
            return True
        if probe == probe.parent or not _inside(probe, root):
            return False
        probe = probe.parent


def _local_path(path: Path, root: Path) -> bool:
    real_root = _real(root)
    if _dangling_on_path(path, root):
        return False
    if git_internal(path) or protected_reason(path):
        return False
    real = _real(path)
    return _inside(path, root) and _inside(real, real_root)


def _holds_state(path: Path) -> bool:
    """A path that is, holds or lies in a `.hermes` or `.git` folder (any case)."""
    if any(_fold(part) in {".hermes", ".git"} for part in path.parts):
        return True
    try:
        return any(_fold(entry.name) in {".hermes", ".git"} for entry in path.iterdir()) if path.is_dir() else False
    except OSError:
        return True


def _b_segment(words: list[str], cwd: Path, root: Path) -> tuple[bool, Path]:
    verb, args = words[0], words[1:]
    if verb == "cd":
        if len(args) != 1:
            return False, cwd
        target = resolve_word(args[0], cwd)
        return (target.is_dir() and _local_path(target, root)), target
    if verb == "git":
        if len(args) < 2 or args[0] != "add":
            return False, cwd
        files = args[1:]
        if any(item.startswith("-") or item in {".", ".."} for item in files):
            return False, cwd
        for item in files:
            target = resolve_word(item, cwd)
            if not target.is_file() or not _local_path(target, root):
                return False, cwd
        return True, cwd
    if verb == "touch":
        if not args or any(item.startswith("-") for item in args):
            return False, cwd
        return all(_local_path(resolve_word(item, cwd), root) for item in args), cwd
    if verb == "mkdir":
        paths = [item for item in args if item != "-p"]
        if not paths or any(item.startswith("-") for item in paths):
            return False, cwd
        return all(_local_path(resolve_word(item, cwd), root) for item in paths), cwd
    if verb in {"cp", "mv"}:
        allowed = {"-r", "-R", "-p"} if verb == "cp" else set()
        paths = [item for item in args if item not in allowed]
        if len(paths) < 2 or any(item.startswith("-") for item in paths):
            return False, cwd
        *sources, destination = paths
        dest = resolve_word(destination, cwd)
        for source in sources:
            src = resolve_word(source, cwd)
            if not os.path.lexists(src) or not _local_path(src, root) or (verb == "mv" and _holds_state(src)):
                return False, cwd
            final = dest / src.name if dest.is_dir() and not dest.is_symlink() else dest
            if os.path.lexists(final) or not _local_path(final, root) or _holds_state(final):
                return False, cwd
        if len(sources) > 1 and not dest.is_dir():
            return False, cwd
        return True, cwd
    return False, cwd


def b_tier(command: str, cwd: Path, root: Path) -> bool:
    segments, problem = split_command(command)
    if problem or not segments:
        return False
    current = cwd
    for segment in segments:
        if segment.operator_before not in {"", "&&"}:
            return False
        words = words_of(segment.text)
        if not words or (words[0] not in B_VERBS and words[0] != "git"):
            return False
        ok, current = _b_segment(words, current, root)
        if not ok:
            return False
    return True


# --- direct allow ------------------------------------------------------------------------------


def _in_project_file(word: str, cwd: Path, root: Path) -> bool:
    target = resolve_word(word, cwd)
    return target.is_file() and _local_path(target, root)


def runner_allowed(words: list[str], cwd: Path, root: Path) -> bool:
    """An in-project script runner: the only code the run starts without asking."""
    if not words:
        return False
    verb = os.path.basename(words[0])
    args = words[1:]
    # A script runs bare: an extra argument such as `--write x` turns a check into a tool.
    if verb == "node":
        if args[:1] == ["--test"]:
            return all(not item.startswith("-") and _local_path(resolve_word(item, cwd), root) for item in args[1:])
        return len(args) == 1 and not args[0].startswith("-") and _in_project_file(args[0], cwd, root)
    if verb in {"python", "python3"}:
        if args[:2] in (["-m", "pytest"], ["-m", "unittest"]):
            return all(not item.startswith("-") or item in {"-q", "-v"} for item in args[2:])
        return len(args) == 1 and not args[0].startswith("-") and _in_project_file(args[0], cwd, root)
    if verb == "pytest":
        return all(not item.startswith("-") or item in {"-q", "-v", "-x"} for item in args)
    if verb == "npm":
        # The repo's own test and check scripts (C-1), run bare from a folder inside the project.
        own = args == ["test"] or (len(args) == 2 and args[0] == "run" and args[1] in _NPM_CHECK_SCRIPTS)
        return own and _inside(_real(cwd), _real(root)) and (cwd / "package.json").is_file()
    return False


_NPM_CHECK_SCRIPTS = frozenset({"test", "check", "lint", "build", "typecheck"})


_GIT_BRANCH_LIST_FLAGS = frozenset(
    {"--list", "-l", "-a", "--all", "-r", "--remotes", "-v", "-vv", "--verbose", "--show-current", "--no-color", "--color"}
)
_GIT_REFUSED_FLAGS = ("-c", "-C", "--output", "--ext-diff", "--exec-path", "--git-dir", "--work-tree", "--namespace")
# jq programs that read the process environment or name the files they read.
_JQ_ENV = re.compile(r"\$ENV|\$__loc__|\b(?:env|input_filename|halt_error)\b")
_FIND_ACTIONS = frozenset({"-exec", "-execdir", "-delete", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"})
# One sed command: an optional address or range, optionally negated, then p, d, q, Q, =, n, N
# or an s command whose flags never include w (write) or e (execute).
_SED_ADDRESS = r"(?:\d+|\$|/(?:[^/\\]|\\.)*/[IM]*)(?:,(?:\d+|\$|/(?:[^/\\]|\\.)*/[IM]*))?!?\s*"
_SED_SIMPLE = re.compile(rf"^(?:{_SED_ADDRESS})?[pdqQ=nN]$")
_SED_ADDRESSED_S = re.compile(rf"^(?:{_SED_ADDRESS})?s(.*)$", re.DOTALL)


def _sed_s_ok(body: str) -> bool:
    if not body or body[0] in "\\\n" or body[0].isalnum():
        return False
    delim, rest, parts, current, escaped = body[0], body[1:], [], "", False
    for char in rest:
        if escaped:
            current += char
            escaped = False
        elif char == "\\":
            current += char
            escaped = True
        elif char == delim and len(parts) < 2:
            parts.append(current)
            current = ""
        else:
            current += char
    return len(parts) == 2 and re.fullmatch(r"[gpiIm0-9]*", current) is not None


def _sed_script_ok(script: str) -> bool:
    for command in re.split(r"[;\n]", script):
        command = command.strip()
        if not command:
            continue
        if _SED_SIMPLE.match(command):
            continue
        matched = _SED_ADDRESSED_S.match(command)
        if not (matched and _sed_s_ok(matched.group(1))):
            return False
    return True


def _sed_allowed(words: list[str]) -> bool:
    scripts: list[str] = []
    operands: list[str] = []
    index = 1
    while index < len(words):
        word = words[index]
        if word in {"-e", "--expression"}:
            if index + 1 >= len(words):
                return False
            scripts.append(words[index + 1])
            index += 2
            continue
        if word.startswith("--expression="):
            scripts.append(word.split("=", 1)[1])
        elif word.startswith("-e") and len(word) > 2:
            scripts.append(word[2:])
        elif word in {"-n", "--quiet", "--silent", "-E", "-r", "--regexp-extended", "-u", "--unbuffered", "-s", "--separate", "-z", "--null-data", "--posix", "--"}:
            pass
        elif word.startswith("-"):
            return False
        else:
            operands.append(word)
        index += 1
    if not scripts:
        if not operands:
            return False
        scripts.append(operands.pop(0))
    return all(_sed_script_ok(script) for script in scripts)


# Long options that write a file or start a program. GNU tools accept any unique
# prefix (`--out` for `--output`), so a word that abbreviates one of these counts too.
_REFUSED_LONG_NAMES = ("output", "pre", "hostname-bin", "compress-program", "compile")


def _refused_long(word: str) -> bool:
    if not word.startswith("--") or len(word) == 2:
        return False
    name = word[2:].split("=", 1)[0]
    return bool(name) and any(full.startswith(name) for full in _REFUSED_LONG_NAMES)


def _short_letters(word: str) -> str:
    """The option letters of a short cluster such as `-uo` (empty for long options and operands)."""
    if not word.startswith("-") or word.startswith("--"):
        return ""
    return re.match(r"-([A-Za-z]*)", word).group(1)


def _pattern_files_local(words: list[str]) -> bool:
    """grep and rg read patterns from `-f FILE`; such a file must be a plain path below the folder."""
    files: list[str] = []
    for index, word in enumerate(words[1:], start=1):
        if word.startswith("--file="):
            files.append(word.split("=", 1)[1])
        elif word == "--file" or re.fullmatch(r"-[A-Za-z]*f", word):
            files.append(words[index + 1] if index + 1 < len(words) else "")
        elif re.match(r"-[A-Za-z]*f.", word) and not word.startswith("--"):
            files.append(word[word.index("f") + 1 :])
    return all(f and not f.startswith(("/", "~")) and ".." not in Path(f).parts for f in files)


def reader_allowed(words: list[str]) -> bool:
    """A command that only reads: no flag in it can write a file or start a program."""
    if not words:
        return False
    verb = os.path.basename(words[0])
    if verb == "git":
        if len(words) < 2 or words[1] not in GIT_READERS:
            return False
        if any(w == flag or w.startswith(flag + "=") or (flag == "--output" and w.startswith(flag)) for w in words for flag in _GIT_REFUSED_FLAGS):
            return False
        if any(_refused_long(w) for w in words[2:]):
            return False
        return words[1] != "branch" or all(w in _GIT_BRANCH_LIST_FLAGS for w in words[2:])
    if verb not in READERS:
        return False
    if any(
        w.startswith(("--output", "--hostname-bin")) or w == "--pre" or w.startswith("--pre=") or _refused_long(w)
        for w in words[1:]
    ):
        return False
    if verb == "jq" and any(
        w in {"-f", "--from-file"} or (not w.startswith("-") and _JQ_ENV.search(w)) for w in words[1:]
    ):
        return False
    if verb == "find" and any(w in _FIND_ACTIONS for w in words):
        return False
    if verb == "sed":
        return _sed_allowed(words)
    if verb in {"sort", "tree"} and any(w.startswith("-o") or "o" in _short_letters(w) for w in words[1:]):
        return False
    if verb == "sort" and any(w.startswith("--compress") for w in words[1:]):
        return False
    if verb in {"grep", "rg"} and not _pattern_files_local(words):
        return False
    if verb == "uniq" and len([w for w in words[1:] if not w.startswith("-") or w == "-"]) > 1:
        return False
    if verb == "file" and any(w == "-C" or w == "--compile" or "C" in _short_letters(w) for w in words[1:]):
        return False
    return True


def direct_allowed(command: str, cwd: Path, root: Path, *, charter: dict | None = None) -> bool:
    segments, problem = split_command(command)
    if problem or not segments:
        return False
    if charter_commit_allowed(command, cwd, root, charter):
        return True
    current = cwd
    for index, segment in enumerate(segments):
        if uncheckable(segment.text):
            return False
        words = words_of(segment.text)
        if not words:
            return False
        if index and segment.operator_before == "|":
            if not reader_allowed(words):
                return False
            continue
        if index and segment.operator_before != "&&":
            return False
        if words[0] == "cd" and len(words) == 2:
            target = resolve_word(words[1], current)
            if not target.is_dir() or not _inside(_real(target), _real(root)):
                return False
            current = target
            continue
        if not (reader_allowed(words) or runner_allowed(words, current, root)):
            return False
    return True


# --- charter commit ----------------------------------------------------------------------------


def current_branch(repo: Path) -> str:
    git = repo / ".git"
    try:
        if git.is_file():
            text = git.read_text(encoding="utf-8").strip()
            if not text.startswith("gitdir:"):
                return ""
            gitdir = Path(text.split(":", 1)[1].strip())
            git = gitdir if gitdir.is_absolute() else (repo / gitdir)
        head = (git / "HEAD").read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    prefix = "ref: refs/heads/"
    return head[len(prefix) :] if head.startswith(prefix) else ""


def _git_toplevel(start: Path) -> Path | None:
    probe = _real(start)
    while True:
        if (probe / ".git").exists():
            return probe
        if probe == probe.parent:
            return None
        probe = probe.parent


_COMMIT_FLAGS_WITH_VALUE = {"-m", "-F", "--message", "--file"}
_COMMIT_FLAGS = {"-a", "-q", "--all", "--quiet"}


def charter_commit_allowed(command: str, cwd: Path, root: Path, charter: dict | None) -> bool:
    """``git add <named files>`` then ``git commit -m ...`` on the charter branch and repo."""
    if not charter or not charter.get("branch") or not charter.get("repo"):
        return False
    segments, problem = split_command(command)
    if problem or not segments or any(s.operator_before not in {"", "&&"} for s in segments):
        return False
    repo = _git_toplevel(cwd)
    if repo is None or _fold(str(repo)) != _fold(str(_real(Path(charter["repo"])))):
        return False
    if current_branch(repo) != charter["branch"]:
        return False
    committed = False
    for segment in segments:
        if "$" in segment.text or "`" in segment.text or "\\" in segment.text:
            return False
        words = words_of(segment.text)
        if not words or words[0] != "git" or len(words) < 2:
            return False
        if words[1] == "add":
            ok, _ = _b_segment(words, cwd, repo)
            if not ok:
                return False
            continue
        if words[1] != "commit" or committed:
            return False
        rest = words[2:]
        i = 0
        while i < len(rest):
            item = rest[i]
            if item in _COMMIT_FLAGS_WITH_VALUE:
                if i + 1 >= len(rest):
                    return False
                i += 2
                continue
            if item in _COMMIT_FLAGS or re.fullmatch(r"-[aq]+", item):
                i += 1
                continue
            if re.fullmatch(r"-[aq]*m", item) and i + 1 < len(rest):
                i += 2
                continue
            return False
        committed = True
    return committed


# --- split hint for shape-refused self-checks ----------------------------------------------------


_HARMLESS = frozenset({"echo", "printf", "true", "false", ":"})


def split_hint(command: str, cwd: Path, root: Path) -> list[str]:
    """Parts to run one by one when a self-check was refused only for its shape."""
    stripped = _SAFE_REDIRECTS.sub("", command)
    parts = [part.strip() for part in re.split(r"\s*(?:&&|\|\||;)\s*", stripped)]
    if len(parts) < 2 and stripped == command:
        return []
    kept: list[str] = []
    for part in parts:
        if not part:
            return []
        words = words_of(part)
        if not words:
            return []
        if words[0] in _HARMLESS:
            # Dropped only while it can neither write a file nor feed another command.
            if any(mark in part for mark in (">", "|", "<")):
                return []
            continue
        if "$" in part or "`" in part or not direct_allowed(part, cwd, root):
            return []
        kept.append(part)
    return kept


# --- outward classification for completion -----------------------------------------------------


_LOCAL_VERBS = frozenset({"node", "python", "python3", "deno", "touch", "mkdir", "cp", "mv", "cat", "echo", "ls", "cd", "printf"})


def _local_git_remote(args: list[str]) -> bool:
    """`git remote`, `git remote -v` and `git remote get-url` read only the local config.

    `git remote show`, `update` and `prune` reach the remote, and the other forms write config.
    """
    if not args or args[0] != "remote":
        return False
    rest = args[1:]
    if all(word in {"-v", "--verbose"} for word in rest):
        return True
    if rest[:1] == ["get-url"]:
        names = [word for word in rest[1:] if word not in {"--push", "--all"}]
        return len(names) == 1 and not names[0].startswith("-")
    return False


def outward(command: str, root: Path) -> bool:
    """True when a parked step may reach outside the project or cannot be undone.

    Such a step keeps a finished run in wrap-up instead of being set aside.
    """
    segments, problem = split_command(command)
    if problem or not segments:
        return True
    for segment in segments:
        words = words_of(segment.text) or segment.text.split()
        if not words:
            continue
        verb = os.path.basename(words[0])
        if verb == "git" and _local_git_remote(words[1:]):
            continue
        if verb not in _LOCAL_VERBS:
            return True
        for word in words[1:]:
            if ".." in Path(word).parts:
                return True
            if word.startswith("/") and not _inside(Path(word), root):
                return True
    return False


def classify(
    command: str,
    cwd: Path,
    root: Path,
    *,
    charter: dict | None = None,
    extra_protected: tuple[Path, ...] = (),
    write_protected: tuple[Path, ...] = (),
) -> Verdict:
    """The guard's whole decision for one ``terminal`` command."""
    text = str(command or "")
    if not text.strip():
        return Verdict("held", "it is empty")
    refusal = refusal_for(text, cwd, extra_protected=extra_protected) or _settings_write_refusal(text, cwd, write_protected)
    if refusal:
        return Verdict("refused", refusal)
    for path_word in _write_targets(text, cwd):
        if git_internal(path_word):
            return Verdict("refused", "it writes inside .git")
    if direct_allowed(text, cwd, root, charter=charter):
        return Verdict("allow")
    hint = split_hint(text, cwd, root)
    if hint:
        return Verdict("hint", "a self-check refused only for its shape", hint_parts=hint)
    segments, problem = split_command(text)
    if problem:
        return Verdict("held", problem, outward=outward(text, root))
    for segment in segments:
        if not segment.text.strip():
            return Verdict("held", "it has an empty step", outward=outward(text, root))
        reason = uncheckable(segment.text)
        if not reason:
            words = words_of(segment.text)
            reason = "its quotes do not pair" if words is None else verb_hold(words)
        if reason:
            return Verdict("held", reason, outward=outward(text, root))
    if b_tier(text, cwd, root):
        return Verdict("B", outward=False)
    return Verdict("X", outward=outward(text, root))


def _write_targets(command: str, cwd: Path) -> list[Path]:
    """Paths a touch/mkdir/cp/mv step would write, for the ``.git`` refusal."""
    segments, _ = split_command(command)
    targets: list[Path] = []
    current = cwd
    for segment in segments:
        words = words_of(segment.text)
        if not words:
            continue
        if words[0] == "cd" and len(words) == 2:
            current = resolve_word(words[1], current)
            continue
        if words[0] in {"touch", "mkdir"}:
            targets.extend(resolve_word(w, current) for w in words[1:] if not w.startswith("-"))
        elif words[0] in {"cp", "mv"}:
            paths = [w for w in words[1:] if not w.startswith("-")]
            if paths:
                targets.append(resolve_word(paths[-1], current))
    return targets


def git_settings(path: Path) -> bool:
    """True for a path in a ``.git`` folder's ``hooks`` or its ``config`` (lexical or real)."""
    for candidate in (path, _real(path)):
        parts = [part.lower() for part in candidate.parts]
        for index, part in enumerate(parts[:-1]):
            if part == ".git" and parts[index + 1] in {"hooks", "config"}:
                return True
    return False


# Verbs that remove, move, relink or change the mode of the paths they name.
_MUTATING_ALL = frozenset({"mv", "rm", "rmdir", "unlink", "chmod", "chown", "chgrp", "chflags", "shred", "truncate"})
# Verbs whose last operand is the one written.
_MUTATING_LAST = frozenset({"cp", "ln", "install", "rsync"})


def _mutated_paths(words: list[str], cwd: Path) -> list[Path]:
    verb = os.path.basename(words[0])
    operands = [w for w in words[1:] if not w.startswith("-")]
    if verb in _MUTATING_ALL:
        return [resolve_word(w, cwd) for w in operands]
    if verb in _MUTATING_LAST and operands:
        return [resolve_word(operands[-1], cwd)]
    return []


def _settings_write_refusal(command: str, cwd: Path, write_protected: tuple[Path, ...]) -> str:
    """C-4: a step that is not a pure reader and names the run's state, git hooks or git config."""
    segments, problem = split_command(command)
    if problem:
        segments = [Segment(command, "")]
    current = cwd
    for segment in segments:
        words = words_of(segment.text)
        if words is None:
            words = segment.text.replace('"', "").replace("'", "").split()
        if not words:
            continue
        if words[0] == "cd" and len(words) == 2:
            current = resolve_word(words[1], current)
            continue
        redirects = [m.group(1) for m in re.finditer(r"\d*>+&?\s*([^\s;&|<>]+)", segment.text)]
        if reader_allowed(words) and not redirects:
            continue
        for target in _mutated_paths(words, current):
            for root in write_protected:
                if _inside(root, target) or _inside(_real(root), _real(target)):
                    return "it moves, removes or overwrites a folder that holds the run's own state"
        for value in [*redirects, *(v for word in words[1:] for v in _path_values(word))]:
            if not value or value.startswith(("http://", "https://")):
                continue
            target = resolve_word(value, current)
            if git_settings(target):
                return "it writes git hooks or git config"
            if git_internal(target):
                return "it writes inside .git"
            for root in write_protected:
                if _inside(_real(target), _real(root)) or _inside(target, root):
                    return "it writes the run's own state"
    return ""


def write_refusal(path: Path, root: Path, *, state_file: Path | None = None) -> str:
    """Why a write_file/patch target is refused outright, or an empty string."""
    reason = protected_reason(path)
    if reason:
        return f"it writes {reason}"
    if git_internal(path):
        return "it writes inside .git"
    if state_file is not None and (_inside(_real(path), _real(state_file.parent)) or _inside(path, state_file.parent)):
        return "it writes the run's own state"
    return ""
