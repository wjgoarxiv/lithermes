"""The installer's notices reach the user once, at the end of the first reply after them.

These drive the registered `_transform_llm_output_with_offer` the way Hermes does,
with notice files laid out in the isolated Hermes home exactly as the npm installer
writes them (`src/lib/sessionNotices.js`).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

try:
    from .natural_routing_test_support import NaturalRoutingCase
except ImportError:
    from natural_routing_test_support import NaturalRoutingCase

VERSION = "9.1.2"  # any version; the notice only has to match the install record


class InstallNotices(NaturalRoutingCase):
    def _contract(self):
        """The plugin's core_contract submodule, where the install lines live."""
        import importlib

        return importlib.import_module(f"{self.pkg.__name__}.core_contract")

    def setUp(self):
        super().setUp()
        self.home = Path(os.environ["HERMES_HOME"])
        self.notices = self.home / "lithermes" / "notices"
        self.notices.mkdir(parents=True)
        (self.home / "lithermes" / "install-manifest.json").write_text(json.dumps({"version": VERSION}), encoding="utf-8")

    def write(self, name: str, **record):
        (self.notices / f"{name}.json").write_text(json.dumps({"schemaVersion": 1, "kind": name, **record}), encoding="utf-8")

    def reply(self, text: str = "ok", session: str = "s1", platform: str = "cli") -> str:
        return self.pkg._transform_llm_output_with_offer(session_id=session, response_text=text, platform=platform) or text

    def test_the_extensions_notice_shows_once_after_the_reply(self):
        self.write("extensions", version=VERSION, upgradedFrom=None, leftovers=[])
        first = self.reply("Here is the fix.")
        self.assertTrue(first.startswith("Here is the fix."), "the reply itself is never rewritten")
        for part in (
            "LIT · LitFamily extensions",
            "LitHermes's core is complete and works on its own.",
            "are now LitFamily extensions, kept on the extension shelf at https://github.com/wjgoarxiv/wjgoarxiv-skills",
            "full LitFamily experience",
            self._contract().extension_command_line("lit-pptx"),
            "`extensions list` shows what is installed",
        ):
            self.assertIn(part, first)
        self.assertNotIn("extensions check", first, "nothing to look at in a fresh profile")
        self.assertNotIn('"${HERMES_HOME:-$HOME/.hermes}/skills/"', first, "no line merges into an old copy")
        self.assertNotIn("left these behind", first, "a fresh install has nothing to clean up")
        self.assertFalse((self.notices / "extensions.json").exists())
        self.assertTrue((self.notices / "extensions.shown.json").exists())
        self.assertEqual(self.reply("Second answer.", session="s2"), "Second answer.", "once, across sessions too")

    def test_an_upgrade_names_the_leftover_folders(self):
        cache = str(self.home / ".cache" / "lithermes" / "motion")
        self.write("extensions", version=VERSION, upgradedFrom="1.0.39", leftovers=[cache])
        shown = self.reply()
        self.assertIn("The old version left these behind. If you do not install those extensions, you can delete them:", shown)
        self.assertIn(cache, shown)

    def test_a_korean_reply_gets_the_korean_notice(self):
        self.write("extensions", version=VERSION, upgradedFrom="1.0.39", leftovers=["/x/.cache/lithermes/office"])
        shown = self.reply("고쳤습니다.")
        self.assertIn("LIT · LitFamily 확장", shown)
        self.assertIn("LitHermes의 코어는 그 자체로 완성되어 있고", shown)
        self.assertIn("LitFamily를 온전히 쓸 수 있습니다", shown)
        self.assertIn("이 확장을 설치하지 않는다면 지워도 됩니다", shown)
        self.assertIn("lithermes extensions install lit-pptx --yes", shown)
        self.assertIn("extension-backups", shown)

    def test_a_profile_that_needs_a_hand_gets_the_check_line(self):
        self.write("extensions", version=VERSION, upgradedFrom="1.0.39", leftovers=[], extensionsCheck=2)
        shown = self.reply()
        self.assertIn("This profile has 2 things to look at", shown)
        self.assertIn("npx --package @litfamily/lithermes@latest -- lithermes extensions check", shown)

    def test_a_malformed_check_count_shows_no_check_line(self):
        self.write("extensions", version=VERSION, upgradedFrom=None, leftovers=[], extensionsCheck="2")
        self.assertNotIn("extensions check", self.reply())

    def test_a_helper_or_cron_reply_leaves_the_notice_for_the_user(self):
        self.write("extensions", version=VERSION, upgradedFrom=None, leftovers=[])
        self.assertEqual(self.reply("child", platform="subagent"), "child")
        self.assertEqual(self.reply("cron", platform="cron"), "cron")
        self.assertTrue((self.notices / "extensions.json").exists())
        self.assertIn("LitFamily extensions", self.reply())

    def test_a_notice_for_a_version_that_did_not_stay_is_dropped(self):
        self.write("extensions", version="9.9.9", upgradedFrom=VERSION, leftovers=[])
        self.assertEqual(self.reply("ok"), "ok")
        self.assertFalse((self.notices / "extensions.json").exists())

    def test_a_blocked_update_names_the_files_and_the_force_line_once(self):
        self.write(
            "update-blocked",
            currentVersion=VERSION,
            targetVersion="1.0.41",
            files=[{"path": "skills/lit-pptx/SKILL.md", "change": "changed"}],
            summary="skills/lit-pptx/SKILL.md (changed)",
            replacedFilesPath=str(self.home / "lithermes" / "replaced-files"),
            userSkillsPath=str(self.home / "skills"),
            remedy="npx --yes --package @litfamily/lithermes@1.0.41 -- lithermes install --yes --force",
        )
        shown = self.reply()
        self.assertIn(
            "LitHermes could not update to 1.0.41, because files in its plugin folder were changed: skills/lit-pptx/SKILL.md (changed)",
            shown,
        )
        self.assertIn(f"You are still on {VERSION}, and those files were not touched.", shown)
        self.assertIn(str(self.home / "lithermes" / "replaced-files"), shown)
        self.assertIn("npx --yes --package @litfamily/lithermes@1.0.41 -- lithermes install --yes --force", shown)
        self.assertEqual(self.reply("again"), "again")

    def test_a_planted_link_is_not_read(self):
        target = self.home / "elsewhere.json"
        target.write_text(json.dumps({"kind": "extensions", "version": VERSION}), encoding="utf-8")
        (self.notices / "extensions.json").symlink_to(target)
        self.assertEqual(self.reply("ok"), "ok")
        self.assertTrue(target.exists())

    def test_the_plugin_registers_the_notice_module(self):
        source = (Path(self.pkg.__file__).parent / "__init__.py").read_text(encoding="utf-8")
        self.assertIn("install_notices.take_visible(", source)
