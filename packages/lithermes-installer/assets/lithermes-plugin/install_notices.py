"""Notices the installer leaves for the next reply: shown once, at its end.

The npm installer writes ``<Hermes home>/lithermes/notices/<name>.json`` and the
plugin shows it under the first top-level reply that follows, through the same
``transform_llm_output`` row that carries the goal-resume offer. Two notices exist:

- ``extensions``: a new LitHermes version was installed or updated. It says the core
  works on its own, that the nine file-making skills are LitFamily extensions on the
  wjgoarxiv-skills shelf, and gives the ``extensions install`` command; when the
  installer's ``extensions check`` found something in the profile it adds the check line,
  and after an upgrade it also names the old caches that can go.
- ``update-blocked``: an automatic update was refused because the user changed files
  in the plugin folder. It names the files, says nothing was touched, and gives the
  ``--force`` line, which copies those files out first.

Showing a notice renames it to ``<name>.shown.json``. The rename is the claim: when
two sessions answer at once, only the one whose rename succeeds shows it. A delegate
child or a cron run never shows one. An ``extensions`` notice written for a version that is not
the installed one (an update that was rolled back) is dropped unseen. The reply text
itself is never rewritten, and nothing here reaches the model. Any error shows
nothing and leaves the reply as it was.
"""

from __future__ import annotations

import json
import os
import re
import stat
from pathlib import Path
from typing import Any

try:
    from .core_contract import extension_command_line
    from .core_runtime import get_hermes_home
    from .session_context import is_delegate_child_platform
except ImportError:  # standalone import (tests load modules from the payload folder)
    from core_contract import extension_command_line  # type: ignore
    from core_runtime import get_hermes_home  # type: ignore
    from session_context import is_delegate_child_platform  # type: ignore

NOTICE_NAMES = ("update-blocked", "extensions")
SHELF_URL = "https://github.com/wjgoarxiv/wjgoarxiv-skills"
# The same command as the installer's notice: it checks, moves any old copy aside, copies and writes the receipt.
INSTALL_LINES = (extension_command_line("lit-pptx"),)
CHECK_LINE = "npx --package @litfamily/lithermes@latest -- lithermes extensions check"
_MAX_BYTES = 64 * 1024
_HANGUL = re.compile(r"[가-힣]")


def _state_dir() -> Path:
    return Path(get_hermes_home()) / "lithermes"


