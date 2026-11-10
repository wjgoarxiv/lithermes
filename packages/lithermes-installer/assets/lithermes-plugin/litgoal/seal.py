"""Per-install seal on litgoal state: only goals this install wrote count as its own.

`goals.json` lives in the workspace, so a cloned repository can ship one, and the model's shell can
edit one. `store.save` therefore stamps every state file with an HMAC over its content and session
id, keyed by a random per-install key kept in the plugin's data directory under the Hermes home
(`<hermes home>/lithermes/litgoal.key`, mode 0600, created on first use).

* A state file that is unsealed, edited after it was written, copied from another session, or
  written under another install's key fails `verify`; resume does not offer it and a `complete`
  status in it is not believed.
* The key is readable by anything running as the user, the model's shell included. The seal stops
  foreign and casually edited state, not an agent that deliberately reads the key file; the run
  records that decide green evidence use a key that never leaves process memory.

A key that cannot be read or created (read-only home, isolation root) means nothing is sealed:
the callers treat that as "not ours", never as "trusted".
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
from pathlib import Path
from typing import Any

try:
    from ..core_runtime import assert_within_isolation, get_hermes_home
except (ImportError, ModuleNotFoundError):  # standalone import fallback
    try:
        from core_runtime import assert_within_isolation, get_hermes_home  # type: ignore
    except (ImportError, ModuleNotFoundError):
        def assert_within_isolation(path):  # type: ignore
            return None

        def get_hermes_home() -> Path:  # type: ignore
            raw = (os.environ.get("HERMES_HOME") or "").strip()
            return Path(raw).expanduser() if raw else Path.home() / ".hermes"

KEY_FILE = "litgoal.key"
_KEY_BYTES = 32
_CACHE: dict[str, bytes] = {}


def key_path() -> Path:
    return get_hermes_home() / "lithermes" / KEY_FILE


def _read(path: Path) -> bytes | None:
    try:
        text = path.read_text(encoding="ascii").strip()
        key = bytes.fromhex(text)
    except (OSError, ValueError):
        return None
    return key if len(key) >= _KEY_BYTES else None


def _key(create: bool = True) -> bytes | None:
    """The install key, created on first use when `create`; None when it cannot be read or written."""
    try:
        path = key_path()
        cached = _CACHE.get(str(path))
        if cached is not None:
            return cached
        key = _read(path)
        if key is None and create and not path.exists():
            assert_within_isolation(path)
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError:
                key = _read(path)
            else:
                with os.fdopen(descriptor, "w", encoding="ascii") as handle:
                    handle.write(secrets.token_hex(_KEY_BYTES) + "\n")
                key = _read(path)
        if key is not None:
            _CACHE[str(path)] = key
        return key
    except Exception:  # noqa: BLE001 - an unusable key means "unsealed", never a crash
        return None


def _digest(key: bytes, session_id: str, data: dict[str, Any]) -> str:
    body = {key_name: value for key_name, value in data.items() if key_name != "seal"}
    payload = json.dumps(
        {"session": session_id, "state": body}, sort_keys=True, ensure_ascii=False, separators=(",", ":")
    )
    return hmac.new(key, payload.encode("utf-8"), hashlib.sha256).hexdigest()


def sign(session_id: str, data: dict[str, Any]) -> str | None:
    """The seal for `data` as session `session_id`, or None when no key is available."""
    key = _key()
    return _digest(key, session_id, data) if key is not None else None


def verify(session_id: str, data: Any) -> bool:
    """Whether `data` (a parsed goals.json, seal included) is exactly what this install wrote."""
    if not isinstance(data, dict) or not isinstance(data.get("seal"), str):
        return False
    key = _key(create=False)  # checking never creates a key: no key means this install sealed nothing
    return key is not None and hmac.compare_digest(data["seal"], _digest(key, session_id, data))
