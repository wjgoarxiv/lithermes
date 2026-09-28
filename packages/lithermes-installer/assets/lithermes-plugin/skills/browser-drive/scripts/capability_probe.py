"""Capability probe for the external browser driver this skill may use.

It launches only the driver's version command. It does not launch a browser.
It answers one question -- may this session drive a browser, and by what exact
command -- and answers it as data. Nothing here installs or downloads anything.
A missing driver is a normal result rather than an exception, because
"no driver" is the answer that most often decides the route.

Resolving a name is not verifying a tool. A command on PATH can carry the
expected name and be something else entirely, so identity is checked against the
version banner before the driver is reported usable. This is the engine-probe
discipline `structural-search` already applies to ast-grep in this plugin.
"""

from __future__ import annotations

import errno
import os
import re
import signal
import shutil
import subprocess
import sys
import threading
import time
import unicodedata
from pathlib import Path
from typing import Callable, Final, Optional, TypeAlias

try:
    from redaction import redact_text
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
    from redaction import redact_text

DRIVER_COMMAND = "agent-browser"
VERIFIED_VERSION_FLOOR: Final = "0.38.1"
SemVer: TypeAlias = tuple[int, int, int, tuple[str, ...] | None]

BLOCKER_UNAVAILABLE = "BLOCKED_BROWSER_DRIVER_UNAVAILABLE"
BLOCKER_IDENTITY = "BLOCKED_BROWSER_DRIVER_IDENTITY_UNVERIFIED"

BANNER_LIMIT = 200
VERSION_OUTPUT_LIMIT_BYTES = 64 * 1024
VERSION_TIMEOUT_SECONDS = 10
_VERSION_READ_CHUNK_BYTES = 4096
_GROUP_KILL_GRACE_SECONDS = 1.0

# A version banner is untrusted output from a program this session did not write.
# It is identity evidence, never instruction text. Newline delimiters are valid
# output framing; other raw C0/C1 controls and terminal sequences are not.
_CONTROL = re.compile(r"[\x00-\x09\x0b-\x0c\x0e-\x1f\x7f-\x9f]")
_ALL_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")
_ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
_OSC = re.compile(r"\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*?(?:\x07|\x1b\\)")
_BANNER_INSTRUCTION = re.compile(
    r"(?ix)"
    r"(?:\b(?:ignore|disregard|forget)[\s.-]+(?:all[\s.-]+)?(?:previous|prior|above|earlier)[\s.-]+instructions\b)"
    r"|(?:\b(?:follow|execute|run)\s+(?:these|the\s+following)\s+instructions\b)"
    r"|(?:\b(?:system|developer)\s*:\s*)"
)
_BANNER_MARKUP = re.compile(
    r"(?:</?[A-Za-z][^>\r\n]{0,128}>|<!--|-->|<!\[CDATA\[|\{\{|\}\})"
)
_VERSION_BANNER = re.compile(
    rf"{re.escape(DRIVER_COMMAND)}\s+(?P<version>v?[^\s]+)",
    re.IGNORECASE,
)
_SEMVER = re.compile(
    r"(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)"
    r"(?:-(?P<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
)
_PYTHON_FORK_DIAGNOSTIC = re.compile(
    r"(?m)^[^\r\n]*DeprecationWarning: This process \(pid=\d+\) is multi-threaded, "
    r"use of fork\(\) may lead to deadlocks in the child\.\s*$"
)


def _has_forbidden_banner_data(text: object) -> bool:
    if not isinstance(text, str):
        return False
    if _CONTROL.search(text) or _ANSI.search(text) or _OSC.search(text):
        return True
    return any(unicodedata.category(character) == "Cf" for character in text)


def _normalize_for_credential_check(text: str) -> str:
    # Whole terminal sequences are stripped before single control characters:
    # dropping only the ESC would leave "[31m"-style residue splicing a
    # credential apart so it never matches a detector pattern.
    stripped = _OSC.sub("", text)
    stripped = _ANSI.sub("", stripped)
    normalized = unicodedata.normalize("NFKC", stripped)
    return "".join(
        character
        for character in normalized
        if not _ALL_CONTROL.fullmatch(character) and unicodedata.category(character) != "Cf"
    )


def _contains_credential(text: object) -> bool:
    if not isinstance(text, str):
        return False
    normalized = _normalize_for_credential_check(text)
    return redact_text(normalized) != normalized


def _split_credential_across_streams(stdout: object, stderr: object) -> bool:
    """A secret can straddle the two pipes; each half then looks innocent on
    its own stream. The combined observation surface is both join orders of the
    already-bounded streams: the seam where one stream's last line meets the
    other's first line, and the full concatenation for fragments that controls
    have already broken across lines."""
    first = stdout if isinstance(stdout, str) else ""
    second = stderr if isinstance(stderr, str) else ""
    if not first or not second:
        return False
    for head, tail in ((first, second), (second, first)):
        seam = head.splitlines()[-1] + tail.splitlines()[0]
        if _contains_credential(seam) or _contains_credential(head + tail):
            return True
    return False


