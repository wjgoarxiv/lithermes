"""Real Hermes hook tests for changed-text LitHumanizer enforcement."""

from __future__ import annotations

import importlib
import json
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from lit_humanizer_test_support import minimal_office_package
from plugin_register_test_support import _ASSET_DIR, _load_plugin_package


SKILL_DIR = Path(_ASSET_DIR) / "skills" / "lit-humanizer"
FIXTURES = SKILL_DIR / "examples" / "detector-validation"
BLOCK_TEXT = "Source: unpublished draft\n"
PLEDGE_CASES = json.loads(
    (Path(__file__).resolve().parent.parent / "fixtures" / "lit-humanizer-pledge-cases.json").read_text(encoding="utf-8")
)
NEW_PLEDGE_RULES = frozenset(PLEDGE_CASES["new_rule_ids"])
USER_PLEDGE = "동일 조건의 독립 성능 비교로 쓰지 않음."


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


class NegativePledgeGuard(unittest.TestCase):
    """A sentence that says what the document is not for is refused at the write hook."""

    @classmethod
    def setUpClass(cls):
        cls.detector = importlib.import_module("humanizer_detector")
        cls.rules = cls.detector.load_rules()

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

    def _write(self, content, path="report.md"):
        return self.pkg._pre_tool_call(
            tool_name="write_file",
            args={"path": path, "content": content},
            session_id="pledge-test",
            workspace=Path.cwd(),
        )

    def _scan(self, text, file="pledge.md"):
        return self.detector.scan_text(text, self.rules, file)

    def test_write_file_with_the_user_sentence_is_refused_and_names_the_rule(self):
        denied = self._write(f"## 방법\n\n{USER_PLEDGE}\n")
        self.assertIsNotNone(denied, "the user's sentence was written")
        self.assertEqual(denied.get("action"), "block")
        self.assertIn("ko-negative-pledge", denied["message"])
        self.assertFalse(Path("report.md").exists())

    def _assert_padded_pledge_is_refused_in_time(self, padded_line):
        started = time.perf_counter()
        denied = self._write(f"{USER_PLEDGE}\n{padded_line}\n")
        elapsed = time.perf_counter() - started
        self.assertIsNotNone(denied, f"fail-open after {elapsed:.2f}s: the pledge was written")
        self.assertEqual(denied.get("action"), "block")
        self.assertIn("ko-negative-pledge", denied["message"])
        self.assertLess(elapsed, 2.0, "the detector ran close to its 3 s limit")
        self.assertFalse(Path("report.md").exists())

    def test_whitespace_padded_line_cannot_push_the_pledge_past_the_detector_limit(self):
        self._assert_padded_pledge_is_refused_in_time("검증된" + " " * 4096 + "x")

    def test_very_long_whitespace_run_after_a_verb_stem_cannot_force_a_fail_open(self):
        self._assert_padded_pledge_is_refused_in_time("해석하지" + " " * 65536 + "x")

    def test_english_and_repeated_pledges_are_refused_at_the_write_hook(self):
        english = self._write("This is not intended as a head-to-head benchmark.\n")
        self.assertIsNotNone(english)
        self.assertIn("en-negative-pledge", english["message"])
        repeated = self._write("측정값은 인과관계를 주장하지 않음.\n두 공정의 차이는 최종 결론이 아님.\n")
        self.assertIsNotNone(repeated)
        self.assertIn("ko-negative-pledge-repeat", repeated["message"])

    def _patch(self, existing, **args):
        Path("report.md").write_text(existing, encoding="utf-8")
        return self.pkg._pre_tool_call(
            tool_name="patch",
            args={"path": "report.md", **args},
            session_id="pledge-test",
            workspace=Path.cwd(),
        )

    def test_edit_that_adds_a_second_pledge_to_a_file_holding_one_is_refused(self):
        # The file already carries a pledge from before; the guard judges the lines an edit touches.
        existing = f"## 방법\n\n{USER_PLEDGE}\n\n표 1은 수율을 보인다.\n"
        added = "이 자료는 비교로 해석하지 않음."
        denied = self._patch(
            existing,
            mode="replace",
            old_string="표 1은 수율을 보인다.",
            new_string=f"표 1은 수율을 보인다.\n\n{added}",
        )
        self.assertIsNotNone(denied, "the added pledge was accepted")
        self.assertEqual(denied.get("action"), "block")
        self.assertIn("ko-negative-pledge:7", denied["message"])
        self.assertNotIn(":3", denied["message"], "the old pledge was blamed on the edit")
        self.assertEqual(Path("report.md").read_text(encoding="utf-8"), existing)

    def test_patch_hunk_that_adds_a_pledge_is_refused_and_a_clean_edit_to_the_same_file_passes(self):
        existing = f"## 방법\n\n{USER_PLEDGE}\n\n표 1은 수율을 보인다.\n"
        hunk = f"*** Begin Patch\n*** Update File: report.md\n@@\n+{USER_PLEDGE}\n*** End Patch\n"
        denied = self._patch(existing, mode="patch", patch=hunk)
        self.assertIsNotNone(denied)
        self.assertIn("ko-negative-pledge", denied["message"])
        clean = self._patch(existing, mode="replace", old_string="표 1은 수율을 보인다.", new_string="표 1은 수율이 41%이다.")
        self.assertIsNone(clean, "an edit that leaves the old pledge alone was refused")

    def test_replace_edit_that_completes_a_repeated_pledge_pair_is_refused(self):
        # Replace mode scans the whole proposed text, so the document-scope rule sees the old and the new sentence.
        existing = "## 방법\n\n측정값은 인과관계를 주장하지 않음.\n\n표 1은 수율을 보인다.\n"
        denied = self._patch(
            existing,
            mode="replace",
            old_string="표 1은 수율을 보인다.",
            new_string="표 1은 수율을 보인다.\n\n두 공정의 차이는 최종 결론이 아님.",
        )
        self.assertIsNotNone(denied)
        self.assertIn("ko-negative-pledge-repeat", denied["message"])

    def test_plain_facts_notices_and_operating_rules_still_write(self):
        clean = (
            "이 장비는 방폭 구역에서 사용하지 않습니다. 냉각수로 쓰지 않음. 한 번에 0.1 이상 바꾸지 않음.\n"
            "본 자료는 투자 권유가 아닙니다.\n"
            "첨가제 B는 수율을 개선하지 않았다.\n"
            "This is not intended as a substitute for professional advice.\n"
        )
        self.assertIsNone(self._write(clean))

    def test_every_pledge_hits_its_rule_at_its_tier(self):
        rank = {"warn": 1, "block": 2}
        for pledge in PLEDGE_CASES["pledges"]:
            with self.subTest(n=pledge["n"], text=pledge["text"]):
                hits = self._scan(pledge["text"])
                if pledge["severity"] == "none":
                    self.assertEqual(hits, [])
                    continue
                top = max((rank[hit["severity"]] for hit in hits), default=0)
                self.assertEqual(top, rank[pledge["severity"]], hits)
                self.assertTrue(
                    any(hit["rule"] == pledge["rule"] and hit["severity"] == pledge["severity"] for hit in hits),
                    hits,
                )

    def test_near_misses_never_hit_a_pledge_rule(self):
        for group in ("near_misses", "near_misses_review"):
            for near in PLEDGE_CASES[group]:
                with self.subTest(group=group, text=near["text"]):
                    hits = [hit for hit in self._scan(near["text"], "near-miss.md") if hit["rule"] in NEW_PLEDGE_RULES]
                    self.assertEqual(hits, [])

    def test_whole_documents_block_or_stay_clean_per_rule(self):
        for case in PLEDGE_CASES["document_cases"]:
            with self.subTest(rule=case["rule"], text=case["text"]):
                blocked = any(
                    hit["rule"] == case["rule"] and hit["severity"] == "block"
                    for hit in self._scan(case["text"], "document.md")
                )
                self.assertEqual(blocked, case["expect"] == "block")

    def test_pledge_rules_are_block_tier_and_keep_their_scopes(self):
        by_id = {rule["id"]: rule for rule in self.rules}
        self.assertEqual({by_id[rule_id]["severity"] for rule_id in NEW_PLEDGE_RULES}, {"block"})
        self.assertEqual(by_id["ko-negative-pledge"]["scope"], "line")
        self.assertEqual(by_id["ko-negative-pledge-repeat"]["scope"], "document")
        self.assertEqual(by_id["en-negative-pledge"]["scope"], "sentence")
        self.assertEqual(by_id["ko-status-negation"]["severity"], "warn")


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
