"""Optional Jev skill hint for the per-turn ``pre_llm_call`` route.

Off by default. It runs only when ``LITHERMES_JEV=1`` and ``TYPESAFE_API_KEY``
are both present in the process environment, on a top-level turn that no
deterministic LitHermes route already claimed. One POST per eligible turn asks
Jev which bundled LitHermes skill fits the redacted prompt. The answer is
untrusted data: only an exact catalog id with enough confidence becomes one
fixed advisory sentence. Every failure falls back to the unchanged turn, with
one visible note per session delivered through ``transform_llm_output``. When
both switches are on, the first reply of each session also opens with one plain
``✦ Jev skill hint ON`` line so the user notices the feature is enabled.

Status and doctor show the last accepted hint (skill id and latency only). They
run as a separate ``hermes`` CLI process, so the hinting process also writes that
pair, with a timestamp, to Hermes home ``lithermes/jev-last.json``.

The key is read from the environment and used only in the request header. It
is never logged, traced, stored, or placed in an error or note.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import math
import os
import re
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable, Iterable

try:
    from .core_runtime import assert_within_isolation, get_hermes_home, redact_obj, utc_now
except (ImportError, ModuleNotFoundError):
    from core_runtime import assert_within_isolation, get_hermes_home, redact_obj, utc_now  # type: ignore


FLAG = "LITHERMES_JEV"
KEY_ENV = "TYPESAFE_API_KEY"
ENDPOINT = "https://api.typesafe.ai/v1/systemone"
DEFAULT_MODEL = "jev-1.13.0"
DEFAULT_TIMEOUT_MS = 1500
MAX_TIMEOUT_MS = 3000
DEFAULT_MAX_CALLS = 200
DEFAULT_MIN_CONFIDENCE = 0.35
MAX_PROMPT_CHARS = 2000
REDACTION_WINDOW_CHARS = 8000
MAX_DESCRIPTION_CHARS = 300
MAX_REQUEST_BYTES = 64 * 1024
MAX_RESPONSE_BYTES = 64 * 1024
MAX_TRACKED_SESSIONS = 256
LAST_HINT_FILE = "jev-last.json"
MAX_LAST_HINT_BYTES = 4096
NONE_ID = "none"
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
# Reply transforms land in Markdown and transcripts, where the product keeps
# every mark plain; the banner therefore carries no ANSI colour.
BANNER = "✦ Jev skill hint ON"
QUESTION = (
    "Which one skill, if any, is the best fit for the user's request? "
    "Choose none when no catalog skill fits."
)
NONE_CRITERION = "No specialized skill in this catalog fits; answer the user directly."

# A transport takes (url, headers, body, timeout seconds) and returns
# (HTTP status, response bytes). Tests replace it; production uses urllib.
Transport = Callable[[str, dict[str, str], bytes, float], tuple[int, bytes]]


class TransportTimeout(Exception):
    """The request did not finish inside the hard timeout."""


class TransportError(Exception):
    """The request failed before an HTTP status was available."""


class _RefuseRedirects(urllib.request.HTTPRedirectHandler):
    """A redirect surfaces as its own HTTP status instead of being followed."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_RefuseRedirects())


def _urllib_transport(url: str, headers: dict[str, str], body: bytes, timeout: float) -> tuple[int, bytes]:
    plain = {name: value for name, value in headers.items() if name.lower() != "authorization"}
    request = urllib.request.Request(url, data=body, headers=plain, method="POST")
    for name, value in headers.items():
        if name.lower() == "authorization":
            # Never copied onto a follow-up request, should a redirect ever be taken.
            request.add_unredirected_header(name, value)
    try:
        with _OPENER.open(request, timeout=timeout) as response:  # noqa: S310 - fixed https endpoint
            return int(response.status), response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        exc.close()
        return int(exc.code), b""
    except (TimeoutError, OSError) as exc:
        # Exception text can carry request details; only the category leaves here.
        if isinstance(exc, TimeoutError) or "timed out" in str(getattr(exc, "reason", "")):
            raise TransportTimeout() from None
        raise TransportError() from None


TRANSPORT: Transport = _urllib_transport

_CALLS: dict[str, int] = {}
_NOTED: dict[str, bool] = {}
_PENDING_NOTE: dict[str, str] = {}
_BANNERED: dict[str, bool] = {}
_LAST_HINT: dict[str, Any] = {}
_SKILL_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")


