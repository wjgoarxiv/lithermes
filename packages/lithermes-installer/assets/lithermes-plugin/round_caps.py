"""Whether pills and gauges end in round caps (U+E0B6, U+E0B4), for what Python draws in a terminal.

The order is the TUI widget's own (``tui-widgets/lit-card.mjs``), and one test runs both through one
table: ``LITHERMES_HUD_GLYPHS``, the saved choice, a terminal that draws the caps itself, never over SSH (the fonts here are not
the ones on screen), else an icon font on this machine, told by file names alone. The folders are read
once in a process.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Mapping

LEFT, RIGHT = "", ""
_ICON_FONT = re.compile(r"(?:nerd[ _-]?font|[a-z0-9]NF[MP]?[ _.-]).*\.(?:ttf|otf|ttc)$", re.I)
_TERMINALS = frozenset({"vscode", "wezterm", "ghostty"})
_WORDS = {"auto": "auto", "round": "round", "nerd": "round", "square": "square", "basic": "square"}
_LIMIT = 4000
_FOUND: dict[str, bool] = {}


def saved_choice(home: Path | None) -> str:
    """``round`` / ``square`` as saved beside the card's setting, else ``auto``."""
    if home is None:
        return "auto"
    try:
        saved = json.loads((Path(home) / "lithermes" / "tui-card.json").read_text(encoding="utf-8")[:4096]).get("glyphs")
    except (OSError, ValueError, TypeError, AttributeError):
        return "auto"
    return saved if saved in ("round", "square") else "auto"


def _folders(env: Mapping[str, str], platform: str) -> list[str]:
    home = env.get("HOME") or env.get("USERPROFILE") or os.path.expanduser("~")
    if platform == "darwin":
        return [os.path.join(home, "Library", "Fonts"), "/Library/Fonts"]
    if platform == "win32":
        user, system = env.get("LOCALAPPDATA"), env.get("WINDIR")
        folders = [os.path.join(user, "Microsoft", "Windows", "Fonts")] if user else []
        return folders + ([os.path.join(system, "Fonts")] if system else [])
    data = env.get("XDG_DATA_HOME", "")
    if not os.path.isabs(data):
        data = os.path.join(home, ".local", "share")
    return [os.path.join(data, "fonts"), os.path.join(home, ".fonts"), "/usr/local/share/fonts", "/usr/share/fonts"]


def has_icon_font(env: Mapping[str, str], platform: str = sys.platform, limit: int = _LIMIT) -> bool:
    level, left = _folders(env, platform), limit
    for _ in range(4):
        below: list[str] = []
        for folder in level:
            try:
                entries = list(os.scandir(folder))
            except OSError:
                continue
            for entry in entries:
                left -= 1
                if left < 0:
                    return False
                if entry.is_dir(follow_symlinks=False):
                    below.append(entry.path)
                elif entry.is_file(follow_symlinks=False) and _ICON_FONT.search(entry.name):
                    return True
        level = below
    return False


def _icon_font_once(env: Mapping[str, str]) -> bool:
    key = env.get("HOME", "")
    if key not in _FOUND:
        _FOUND[key] = has_icon_font(env)
    return _FOUND[key]


def round_caps(env: Mapping[str, str], choice: str = "auto", icon_font=None) -> bool:
    choice = _WORDS.get(env.get("LITHERMES_HUD_GLYPHS", "").strip().lower(), choice)
    if choice in ("round", "square"):
        return choice == "round"
    if env.get("WT_SESSION") or env.get("TERM_PROGRAM", "").lower() in _TERMINALS:
        return True
    if env.get("TERM") == "xterm-kitty" or env.get("KITTY_WINDOW_ID"):
        return True
    if env.get("SSH_CONNECTION"):
        return False
    return (icon_font or (lambda: _icon_font_once(env)))()
