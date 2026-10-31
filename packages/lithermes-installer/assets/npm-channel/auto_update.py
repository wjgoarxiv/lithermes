"""Bounded first-turn bridge to the exact LitHermes npm transaction.

The plugin is loaded by Hermes' Python process, while the installer and its
transaction/doctor implementation are Node code.  This module therefore does
only the safe lifecycle work that belongs at the hook boundary:

* require the host's first interactive CLI turn;
* resolve the real ``HERMES_HOME`` (never a made-up ``--home`` option);
* fetch and validate one exact stable registry version;
* invoke the package's private ``__auto-update`` bridge with a credential-free
  environment and recursion guard; and
* return a redacted status without changing the model-facing route.

The Node bridge owns backup, journal, receipt, bounded npm timeout, rollback,
and post-install doctor.  Failures are deliberately fail-open for the current
Hermes turn: the old payload remains usable and the receipt records the reason.
"""

from __future__ import annotations

import calendar
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import time
import urllib.request
from urllib.parse import quote
from pathlib import Path
from typing import Any

PACKAGE_NAME = "@litfamily/lithermes"
REGISTRY_URL = f"https://registry.npmjs.org/{quote(PACKAGE_NAME, safe='')}/latest"
REQUEST_TIMEOUT_SECONDS = 3.0
# The bridge's own npx fetch plus the Node transaction (a 30-second install
# child, doctor and rollback) must finish inside this limit, so it stays well
# above the inner bound instead of killing the bridge mid-transaction.
INSTALL_TIMEOUT_SECONDS = 90.0
MAX_RESPONSE_BYTES = 64 * 1024
AUTO_UPDATE_GUARD_ENV = "LITHERMES_AUTO_UPDATE_RUNNING"
INSTALLER_DISTRIBUTION = "npm"
NPM_CHANNEL_MARKER_NAME = ".lithermes-npm-channel"
NPM_CHANNEL_TOKEN = "lithermes-npm-channel-v1\n"
ATTEMPT_RECORD_NAME = "auto-update-attempt.json"
# A broken npm fetch blocked each new session's first reply for about 70 s, so
# after a failed install the bridge waits a day before it tries the same
# release again.  The registry check still runs, and a newer release ends the
# wait at once.
FAILURE_BACKOFF_SECONDS = 24 * 60 * 60
_INSTALL_FAILURES = frozenset({
    "automatic-install-timeout",
    "automatic-install-error",
    "automatic-install-failed",
    "automatic-install-no-truthful-receipt",
    "automatic-install-version-mismatch",
})
_STABLE_SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
_ATTEMPTED_SESSIONS: set[str] = set()


class UnknownStateError(RuntimeError):
    """The child transaction could not restore the installed Hermes profile."""


