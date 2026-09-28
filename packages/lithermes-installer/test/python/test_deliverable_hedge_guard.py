"""Real Hermes hook tests for changed-text LitHumanizer enforcement."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from lit_humanizer_test_support import minimal_office_package
from plugin_register_test_support import _ASSET_DIR, _load_plugin_package


SKILL_DIR = Path(_ASSET_DIR) / "skills" / "lit-humanizer"
FIXTURES = SKILL_DIR / "examples" / "detector-validation"
BLOCK_TEXT = "Source: unpublished draft\n"


class HumanizerPreWriteHook(unittest.TestCase):
    def setUp(self):
        self.pkg = _load_plugin_package()
        self.guard = self.pkg.deliverable_hedge_guard
        self.guard.reset_state()
        self.temp = tempfile.TemporaryDirectory()
        self.previous_cwd = os.getcwd()
        os.chdir(self.temp.name)

    def tearDown(self):
        os.chdir(self.previous_cwd)
        self.temp.cleanup()

    def _turn(self, message="Prepare the requested report.", session="humanizer-test"):
        self.pkg._pre_llm_call(user_message=message, session_id=session, turn_id="turn-1")

    def _write(self, content, path="report.md", session="humanizer-test"):
        return self.pkg._pre_tool_call(
            tool_name="write_file",
            args={"path": path, "content": content},
            session_id=session,
            workspace=Path.cwd(),
        )

    def test_block_tier_denies_before_save_without_skill_activation(self):
        self._turn()
        denied = self._write(BLOCK_TEXT)
        self.assertEqual(denied.get("action"), "block")
        self.assertIn("LitHumanizer blocked", denied["message"])
        self.assertFalse(Path("report.md").exists())

    def test_clean_addition_passes_and_unchanged_old_block_is_not_rescanned(self):
        Path("report.md").write_text(BLOCK_TEXT, encoding="utf-8")
        self._turn("Keep the existing source note and add one factual sentence.")
        allowed = self._write(BLOCK_TEXT + "The queue processed 41 jobs.")
        self.assertIsNone(allowed)

    def test_exact_quoted_user_text_is_exempt(self):
        quote = "Source: user supplied wording"
        self._turn(f'Put this exact text in the example: "{quote}"')
        allowed = self._write(f'The example preserves "{quote}" as supplied.')
        self.assertIsNone(allowed)

    def test_warn_tier_passes_and_appears_as_contextual_advice(self):
        cases = json.loads((FIXTURES / "rule-cases.json").read_text(encoding="utf-8"))
        warning = cases["positive"]["en-not-x-but-y"] + "\n"
        self._turn()
        allowed = self._write(warning)
        self.assertIsNone(allowed)
        notice = self.guard.consume_context("humanizer-test")
        self.assertIn("warning-tier", notice)
        self.assertIn("not a ban", notice)

    def test_svg_is_prechecked_for_block_warn_clean_and_internal_paths(self):
        self._turn()
        blocked = self._write(
            '<svg xmlns="http://www.w3.org/2000/svg"><title>\n'
            "Source: unpublished draft\n</title></svg>",
            "figure.svg",
        )
        self.assertEqual(blocked.get("action"), "block")
        cases = json.loads((FIXTURES / "rule-cases.json").read_text(encoding="utf-8"))
        warning = cases["positive"]["en-not-x-but-y"] + "\n"
        self.assertIsNone(self._write(warning, "warning.svg"))
        self.assertIn("warning-tier", self.guard.consume_context("humanizer-test"))
        self.assertIsNone(self._write("The chart reports 41 measured samples.", "clean.svg"))
        self.assertIsNone(self._write(BLOCK_TEXT, "evidence/figure.svg"))

    def test_v4a_patch_blocks_added_hunk_and_ignores_removed_text(self):
        self._turn()
        denied = self.pkg._pre_tool_call(
            tool_name="patch",
            args={
                "mode": "patch",
                "patch": "*** Begin Patch\n*** Update File: report.md\n@@\n+Source: unpublished draft\n*** End Patch",
            },
            session_id="humanizer-test",
            workspace=Path.cwd(),
        )
        self.assertEqual(denied.get("action"), "block")

    def test_internal_paths_are_excluded(self):
        self._turn()
        self.assertIsNone(self._write(BLOCK_TEXT, "evidence/report.md"))
        self.assertIsNone(self._write(BLOCK_TEXT, "plans/draft.md"))
        self.assertIsNone(self._write(BLOCK_TEXT, ".hermes/private.md"))

    def test_detector_timeout_fails_open_with_one_visible_line(self):
        self._turn()
        with mock.patch.object(
            self.guard.subprocess,
            "run",
            side_effect=subprocess.TimeoutExpired(["python"], 1),
        ):
            self.assertIsNone(self._write("A new ordinary sentence."))
        notice = self.guard.consume_context("humanizer-test")
        self.assertEqual(notice.count("LitHumanizer check unavailable"), 1)
        self.assertEqual(len(notice.splitlines()), 1)

    def test_docx_postwrite_is_advisory_and_requires_rebuild(self):
        target = Path("report.docx")
        target.write_bytes(minimal_office_package(".docx", "I hope this helps."))
        self.guard.observe_completed_paths("office-session", ["report.docx"], workspace=Path.cwd())
        notice = self.guard.consume_context("office-session")
        self.assertIn("LIT_HUMANIZER_POSTWRITE_ADVISORY", notice)
        self.assertIn("rebuild", notice.lower())
        self.assertTrue(__import__("humanizer_office").extract_text(target))

    def test_script_created_office_exports_flow_through_real_post_tool_hook(self):
        docx = Path("reports/script-report.docx")
        pptx = Path("slides/script-deck.pptx")
        docx.parent.mkdir(parents=True)
        pptx.parent.mkdir(parents=True)
        docx.write_bytes(minimal_office_package(".docx", "I hope this helps."))
        pptx.write_bytes(minimal_office_package(".pptx", "I hope this helps."))
        observed = self.pkg._post_tool_call(
            tool_name="python",
            args={"command": "build deliverables"},
            result=json.dumps(
                {"artifacts": [{"output_path": str(docx)}, {"path": str(pptx)}]}
            ),
            session_id="script-office-session",
            status="ok",
            workspace=Path.cwd(),
        )
        self.assertIsNone(observed)
        delivered = self.pkg._pre_llm_call(
            user_message="What needs review?",
            session_id="script-office-session",
            platform="cli",
        )
        self.assertIsInstance(delivered, dict)
        self.assertIn("LIT_HUMANIZER_POSTWRITE_ADVISORY", delivered["context"])
        self.assertIn("Edit the source and rebuild", delivered["context"])


class StableArtifactReaderSecurity(unittest.TestCase):
    def setUp(self):
        self.pkg = _load_plugin_package()
        self.guard = self.pkg.deliverable_hedge_guard
        self.guard.reset_state()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()

    def tearDown(self):
        self.temp.cleanup()

    def test_reader_rejects_final_and_ancestor_symlinks(self):
        outside = self.root / "outside.md"
        outside.write_text("private", encoding="utf-8")
        report = self.root / "report.md"
        try:
            report.symlink_to(outside)
        except OSError as error:
            self.skipTest(f"symlink unavailable: {error}")
        self.assertIsNone(self.guard._read_stable_text_file("report.md", self.root))
        report.unlink()
        actual = self.root / "actual"
        actual.mkdir()
        (actual / "report.md").write_text("private", encoding="utf-8")
        try:
            (self.root / "linked").symlink_to(actual, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"directory symlink unavailable: {error}")
        self.assertIsNone(self.guard._read_stable_text_file("linked/report.md", self.root))

    def test_reader_rejects_oversized_files(self):
        target = self.root / "large.md"
        target.write_bytes(b"x" * (self.guard.MAX_FILE_BYTES + 1))
        self.assertIsNone(self.guard._read_stable_text_file("large.md", self.root))

    def test_reader_rejects_path_replaced_during_read(self):
        target = self.root / "report.md"
        target.write_text("ordinary prose", encoding="utf-8")
        replacement = self.root / "replacement.md"
        replacement.write_text("clean replacement", encoding="utf-8")
        original_read = self.guard.os.read
        swapped = False

        def replace_after_read(descriptor, count):
            nonlocal swapped
            chunk = original_read(descriptor, count)
            if chunk and not swapped:
                replacement.replace(target)
                swapped = True
            return chunk

        with mock.patch.object(self.guard.os, "read", side_effect=replace_after_read):
            result = self.guard._read_stable_text_file("report.md", self.root)
        self.assertTrue(swapped)
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