def _first_meaningful_line(text: object, *, limit: Optional[int] = BANNER_LIMIT) -> Optional[str]:
    if not isinstance(text, str):
        return None
    if _has_forbidden_banner_data(text):
        return None
    try:
        lines = text.splitlines()
        for raw in lines:
            line = raw.strip()
            if line:
                return line if limit is None else line[:limit]
    except Exception:
        return None
    return None


def _has_over_limit_line(text: object) -> bool:
    if not isinstance(text, str):
        return False
    if _has_forbidden_banner_data(text):
        return True
    try:
        for raw in text.splitlines():
            line = raw.strip()
            if line and len(line) > BANNER_LIMIT:
                return True
    except Exception:
        return True
    return False


def _without_python_fork_diagnostic(text: object) -> object:
    """Exclude only the interpreter's fork warning from line-size accounting.

    Python 3.13 can emit this diagnostic when a version fixture forks while the
    probe's bounded reader threads are active. The raw stream remains subject
    to credential, control, and unsafe-banner checks below.
    """
    if not isinstance(text, str):
        return text
    return _PYTHON_FORK_DIAGNOSTIC.sub("", text)


def _result_field(result: object, name: str) -> object:
    try:
        return getattr(result, name, None)
    except Exception:
        return None


def _banner_is_unsafe(text: object) -> bool:
    if not isinstance(text, str):
        return False
    if _contains_credential(text):
        return True
    if _has_forbidden_banner_data(text):
        return True
    try:
        lines = text.splitlines()
        for raw in lines:
            line = raw.strip()
            if line and (
                _BANNER_INSTRUCTION.search(line)
                or _BANNER_MARKUP.search(line)
                or _contains_credential(line)
            ):
                return True
    except Exception:
        return True
    return False


def _parse_semver(value: str) -> SemVer | None:
    """Parse one strict semantic version, allowing the conventional leading v."""
    version = value[1:] if value.startswith("v") else value
    match = _SEMVER.fullmatch(version)
    if match is None:
        return None
    prerelease_text = match.group("prerelease")
    prerelease = tuple(prerelease_text.split(".")) if prerelease_text else None
    if prerelease is not None and any(
        identifier.isdigit() and len(identifier) > 1 and identifier.startswith("0")
        for identifier in prerelease
    ):
        return None
    return (
        int(match.group("major")),
        int(match.group("minor")),
        int(match.group("patch")),
        prerelease,
    )


def _compare_semver(left: SemVer, right: SemVer) -> int:
    """Compare semantic-version precedence, ignoring build metadata."""
    left_core = left[:3]
    right_core = right[:3]
    if left_core != right_core:
        return 1 if left_core > right_core else -1
    left_pre = left[3]
    right_pre = right[3]
    if left_pre is None or right_pre is None:
        if left_pre is right_pre:
            return 0
        return 1 if left_pre is None else -1
    for left_id, right_id in zip(left_pre, right_pre):
        if left_id == right_id:
            continue
        left_numeric = left_id.isdigit()
        right_numeric = right_id.isdigit()
        if left_numeric and right_numeric:
            return 1 if int(left_id) > int(right_id) else -1
        if left_numeric != right_numeric:
            return -1 if left_numeric else 1
        return 1 if left_id > right_id else -1
    if len(left_pre) == len(right_pre):
        return 0
    return 1 if len(left_pre) > len(right_pre) else -1


def _identified_semver(banner: Optional[str]) -> tuple[str, SemVer] | None:
    if not isinstance(banner, str):
        return None
    match = _VERSION_BANNER.fullmatch(banner)
    if match is None:
        return None
    raw_version = match.group("version")
    parsed = _parse_semver(raw_version)
    return (raw_version, parsed) if parsed is not None else None


def _report(
    status: str,
    *,
    command=None,
    version=None,
    blocker=None,
    version_status=None,
    detail: str,
) -> dict:
    return {
        "status": status,
        "command": command,
        "version": version,
        "version_status": version_status,
        "blocker": blocker,
        "detail": detail,
    }


def _resolve(search_path: str) -> Optional[str]:
    try:
        return shutil.which(DRIVER_COMMAND, path=search_path)
    except (OSError, TypeError):
        return None