def _read_json(file: Path) -> dict[str, Any] | None:
    try:
        leaf = file.lstat()
        if not stat.S_ISREG(leaf.st_mode) or leaf.st_size > _MAX_BYTES:
            return None
        fd = os.open(file, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(fd, "r", encoding="utf-8") as stream:
            value = json.load(stream)
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def _claim(name: str) -> dict[str, Any] | None:
    """Read a pending notice and mark it shown; None when another session got there first."""
    folder = _state_dir() / "notices"
    try:
        info = folder.lstat()
    except OSError:
        return None
    if not stat.S_ISDIR(info.st_mode):
        return None
    pending = folder / f"{name}.json"
    record = _read_json(pending)
    if record is None or record.get("kind") != name:
        return None
    try:
        os.replace(pending, folder / f"{name}.shown.json")
    except OSError:
        return None
    return record


def _installed_version() -> str | None:
    manifest = _read_json(_state_dir() / "install-manifest.json")
    version = manifest.get("version") if manifest else None
    return version if isinstance(version, str) else None


def _code(lines: tuple[str, ...] | list[str]) -> str:
    return "```sh\n" + "\n".join(lines) + "\n```"


def _paths(values: Any) -> list[str]:
    return [str(value) for value in values or [] if isinstance(value, str) and value][:8]


def _needs_action(record: dict[str, Any]) -> int:
    value = record.get("extensionsCheck")
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else 0


def extensions_text(record: dict[str, Any], *, korean: bool = False) -> str:
    leftovers = _paths(record.get("leftovers")) if record.get("upgradedFrom") else []
    needs = _needs_action(record)
    if korean:
        lines = [
            "LIT · LitFamily 확장",
            "LitHermes의 코어는 그 자체로 완성되어 있고, 혼자서도 제대로 돌아갑니다. "
            "파일을 만드는 스킬 아홉 개(발표자료, 문서, 그림, 디자인, 영상 커버)는 이제 LitFamily 확장이 되어 "
            f"확장 선반 {SHELF_URL} 에 있습니다. 쓰는 것만 골라 LitHermes 옆에 설치하면 LitFamily를 온전히 쓸 수 있습니다. "
            "아래 명령 한 줄이 스킬 하나를 넣고, 새 Hermes 세션을 열면 잡힙니다. lit-pptx 자리에 다른 이름을 넣어도 되고, "
            "같은 이름의 예전 폴더는 프로필의 extension-backups/ 로 통째로 옮겨 두므로 새 복사본에 섞이지 않습니다. "
            "`extensions list`는 설치 상태를, `update`는 새 판을, `remove`는 치우기를 맡고, 셸로 하고 싶다면 각 스텁에 같은 단계가 줄로 있습니다:",
            _code(INSTALL_LINES),
        ]
        if needs:
            lines += [f"이 프로필에 살펴볼 것이 {needs}개 있습니다(같은 이름의 다른 복사본이나 영수증 없는 폴더). 아래 명령이 하나씩 짚어 주고 고치는 줄도 알려 줍니다:", _code([CHECK_LINE])]
        if leftovers:
            lines += ["이전 버전이 남긴 파일입니다. 이 확장을 설치하지 않는다면 지워도 됩니다:", _code(leftovers)]
    else:
        lines = [
            "LIT · LitFamily extensions",
            "LitHermes's core is complete and works on its own. Nine skills that make files (decks, documents, "
            "figures, design and video covers) are now LitFamily extensions, kept on the extension shelf at "
            f"{SHELF_URL}. Install the ones you use alongside LitHermes to get the full LitFamily experience. "
            "The command below installs one, and a new Hermes session picks it up; put another name in place of lit-pptx. "
            "An old folder of that name moves whole into extension-backups/ in the profile, so nothing old mixes into the copy. "
            "`extensions list` shows what is installed, `update` refreshes and `remove` moves one aside; each stub keeps the same steps as shell lines:",
            _code(INSTALL_LINES),
        ]
        if needs:
            noun = "one thing" if needs == 1 else f"{needs} things"
            lines += [f"This profile has {noun} to look at (a second copy of a name, or a folder without a receipt). This command names each one and the line that fixes it:", _code([CHECK_LINE])]
        if leftovers:
            lines += ["The old version left these behind. If you do not install those extensions, you can delete them:", _code(leftovers)]
    return "\n".join(lines)


def blocked_text(record: dict[str, Any], *, korean: bool = False) -> str:
    target = str(record.get("targetVersion") or "the new version")
    current = str(record.get("currentVersion") or "the installed version")
    files = str(record.get("summary") or "")
    remedy = str(record.get("remedy") or "")
    kept = str(record.get("replacedFilesPath") or "lithermes/replaced-files")
    own = str(record.get("userSkillsPath") or "skills")
    if korean:
        lines = [
            f"LIT · LitHermes를 {target}(으)로 업데이트하지 못했습니다. 플러그인 폴더의 파일이 바뀌어 있어서입니다: {files}",
            f"지금은 {current} 그대로이고, 그 파일들은 건드리지 않았습니다. 아래 줄로 업데이트하면 "
            f"`--force`가 먼저 그 파일들을 {kept} 에 복사해 둡니다. 직접 만든 스킬은 업데이트가 손대지 않는 {own} 에 두세요.",
        ]
    else:
        lines = [
            f"LIT · LitHermes could not update to {target}, because files in its plugin folder were changed: {files}",
            f"You are still on {current}, and those files were not touched. To update, run the line below; "
            f"`--force` first copies those files to {kept}. Skills of your own belong in {own}, which updates leave alone.",
        ]
    if remedy:
        lines.append(_code([remedy]))
    return "\n".join(lines)


def take_visible(*, platform: Any = "", response_text: Any = "") -> str:
    """The pending notices for this reply, each shown once; "" when there are none."""
    # A helper's reply goes to its parent and a cron reply to a channel; neither is the user's next reply.
    if is_delegate_child_platform(str(platform or "")) or str(platform or "").strip().lower() == "cron":
        return ""
    korean = bool(_HANGUL.search(str(response_text or "")))
    shown: list[str] = []
    try:
        for name in NOTICE_NAMES:
            record = _claim(name)
            if record is None:
                continue
            if name == "extensions":
                if record.get("version") != _installed_version():
                    continue
                shown.append(extensions_text(record, korean=korean))
            else:
                shown.append(blocked_text(record, korean=korean))
    except Exception:  # noqa: BLE001 - a notice never costs the reply
        return ""
    return "\n\n".join(shown)