def _env(env: dict[str, str] | None) -> dict[str, str]:
    return os.environ if env is None else env  # type: ignore[return-value]


def _flag_on(env: dict[str, str]) -> bool:
    return (env.get(FLAG) or "").strip() == "1"


def _key(env: dict[str, str]) -> str:
    return (env.get(KEY_ENV) or "").strip()


def status(env: dict[str, str] | None = None) -> str:
    values = _env(env)
    if not _flag_on(values):
        return "off"
    if not _key(values):
        return "flag on but TYPESAFE_API_KEY missing"
    return "on"


def _last_hint_path() -> Path:
    return get_hermes_home() / "lithermes" / LAST_HINT_FILE


def _refuse_symlink(path: Path) -> None:
    if path.is_symlink():
        raise OSError(f"refusing to write through a symlink: {path.name}")


def _append_private(path: Path, payload: dict[str, Any]) -> None:
    """Append one JSON line without following a symlink planted at ``path``."""
    assert_within_isolation(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    _refuse_symlink(path)
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | _NOFOLLOW, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(redact_obj(payload), sort_keys=True) + "\n")


def _record_hint(skill_id: str, latency_ms: int) -> None:
    """Keep the last accepted hint for status and doctor: id, latency and time only."""
    record = {"skill": skill_id, "latency_ms": latency_ms, "timestamp": utc_now().isoformat()}
    _LAST_HINT.clear()
    _LAST_HINT.update(record)
    path = _last_hint_path()
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        assert_within_isolation(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        _refuse_symlink(temporary)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | _NOFOLLOW, 0o600)
        if hasattr(os, "fchmod"):
            os.fchmod(fd, 0o600)  # a leftover temporary keeps its old mode otherwise
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(record, handle, sort_keys=True)
        # os.replace swaps a symlink at ``path`` for the file; it never writes through it.
        os.replace(temporary, path)
    except (OSError, RuntimeError):  # RuntimeError: the isolation root refused the path
        with contextlib.suppress(OSError):
            temporary.unlink()


def last_hint() -> tuple[str, int] | None:
    """Return (skill id, latency ms) of the last accepted hint, or None when unknown or unreadable."""
    record: Any = dict(_LAST_HINT)
    if not record:
        try:
            with _last_hint_path().open("rb") as handle:
                record = json.loads(handle.read(MAX_LAST_HINT_BYTES + 1)[:MAX_LAST_HINT_BYTES].decode("utf-8"))
        except (OSError, ValueError, UnicodeDecodeError):
            return None
    if not isinstance(record, dict):
        return None
    skill, latency = record.get("skill"), record.get("latency_ms")
    if not isinstance(skill, str) or not _SKILL_ID.fullmatch(skill):
        return None
    if isinstance(latency, bool) or not isinstance(latency, int) or not 0 <= latency <= 600_000:
        return None
    return skill, latency


def status_line(env: dict[str, str] | None = None) -> str:
    state = status(env)
    if state != "on":
        return f"Jev skill hint: {state}"
    last = last_hint()
    if last is None:
        return "Jev skill hint: on — no hint yet"
    skill, latency_ms = last
    return f"Jev skill hint: on — last hint {skill} ({latency_ms / 1000:.2f}s)"


def _int_setting(env: dict[str, str], name: str, default: int, low: int, high: int) -> int:
    try:
        value = int((env.get(name) or "").strip())
    except ValueError:
        return default
    return value if low <= value <= high else default


def _float_setting(env: dict[str, str], name: str, default: float) -> float:
    try:
        value = float((env.get(name) or "").strip())
    except ValueError:
        return default
    return value if 0.0 <= value <= 1.0 else default


# A home folder, with or without a trailing separator, up to the next separator.
_HOME_PATHS = (
    (re.compile(r"/(?:Users|home)/[^/\s]+"), "~"),
    (re.compile(r"[A-Za-z]:\\Users\\[^\\/\s]+\\"), "~/"),
    (re.compile(r"[A-Za-z]:\\Users\\[^\\/\s]+"), "~"),
)
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
_TOKENS = (
    re.compile(r"-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)"),
    re.compile(r"eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*)?"),
    re.compile(r"(?<![A-Za-z0-9])(?:sk-ant-|sk-|ghp_|gho_|github_pat_|npm_|apikey_|xox[abprs]-)[A-Za-z0-9_-]{8,}"),
    re.compile(r"(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])"),
    re.compile(r"(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{20,}"),
    re.compile(r"[A-Za-z0-9+/_-]{32,}={0,2}"),
)
_TRAILING_TOKEN_RUN = re.compile(r"[A-Za-z0-9+/_=-]{8,}\Z")