def _read_bounded_stream(stream, output: bytearray, state: dict) -> None:
    try:
        while True:
            chunk = stream.read(_VERSION_READ_CHUNK_BYTES)
            if not chunk:
                return
            if not isinstance(chunk, bytes):
                with state["lock"]:
                    state["failed"] = True
                return
            with state["lock"]:
                if state["overflowed"]:
                    return
                remaining = VERSION_OUTPUT_LIMIT_BYTES - state["total"]
                if len(chunk) > remaining:
                    if remaining > 0:
                        output.extend(chunk[:remaining])
                    state["total"] = VERSION_OUTPUT_LIMIT_BYTES
                    state["overflowed"] = True
                else:
                    output.extend(chunk)
                    state["total"] += len(chunk)
            state["changed"].set()
            if state["overflowed"]:
                return
    except Exception:
        with state["lock"]:
            state["failed"] = True
        state["changed"].set()


def _signal_process(process, signal_number: int) -> None:
    if os.name == "posix":
        try:
            os.killpg(process.pid, signal_number)
        except ProcessLookupError:
            return
        except OSError:
            pass
        try:
            process.send_signal(signal_number)
        except Exception:
            pass
        return
    try:
        if signal_number == signal.SIGTERM:
            process.terminate()
        else:
            process.kill()
    except Exception:
        pass


def _kill_process(process) -> None:
    if os.name == "posix":
        _signal_process(process, signal.SIGKILL)
        return
    try:
        process.kill()
    except Exception:
        pass


def _process_group_exists(pgid: int) -> bool:
    try:
        os.killpg(pgid, 0)
    except ProcessLookupError:
        return False
    except OSError as error:
        return error.errno != errno.ESRCH
    return True


def _await_process_group_exit(pgid: int, grace_seconds: float) -> bool:
    deadline = time.monotonic() + grace_seconds
    while _process_group_exists(pgid):
        if time.monotonic() >= deadline:
            return not _process_group_exists(pgid)
        time.sleep(0.02)
    return True


def _reap_process_group(process) -> None:
    """A same-group descendant can close its inherited pipes and ignore
    SIGTERM; the leader's exit then looks like completion while the descendant
    lives on. The group gets a finite grace period, a hard SIGKILL when it
    outlasts that, and a final existence check either way."""
    if os.name != "posix":
        return
    try:
        pgid = process.pid
        if not isinstance(pgid, int) or pgid <= 0:
            return
        if not _await_process_group_exit(pgid, _GROUP_KILL_GRACE_SECONDS):
            _signal_process(process, signal.SIGKILL)
            _await_process_group_exit(pgid, _GROUP_KILL_GRACE_SECONDS)
    except Exception:
        pass


def _terminate_and_reap(process) -> None:
    _signal_process(process, signal.SIGTERM)
    if process.poll() is None:
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            _kill_process(process)
            try:
                process.wait(timeout=1)
            except Exception:
                pass
        except Exception:
            pass
    try:
        process.wait(timeout=1)
    except Exception:
        pass
    _reap_process_group(process)


