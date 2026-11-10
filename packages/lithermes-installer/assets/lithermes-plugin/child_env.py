"""Minimal environment for every process the plugin starts.

A child that inherits the parent environment inherits the provider keys the
host keeps there. The plugin only runs fixed helper commands (git, node, the
bundled detector, pdftotext, the browser driver version probe), none of which
needs a credential, so each is given this allowlisted copy instead.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping

ESSENTIAL_NAMES = frozenset(
    {
        "PATH", "HOME", "USER", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "SHELL", "TERM",
        # Directory locations, not credentials: git reads XDG config and the
        # node runtimes find their cache under these.
        "HERMES_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME",
    }
)
WINDOWS_NAMES = frozenset(
    {"SYSTEMROOT", "COMSPEC", "PATHEXT", "WINDIR", "USERPROFILE", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA"}
)
# The allowlist already excludes these. The pattern also refuses an explicit
# extra that looks like a credential, so the guarantee holds for every caller.
SECRET_NAME = re.compile(
    r"KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL|^(?:OPENAI|ANTHROPIC|XAI|OPENROUTER|NOUS)",
    re.IGNORECASE,
)


def scrubbed_env(
    extra: Mapping[str, str] | None = None,
    *,
    source: Mapping[str, str] | None = None,
    windows: bool | None = None,
) -> dict[str, str]:
    """Return the allowlisted environment plus explicit, non-secret extras."""

    inherited = os.environ if source is None else source
    allowed = ESSENTIAL_NAMES | WINDOWS_NAMES if (os.name == "nt" if windows is None else windows) else ESSENTIAL_NAMES
    env = {
        name: value
        for name, value in inherited.items()
        if name.upper() in allowed and value and not SECRET_NAME.search(name)
    }
    for name, value in (extra or {}).items():
        if SECRET_NAME.search(name):
            raise ValueError(f"refusing to pass credential-shaped name {name!r} to a child process")
        env[name] = value
    return env