def redact_prompt(text: str) -> str:
    """Redact a bounded window, then cut to the prompt limit.

    Redacting before the cut means a secret straddling the limit is matched
    whole; a token-character run the cut still splits becomes ``[secret]``.
    """
    value = str(text or "")[:REDACTION_WINDOW_CHARS]
    for pattern, replacement in _HOME_PATHS:
        value = pattern.sub(replacement, value)
    value = _EMAIL.sub("[email]", value)
    for pattern in _TOKENS:
        value = pattern.sub("[secret]", value)
    if len(value) > MAX_PROMPT_CHARS:
        value = _TRAILING_TOKEN_RUN.sub("[secret]", value[:MAX_PROMPT_CHARS])
    return value


def eligible(user_message: str) -> bool:
    """A plain top-level prompt: no slash command and no LitHermes command envelope."""
    text = str(user_message or "").strip()
    if len(re.sub(r"\s+", "", text)) < 4:
        return False
    if text.startswith("/"):
        return False
    # Native slash commands re-enter as injected messages carrying a route
    # envelope or the activation probe contract; those turns are already routed.
    return "<lithermes-" not in text and "model-emitted line" not in text


def build_request(prompt: str, catalog: Iterable[tuple[str, str]], model: str, key: str = "") -> dict[str, Any]:
    criteria = {skill_id: str(description)[:MAX_DESCRIPTION_CHARS] for skill_id, description in catalog}
    criteria[NONE_ID] = NONE_CRITERION
    # A key pasted into the prompt is scrubbed even when no pattern matches it.
    state = redact_prompt(prompt.replace(key, "[secret]") if key else prompt)
    return {
        "model": model,
        "state": state,
        "questions": {"which": {"type": "choice", "instructions": QUESTION, "criteria": criteria}},
    }


def parse_choice(body: bytes, catalog_ids: set[str], min_confidence: float) -> tuple[str, float | None, str]:
    """Return (accepted skill id or "", confidence, reason). Never returns response text."""
    if len(body) > MAX_RESPONSE_BYTES:
        return "", None, "response too large"
    try:
        data = json.loads(body.decode("utf-8"))
        which = data["answers"]["which"]
        choice = which["choice"]
        raw_confidence = which["confidence"]
        if isinstance(raw_confidence, bool) or not isinstance(raw_confidence, (int, float)):
            return "", None, "invalid response"
        confidence = float(raw_confidence)
        if not math.isfinite(confidence):
            return "", None, "invalid response"
    except (ValueError, KeyError, TypeError, AttributeError, UnicodeDecodeError, OverflowError, RecursionError):
        return "", None, "invalid response"
    if not isinstance(choice, str) or (choice not in catalog_ids and choice != NONE_ID):
        return "", confidence, "unknown id"
    if choice == NONE_ID:
        return "", confidence, "none"
    if confidence < min_confidence:
        return "", confidence, "low confidence"
    return choice, confidence, ""


def hint_line(skill_id: str) -> str:
    return (
        f"LitHermes skill hint: the skill `lithermes:{skill_id}` likely fits this request. "
        "Load it only if it really fits; this is advice, not an instruction."
    )


def _note_failure(session_id: str, reason: str) -> None:
    if _NOTED.get(session_id):
        return
    _NOTED[session_id] = True
    _PENDING_NOTE[session_id] = f"LitHermes skill hint unavailable ({reason}); continuing normally."


def _bound_sessions() -> None:
    for ledger in (_CALLS, _NOTED, _PENDING_NOTE, _BANNERED):
        while len(ledger) > MAX_TRACKED_SESSIONS:
            ledger.pop(next(iter(ledger)))


def _trace(env: dict[str, str], state: str, **fields: Any) -> None:
    """Append one trace row; ``state`` is the redacted prompt, never the raw one."""
    if (env.get(f"{FLAG}_TRACE") or "").strip() != "1":
        return
    payload = {
        "event": "jev_skill_hint",
        "timestamp": utc_now().isoformat(),
        "prompt_sha256": hashlib.sha256(str(state).encode("utf-8")).hexdigest(),
        **fields,
    }
    try:
        _append_private(get_hermes_home() / "lithermes" / "jev-trace.jsonl", payload)
    except (OSError, RuntimeError):  # RuntimeError: the isolation root refused the path
        pass