def parse_stable_semver(value: Any) -> tuple[int, int, int] | None:
    if not isinstance(value, str):
        return None
    match = _STABLE_SEMVER.fullmatch(value)
    if not match:
        return None
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def resolve_hermes_home(value: Any = None) -> Path:
    raw = str(value or os.environ.get("HERMES_HOME") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return (Path.home() / ".hermes").resolve()


def _state_identity(home: Path) -> tuple[int, int] | None:
    try:
        info = (home / "lithermes").lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISDIR(info.st_mode):
        raise NotADirectoryError("LitHermes state parent is not a regular directory")
    return info.st_dev, info.st_ino


def _state_matches(home: Path, expected: tuple[int, int] | None) -> bool:
    try:
        actual = _state_identity(home)
    except OSError:
        return False
    return actual == expected


def _read_state_json(home: Path, name: str) -> dict[str, Any] | None:
    try:
        identity = _state_identity(home)
        file = home / "lithermes" / name
        leaf = file.lstat()
        if identity is None or not stat.S_ISREG(leaf.st_mode):
            return None
        fd = os.open(file, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        try:
            opened = os.fstat(fd)
            if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino) != (leaf.st_dev, leaf.st_ino):
                return None
            if not _state_matches(home, identity):
                return None
            with os.fdopen(fd, "r", encoding="utf-8", closefd=False) as stream:
                value = json.load(stream)
        finally:
            os.close(fd)
        after = file.lstat()
        if not stat.S_ISREG(after.st_mode) or (after.st_dev, after.st_ino) != (leaf.st_dev, leaf.st_ino) or not _state_matches(home, identity):
            return None
    except (OSError, ValueError, TypeError):
        return None
    return value if isinstance(value, dict) else None


def _is_tty(stream: Any) -> bool:
    try:
        return bool(stream.isatty())
    except (AttributeError, OSError):
        return False


def should_auto_update(*, kwargs: dict[str, Any] | None = None, env: dict[str, str] | None = None) -> bool:
    """Return true only for the first interactive top-level CLI turn."""

    payload = kwargs or {}
    environment = env if env is not None else os.environ
    command = str(payload.get("command") or payload.get("subcommand") or "").strip().lower()
    if command in {"help", "--help", "-h", "version", "--version", "-v", "uninstall", "hud"}:
        return False
    if payload.get("platform") in {"subagent", "delegate", "worker"}:
        return False
    if payload.get("is_first_turn") is not True:
        return False
    for key in (
        "CI",
        "NO_UPDATE_NOTIFIER",
        "LITHERMES_NO_UPDATE_CHECK",
        "LITHERMES_NO_AUTO_UPDATE",
        AUTO_UPDATE_GUARD_ENV,
    ):
        if key in environment:
            return False
    flags = payload.get("flags") if isinstance(payload.get("flags"), dict) else {}
    if payload.get("no_auto_update") or payload.get("no-auto-update") or flags.get("no-auto-update") or flags.get("no_auto_update"):
        return False
    if payload.get("json") or payload.get("dry_run") or payload.get("dry-run") or flags.get("json") or flags.get("dry-run") or flags.get("dry_run"):
        return False
    if payload.get("interactive") is False or payload.get("is_interactive") is False:
        return False
    if payload.get("interactive") is not True and payload.get("is_interactive") is not True:
        streams = payload.get("streams") or {}
        stdin = streams.get("stdin", sys.stdin) if isinstance(streams, dict) else sys.stdin
        stdout = streams.get("stdout", sys.stdout) if isinstance(streams, dict) else sys.stdout
        stderr = streams.get("stderr", sys.stderr) if isinstance(streams, dict) else sys.stderr
        if not (_is_tty(stdin) and _is_tty(stdout) and _is_tty(stderr)):
            return False
    requested_home = payload.get("hermes_home") or payload.get("hermes-home") or flags.get("hermes_home") or flags.get("hermes-home")
    home = resolve_hermes_home(requested_home)
    return home.is_dir()


def installed_version(home: Path | None = None) -> str | None:
    home = home or resolve_hermes_home()
    try:
        _state_identity(home)
    except OSError:
        return None
    manifest = _read_state_json(home, "install-manifest.json")
    value = manifest.get("version") if manifest else None
    if parse_stable_semver(value):
        return value
    try:
        match = re.search(r"^version:\s*[\"']?([^\"'\s]+)", (home / "plugins" / "lithermes" / "plugin.yaml").read_text(encoding="utf-8"), re.MULTILINE)
        if match and parse_stable_semver(match.group(1)):
            return match.group(1)
    except OSError:
        pass
    return None


def fetch_latest_version(*, opener: Any = urllib.request.urlopen) -> str:
    request = urllib.request.Request(
        REGISTRY_URL,
        headers={"Accept": "application/json", "User-Agent": f"{PACKAGE_NAME}-auto-update"},
    )
    with opener(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        status = getattr(response, "status", None)
        if status is None:
            status = getattr(response, "code", None)
        if status is not None and int(status) != 200:
            raise ValueError("npm registry response status is not 200")
        body = response.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise ValueError("npm registry response exceeds 64 KiB")
    value = json.loads(body.decode("utf-8"))
    if not isinstance(value, dict) or value.get("name") != PACKAGE_NAME:
        raise ValueError("unexpected npm registry package name")
    version = value.get("version")
    if not parse_stable_semver(version):
        raise ValueError("npm registry version is not a strict stable semver")
    return version


def sanitized_environment(home: Path | None = None, source: dict[str, str] | None = None) -> dict[str, str]:
    home = (home or resolve_hermes_home()).resolve()
    source = source if source is not None else dict(os.environ)
    safe: dict[str, str] = {}
    # The Windows keys carry no secrets and npx cannot start without them.
    for key in (
        "PATH", "HOME", "USERPROFILE", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "LC_CTYPE", "TERM",
        "SYSTEMROOT", "WINDIR", "PATHEXT", "COMSPEC", "APPDATA", "LOCALAPPDATA",
    ):
        value = source.get(key)
        if isinstance(value, str) and value:
            safe[key] = value
    ca = source.get("NODE_EXTRA_CA_CERTS")
    if isinstance(ca, str) and ca:
        safe["NODE_EXTRA_CA_CERTS"] = ca
    safe["HERMES_HOME"] = str(home)
    safe[AUTO_UPDATE_GUARD_ENV] = "1"
    return safe


def resolve_command(name: str, env: dict[str, str] | None = None, *, platform: str | None = None, which: Any = shutil.which) -> str:
    """Return the launchable path of a PATH command; on Windows npx is npx.cmd and a bare name is not found."""

    if (platform or sys.platform) != "win32":
        return name
    return which(name, path=(env or {}).get("PATH")) or name


def _read_install_receipt(home: Path) -> dict[str, Any] | None:
    return _read_state_json(home, "auto-update-receipt.json")


def _plugin_dir(home: Path, manifest: dict[str, Any] | None) -> Path:
    """Prefer the receipt's plugin path when it is a real directory, not a link."""

    raw = manifest.get("pluginPath") if isinstance(manifest, dict) else None
    if isinstance(raw, str) and raw.strip():
        candidate = Path(raw).expanduser()
        try:
            info = candidate.lstat()
        except OSError:
            info = None
        if info is not None and stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode):
            return candidate
    return home / "plugins" / "lithermes"


def _channel_marker_matches(root: Path) -> bool:
    marker = root / NPM_CHANNEL_MARKER_NAME
    expected = NPM_CHANNEL_TOKEN.encode("utf-8")
    try:
        info = marker.lstat()
        if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
            return False
        fd = os.open(marker, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            data = os.read(fd, len(expected) + 1)
        finally:
            os.close(fd)
    except OSError:
        return False
    return data == expected


def _is_npm_channel(home: Path) -> bool:
    """Return true only for an npm receipt that also carries the channel marker.

    The receipt lives outside the plugin directory and survives a catalog replace,
    so ``distribution: npm`` alone is not permission to fetch and replace the
    tree. The marker is written only by the npm installer, into the plugin
    directory, and a catalog copy never contains it. A symlink is not the marker.
    """

    manifest = _read_state_json(home, "install-manifest.json")
    if not (isinstance(manifest, dict) and manifest.get("distribution") == INSTALLER_DISTRIBUTION):
        return False
    return _channel_marker_matches(_plugin_dir(home, manifest))


def _utc_stamp(seconds: float | None = None) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() if seconds is None else seconds))