def _run_bounded_version_command(args: list[str]):
    popen_kwargs = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
    }
    if os.name == "posix":
        popen_kwargs["start_new_session"] = True
    try:
        process = subprocess.Popen(args, **popen_kwargs)
    except Exception:
        return None

    stdout = None
    stderr = None
    state = None
    threads = None
    started_threads = None
    startup_complete = False
    timed_out = False
    try:
        stdout = bytearray()
        stderr = bytearray()
        state = {
            "changed": threading.Event(),
            "failed": False,
            "lock": threading.Lock(),
            "overflowed": False,
            "total": 0,
        }
        threads = [
            threading.Thread(target=_read_bounded_stream, args=(process.stdout, stdout, state), daemon=True),
            threading.Thread(target=_read_bounded_stream, args=(process.stderr, stderr, state), daemon=True),
        ]
        started_threads = []
        deadline = time.monotonic() + VERSION_TIMEOUT_SECONDS
        for thread in threads:
            try:
                thread.start()
            except Exception:
                if thread.is_alive():
                    started_threads.append(thread)
                raise
            started_threads.append(thread)
        startup_complete = True

        while True:
            with state["lock"]:
                should_stop = state["failed"] or state["overflowed"]
            if should_stop or process.poll() is not None:
                break
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                break
            state["changed"].wait(min(remaining, 0.05))
            state["changed"].clear()

        with state["lock"]:
            should_stop = state["failed"] or state["overflowed"]
        if timed_out or should_stop:
            _terminate_and_reap(process)
        else:
            try:
                process.wait(timeout=max(0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                timed_out = True
                _terminate_and_reap(process)
    finally:
        if (
            os.name == "posix"
            or not startup_complete
            or process.poll() is None
            or (started_threads is not None and any(thread.is_alive() for thread in started_threads))
        ):
            _terminate_and_reap(process)
        if started_threads is not None:
            for thread in started_threads:
                thread.join(timeout=1)
        for stream in (process.stdout, process.stderr):
            try:
                stream.close()
            except Exception:
                pass
        if started_threads is not None:
            for thread in started_threads:
                thread.join(timeout=1)
        if started_threads is not None and any(thread.is_alive() for thread in started_threads):
            _kill_process(process)
            for thread in started_threads:
                thread.join(timeout=1)

    with state["lock"]:
        failed = state["failed"] or state["overflowed"]
    if timed_out or failed or (
        started_threads is not None and any(thread.is_alive() for thread in started_threads)
    ):
        return None
    try:
        stdout_text = bytes(stdout).decode("utf-8")
        stderr_text = bytes(stderr).decode("utf-8")
    except UnicodeDecodeError:
        return None
    return subprocess.CompletedProcess(
        args,
        process.returncode,
        stdout=stdout_text,
        stderr=stderr_text,
    )


def probe_browser_driver(path: Optional[str] = None, run_command: Optional[Callable] = None) -> dict:
    search_path = path if isinstance(path, str) else os.environ.get("PATH", "")
    command = _resolve(search_path)
    if command is None:
        return _report(
            "unavailable",
            blocker=BLOCKER_UNAVAILABLE,
            detail=f"{DRIVER_COMMAND} is not on PATH; this session cannot drive a browser",
        )
    if _contains_credential(command):
        return _report(
            "unverified-identity",
            blocker=BLOCKER_IDENTITY,
            detail=f"{DRIVER_COMMAND} resolved to an untrusted executable path",
        )

    try:
        if run_command is None:
            result = _run_bounded_version_command([command, "--version"])
        else:
            result = run_command(
                [command, "--version"],
                capture_output=True,
                text=True,
                timeout=VERSION_TIMEOUT_SECONDS,
                check=False,
            )
    except Exception:
        result = None

    version = None
    identity_line = None
    returncode = None
    stdout = None
    stderr = None
    if result is not None:
        stdout = _result_field(result, "stdout")
        stderr = _result_field(result, "stderr")
        version = _first_meaningful_line(stdout) or _first_meaningful_line(stderr)
        identity_line = _first_meaningful_line(stdout, limit=None) or _first_meaningful_line(
            stderr, limit=None
        )
        returncode = _result_field(result, "returncode")

    if (
        result is None
        or not isinstance(returncode, int)
        or isinstance(returncode, bool)
        or returncode != 0
        or version is None
        or identity_line is None
        or len(identity_line) > BANNER_LIMIT
        or _has_over_limit_line(stdout)
        or _has_over_limit_line(_without_python_fork_diagnostic(stderr))
        or _banner_is_unsafe(stdout)
        or _banner_is_unsafe(stderr)
        or _split_credential_across_streams(stdout, stderr)
    ):
        return _report(
            "unverified-identity",
            command=command,
            blocker=BLOCKER_IDENTITY,
            detail=f"{command} resolved but did not report a usable version",
        )
    identified = _identified_semver(identity_line)
    if identified is None:
        return _report(
            "unverified-identity",
            command=command,
            blocker=BLOCKER_IDENTITY,
            detail=(
                f"{command} resolved but its version banner does not identify {DRIVER_COMMAND} "
                "with a strict semantic version"
            ),
        )
    raw_version, parsed_version = identified
    version = f"{DRIVER_COMMAND} {raw_version}"
    floor = _parse_semver(VERIFIED_VERSION_FLOOR)
    if floor is None:
        return _report(
            "unverified-identity",
            command=command,
            version=version,
            blocker=BLOCKER_IDENTITY,
            version_status="unverified-floor",
            detail="the bundled browser-driver verification floor is invalid",
        )
    comparison = _compare_semver(parsed_version, floor)
    if comparison < 0:
        return _report(
            "unverified-identity",
            command=command,
            version=version,
            blocker=BLOCKER_IDENTITY,
            version_status="below-verified-floor",
            detail=f"{command} reports {version}, below verified floor {VERIFIED_VERSION_FLOOR}",
        )
    if comparison > 0:
        return _report(
            "available",
            command=command,
            version=version,
            version_status="beyond-verified",
            detail=(
                f"{command} identified itself as {version}; this version is beyond verified "
                f"floor {VERIFIED_VERSION_FLOOR}"
            ),
        )
    return _report(
        "available",
        command=command,
        version=version,
        version_status="verified-floor",
        detail=(
            f"{command} identified itself as {DRIVER_COMMAND} at verified floor "
            f"{VERIFIED_VERSION_FLOOR}"
        ),
    )


if __name__ == "__main__":
    import json
    import sys

    outcome = probe_browser_driver()
    sys.stdout.write(json.dumps(outcome, sort_keys=True) + "\n")
    sys.exit(0 if outcome["status"] == "available" else 1)