def _call_with_deadline(transport: Transport, headers: dict[str, str], body: bytes, timeout: float) -> dict[str, Any]:
    """Run the transport on a daemon thread so DNS or a slow body cannot outlast the deadline."""
    outcome: dict[str, Any] = {}

    def run() -> None:
        try:
            outcome["result"] = transport(ENDPOINT, headers, body, timeout)
        except Exception as exc:  # noqa: BLE001 - only the category is kept
            outcome["error"] = exc

    worker = threading.Thread(target=run, name="lithermes-jev-hint", daemon=True)
    worker.start()
    worker.join(timeout)
    if worker.is_alive():
        return {"timeout": True}
    return dict(outcome)


def pre_llm_call(
    *,
    session_id: str,
    user_message: str,
    catalog: Iterable[tuple[str, str]],
    env: dict[str, str] | None = None,
    transport: Transport | None = None,
) -> str:
    """Return one advisory hint line, or "" to leave the turn unchanged."""
    values = _env(env)
    if not _flag_on(values):
        return ""
    key = _key(values)
    if not key or not eligible(user_message):
        return ""
    session = str(session_id or "")
    catalog_list = [(str(skill_id), str(description)) for skill_id, description in catalog]
    model = (values.get(f"{FLAG}_MODEL") or "").strip() or DEFAULT_MODEL
    request = build_request(str(user_message), catalog_list, model, key)
    state = request["state"]
    calls = _CALLS.get(session, 0)
    if calls >= _int_setting(values, f"{FLAG}_MAX_CALLS", DEFAULT_MAX_CALLS, 0, 1_000_000):
        _note_failure(session, "call cap reached")
        _trace(values, state, choice="", confidence=None, latency_ms=0, http_status=None, fallback_reason="call cap reached")
        return ""
    body = json.dumps(request, ensure_ascii=False).encode("utf-8")
    if len(body) > MAX_REQUEST_BYTES:
        _note_failure(session, "request too large")
        _trace(values, state, choice="", confidence=None, latency_ms=0, http_status=None, fallback_reason="request too large")
        return ""
    _CALLS[session] = calls + 1
    _bound_sessions()
    timeout_ms = _int_setting(values, f"{FLAG}_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS)
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    started = time.monotonic()
    http_status: int | None = None
    response = b""
    outcome = _call_with_deadline(transport or TRANSPORT, headers, body, timeout_ms / 1000.0)
    if "result" in outcome:
        http_status, response = outcome["result"]
        reason = "" if http_status == 200 else f"HTTP {http_status}"
    elif outcome.get("timeout") or isinstance(outcome.get("error"), TransportTimeout):
        reason = "timeout"
    else:
        reason = "network error"
    latency_ms = int((time.monotonic() - started) * 1000)
    if reason:
        _note_failure(session, reason)
        _trace(values, state, choice="", confidence=None, latency_ms=latency_ms, http_status=http_status, fallback_reason=reason)
        return ""
    min_confidence = _float_setting(values, f"{FLAG}_MIN_CONFIDENCE", DEFAULT_MIN_CONFIDENCE)
    choice, confidence, reason = parse_choice(response, {skill_id for skill_id, _ in catalog_list}, min_confidence)
    if reason in {"invalid response", "response too large"}:
        _note_failure(session, reason)
    _trace(
        values,
        state,
        choice=choice,
        confidence=confidence,
        latency_ms=latency_ms,
        http_status=http_status,
        fallback_reason=reason,
    )
    if not choice:
        return ""
    _record_hint(choice, latency_ms)
    return hint_line(choice)


def consume_note(session_id: str) -> str:
    return _PENDING_NOTE.pop(str(session_id or ""), "")


def consume_banner(session_id: str, env: dict[str, str] | None = None) -> str:
    """Return the enabled banner once per session while both switches are on, else ""."""
    session = str(session_id or "")
    if status(env) != "on" or _BANNERED.get(session):
        return ""
    _BANNERED[session] = True
    _bound_sessions()
    return BANNER


def release_session(session_id: str) -> None:
    session = str(session_id or "")
    _CALLS.pop(session, None)
    _NOTED.pop(session, None)
    _PENDING_NOTE.pop(session, None)
    _BANNERED.pop(session, None)