def _stamp_seconds(value: Any) -> float | None:
    try:
        return float(calendar.timegm(time.strptime(str(value), "%Y-%m-%dT%H:%M:%SZ")))
    except (TypeError, ValueError, OverflowError):
        return None


def _write_attempt(home: Path, expected: tuple[int, int] | None, record: dict[str, Any]) -> None:
    """Best-effort record for ``lithermes doctor``; never follows a planted link."""

    if expected is None or not _state_matches(home, expected):
        return
    state = home / "lithermes"
    temporary = state / f".{ATTEMPT_RECORD_NAME}.{os.getpid()}.tmp"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(temporary, flags, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump({"schemaVersion": 1, **record}, stream)
        if _state_matches(home, expected):
            os.replace(temporary, state / ATTEMPT_RECORD_NAME)
    except OSError:
        pass
    finally:
        try:
            os.unlink(temporary)
        except OSError:
            pass


def _recent_failure(home: Path, latest: str) -> dict[str, Any] | None:
    record = _read_state_json(home, ATTEMPT_RECORD_NAME)
    if not record or record.get("latestVersion") != latest or record.get("failedReason") not in _INSTALL_FAILURES:
        return None
    failed_at = _stamp_seconds(record.get("failedAt"))
    if failed_at is None or not 0 <= time.time() - failed_at < FAILURE_BACKOFF_SECONDS:
        return None
    return record


def _validated_install_receipt(receipt: dict[str, Any] | None, latest: str) -> dict[str, Any] | None:
    if not isinstance(receipt, dict):
        return None
    if receipt.get("packageName") != PACKAGE_NAME or receipt.get("status") != "updated":
        return None
    if receipt.get("targetVersion") != latest or receipt.get("doctor") != "ok":
        return None
    rollback = receipt.get("rollback")
    if not isinstance(rollback, dict) or rollback.get("status") != "not-needed":
        return None
    return receipt


def run_auto_update(*, kwargs: dict[str, Any] | None = None, env: dict[str, str] | None = None, runner: Any = subprocess.run) -> dict[str, Any]:
    """Run one exact-version bridge attempt and return a redacted status."""

    payload = kwargs or {}
    environment = env if env is not None else dict(os.environ)
    session_id = str(payload.get("session_id") or "__process__")
    if session_id in _ATTEMPTED_SESSIONS:
        return {"status": "skipped", "reason": "session-already-attempted"}
    _ATTEMPTED_SESSIONS.add(session_id)
    flags = payload.get("flags") if isinstance(payload.get("flags"), dict) else {}
    requested_home = (
        payload.get("hermes_home")
        or payload.get("hermes-home")
        or flags.get("hermes_home")
        or flags.get("hermes-home")
    )
    home = resolve_hermes_home(requested_home)
    unsafe_state = {"status": "failed", "reason": "automatic-update-unsafe-state"}
    try:
        state_identity = _state_identity(home)
    except OSError:
        return unsafe_state
    if not _is_npm_channel(home):
        return {"status": "skipped", "reason": "catalog-channel"}
    current = installed_version(home)
    if not _state_matches(home, state_identity):
        return unsafe_state
    if not current:
        return {"status": "skipped", "reason": "installed-version-unknown"}
    try:
        latest = fetch_latest_version()
    except Exception:
        if not _state_matches(home, state_identity):
            return unsafe_state
        _write_attempt(home, state_identity, {"at": _utc_stamp(), "status": "failed", "reason": "update-check-failed", "currentVersion": current})
        return {"status": "failed", "reason": "update-check-failed"}
    if not _state_matches(home, state_identity):
        return unsafe_state

    def outcome(result: dict[str, Any], failure: dict[str, Any] | None = None) -> dict[str, Any]:
        record = {"at": _utc_stamp(), "status": result["status"], "reason": result.get("reason", result["status"]),
                  "currentVersion": current, "latestVersion": latest}
        if result.get("reason") in _INSTALL_FAILURES:
            failure = {"failedAt": record["at"], "failedReason": result["reason"]}
        if failure:
            record.update(failedAt=failure["failedAt"], failedReason=failure["failedReason"])
        _write_attempt(home, state_identity, record)
        return result

    if parse_stable_semver(latest) <= parse_stable_semver(current):  # type: ignore[operator]
        return outcome({"status": "current", "currentVersion": current, "latestVersion": latest})
    previous_failure = _recent_failure(home, latest)
    if previous_failure is not None:
        return outcome({"status": "skipped", "reason": "backoff-after-failure", "latestVersion": latest}, previous_failure)
    install_env = sanitized_environment(home, environment)
    command = [
        resolve_command("npx", install_env),
        "--yes",
        "--package",
        f"{PACKAGE_NAME}@{latest}",
        "--",
        "lithermes",
        "__auto-update",
        "--hermes-home",
        str(home),
        "--installed-version",
        current,
    ]
    install_failure = None
    try:
        result = runner(
            command,
            cwd=str(Path.cwd()),
            env=install_env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=INSTALL_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        install_failure = "automatic-install-timeout"
    except (OSError, ValueError):
        install_failure = "automatic-install-error"
    try:
        completed_state = _state_identity(home)
    except OSError:
        return {**unsafe_state, "state": "unknown"}
    if state_identity is not None and completed_state != state_identity:
        return {**unsafe_state, "state": "unknown"}
    state_identity = completed_state
    if install_failure:
        return outcome({"status": "failed", "reason": install_failure})
    receipt = _read_install_receipt(home)
    if not _state_matches(home, state_identity):
        return {**unsafe_state, "state": "unknown"}
    rollback = receipt.get("rollback") if isinstance(receipt, dict) else None
    if (isinstance(receipt, dict) and receipt.get("state") == "unknown") or (
        isinstance(rollback, dict) and rollback.get("status") == "failed"
    ):
        return {"status": "failed", "reason": "automatic-update-unknown-state", "state": "unknown"}
    if getattr(result, "returncode", 1) != 0:
        return outcome({"status": "failed", "reason": "automatic-install-failed"})
    if _validated_install_receipt(receipt, latest) is None:
        return outcome({"status": "failed", "reason": "automatic-install-no-truthful-receipt"})
    actual = installed_version(home)
    if not _state_matches(home, state_identity):
        return {**unsafe_state, "state": "unknown"}
    if actual != latest:
        return outcome({"status": "failed", "reason": "automatic-install-version-mismatch"})
    return outcome({"status": "updated", "currentVersion": current, "latestVersion": latest})


def pre_llm_call(**kwargs: Any) -> None:
    """Attempt the barrier once; never inject update output into model context."""

    if not should_auto_update(kwargs=kwargs):
        return None
    result = run_auto_update(kwargs=kwargs)
    if result.get("state") == "unknown":
        raise UnknownStateError("automatic update could not verify Hermes home state")
    return None


def reset_attempts() -> None:
    """Test-only/session-reset helper; production callers need not use it."""

    _ATTEMPTED_SESSIONS.clear()
