"""Canonical detector parity and Hermes pre/post-write behavior."""

from __future__ import annotations

import importlib
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from lit_humanizer_test_support import minimal_office_package
from plugin_register_test_support import _ASSET_DIR, _load_plugin_package


SKILL_DIR = Path(_ASSET_DIR) / "skills" / "lit-humanizer"
FIXTURES = SKILL_DIR / "examples" / "detector-validation"


class HumanizerSkillLanguageContract(unittest.TestCase):
    def test_language_tracks_the_request_and_skill_stays_in_scope(self):
        skill = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("language of the current user request", skill)
        self.assertIn("does not change the language or purpose of a separate active task", skill)


def _minimal_pdf_with_text(text: str) -> bytes:
    literal = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 12 Tf 72 720 Td ({literal}) Tj ET\n".encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"endstream",
    ]
    data = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, body in enumerate(objects, start=1):
        offsets.append(len(data))
        data.extend(f"{index} 0 obj\n".encode("ascii"))
        data.extend(body)
        data.extend(b"\nendobj\n")
    xref = len(data)
    data.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets[1:]:
        data.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    data.extend(
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii")
    )
    return bytes(data)


class HumanizerDetectorParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.detector = importlib.import_module("humanizer_detector")

    def setUp(self):
        self.rules = self.detector.load_rules()
        self.cases = json.loads((FIXTURES / "rule-cases.json").read_text(encoding="utf-8"))

    def test_rule_inventory_preserves_phase_a_ids_tiers_and_context(self):
        self.assertEqual(len(self.rules), 51)
        self.assertEqual(sum(rule["severity"] == "block" for rule in self.rules), 24)
        self.assertEqual(sum(rule["severity"] == "warn" for rule in self.rules), 27)
        self.assertEqual(
            {rule["id"] for rule in self.rules},
            set(self.cases["positive"]) & set(self.cases["negative"]),
        )
        self.assertIn(
            "table_figure_caption",
            next(rule["context"] for rule in self.rules if rule["id"] == "en-plain-meta-label"),
        )

    def test_all_rule_positive_and_negative_fixtures_match(self):
        for rule in self.rules:
            with self.subTest(rule=rule["id"]):
                findings = self.detector.scan_text(self.cases["positive"][rule["id"]], [rule])
                self.assertTrue(
                    findings,
                    f"{rule['id']} missed its positive fixture",
                )
                self.assertEqual(
                    {finding["severity"] for finding in findings},
                    {rule["severity"]},
                    f"{rule['id']} changed its block/warn tier",
                )
                self.assertEqual(
                    self.detector.scan_text(self.cases["negative"][rule["id"]], [rule]),
                    [],
                    f"{rule['id']} hit its clean negative fixture",
                )

        attribution = next(rule for rule in self.rules if rule["id"] == "code-ai-attribution")
        model_name = "Co" + "dex"
        for text in (f"Generated with {model_name}", f"Co-Authored-By: {model_name}"):
            with self.subTest(attribution=text):
                self.assertTrue(self.detector.scan_text(text, [attribution]))

    def test_context_exemptions_tier_regressions_and_wrapped_sentences(self):
        rules = {rule["id"]: rule for rule in self.rules}
        self.assertEqual(len(self.cases["contextCases"]["plainSourceAttached"]), 22)
        self.assertEqual(len(self.cases["contextCases"]["tierRegressions"]), 45)
        for fixture in self.cases["contextCases"]["plainSourceAttached"]:
            selected = [rules[name] for name in ("ko-plain-meta-label", "en-plain-meta-label")]
            findings = self.detector.scan_text(fixture["text"], selected, f"caption-{fixture['name']}.md")
            self.assertEqual(findings == [], fixture["clean"], fixture["name"])
        for fixture in self.cases["contextCases"]["contrastThreshold"]:
            finding = self.detector.scan_text(fixture["text"], [rules["en-not-x-but-y"]])
            self.assertEqual(bool(finding), fixture["warn"], fixture["name"])
        for fixture in self.cases["contextCases"]["tierRegressions"]:
            selected = [rules[fixture["rule"]]]
            findings = self.detector.scan_text(fixture["text"], selected, f"tier-{fixture['name']}.md")
            if fixture["expect"] == "clean":
                self.assertEqual(findings, [], fixture["name"])
            else:
                self.assertIn(fixture["expect"], {finding["severity"] for finding in findings}, fixture["name"])
        self.assertEqual(
            self.detector.scan_text("The proposal is robust,\nintuitive, and scalable.", [rules["en-forced-triad"]])[0]["line"],
            1,
        )
        self.assertEqual(
            self.detector.scan_text("I hope this helps — 한국어 설명도 있습니다.", [rules["en-hope-helps"]])[0]["rule"],
            "en-hope-helps",
        )
        self.assertEqual(self.detector.scan_text("Source: private ledger", self.rules, "plans/internal.md"), [])

    def test_pos_real_keeps_canonical_recall_floor(self):
        lines = (FIXTURES / "pos-real.txt").read_text(encoding="utf-8").splitlines()
        findings = [self.detector.scan_text(line, self.rules, "examples/detector-validation/pos-real.txt") for line in lines if line]
        self.assertEqual(len(lines), 26)
        self.assertGreaterEqual(sum(bool(items) for items in findings), 19)


class HumanizerKoreanMetrics(unittest.TestCase):
    def test_eight_metric_goldens_preserve_threshold_behavior(self):
        module = importlib.import_module("humanizer_ko_metrics")
        cases = json.loads((FIXTURES / "ko-metrics-golden.json").read_text(encoding="utf-8"))["cases"]
        self.assertEqual(len(cases), 8)
        for case in cases:
            with self.subTest(case=case["id"]):
                result = module.analyze_ko_text(case["text"])
                if "warning" in case:
                    self.assertIn(case["warning"], result["warnings"])
                    for name, minimum in case.get("minimum", {}).items():
                        self.assertGreaterEqual(result["metrics"][name], minimum)
                else:
                    self.assertNotIn(case["absent"], result["warnings"])


class HumanizerOfficeExtraction(unittest.TestCase):
    def test_docx_and_pptx_extract_then_block_expected_text(self):
        detector = importlib.import_module("humanizer_detector")
        office = importlib.import_module("humanizer_office")
        cases = (
            ("minimal.docx", ".docx", "I hope this helps."),
            ("minimal.pptx", ".pptx", "Source: report table 4."),
        )
        with tempfile.TemporaryDirectory() as directory:
            for name, suffix, expected in cases:
                with self.subTest(name=name):
                    path = Path(directory) / name
                    path.write_bytes(minimal_office_package(suffix, expected))
                    text = office.extract_text(path)
                    self.assertIn(expected, text)
                    self.assertTrue(detector.scan_text(text, file=name))


class HumanizerNativeHooks(unittest.TestCase):
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

    def _user_turn(
        self, session="humanizer-hook", message="Write the requested report.", first_turn=False
    ):
        return self.pkg._pre_llm_call(
            user_message=message,
            session_id=session,
            turn_id="turn-1",
            is_first_turn=first_turn,
        )

    def test_always_on_rule_is_injected_through_the_native_pre_llm_path(self):
        result = self._user_turn(first_turn=True)
        self.assertIsInstance(result, dict)
        context = result["context"]
        self.assertIn('<lithermes-rules lane="static"', context)
        self.assertIn("Reader-facing writing rule", context)
        self.assertIn("Treat vocabulary, contrast, triads, and rhythm as warnings", context)

    def test_block_tier_denies_before_text_write_without_skill_activation(self):
        self._user_turn()
        denied = self.pkg._pre_tool_call(
            tool_name="write_file",
            args={"path": "report.md", "content": "Source: unpublished draft\n"},
            session_id="humanizer-hook",
        )
        self.assertIsInstance(denied, dict)
        self.assertEqual(denied.get("action"), "block")
        self.assertFalse(Path("report.md").exists())

    def test_clean_write_passes_and_existing_text_is_not_rescanned(self):
        Path("report.md").write_text("Source: inherited text\n", encoding="utf-8")
        self._user_turn(message="Keep the existing paragraph and add one sentence.")
        allowed = self.pkg._pre_tool_call(
            tool_name="write_file",
            args={"path": "report.md", "content": "Source: inherited text\nThe queue processed 41 jobs.\n"},
            session_id="humanizer-hook",
        )
        self.assertIsNone(allowed)

    def test_exact_quoted_user_text_is_exempt_from_prewrite_block(self):
        quoted = "Source: user supplied wording"
        self._user_turn(message=f'Put this in the example as a quote: "{quoted}"')
        allowed = self.pkg._pre_tool_call(
            tool_name="write_file",
            args={"path": "quote.md", "content": f"> {quoted}\n"},
            session_id="humanizer-hook",
        )
        self.assertIsNone(allowed)

    def test_docx_postwrite_hit_is_advisory_with_rebuild_instruction(self):
        office = importlib.import_module("humanizer_office")
        target = Path("report.docx")
        target.write_bytes(minimal_office_package(".docx", "I hope this helps."))
        self.guard.observe_completed_paths("office-hook", ["report.docx"], workspace=Path.cwd())
        notice = self.guard.consume_context("office-hook")
        self.assertIn("LIT_HUMANIZER_POSTWRITE_ADVISORY", notice)
        self.assertIn("rebuild", notice.lower())
        self.assertTrue(office.extract_text(target))

    @unittest.skipUnless(shutil.which("pdftotext"), "host PDF extractor unavailable")
    def test_pdf_postwrite_hit_is_advisory_when_host_extractor_exists(self):
        target = Path("report.pdf")
        target.write_bytes(_minimal_pdf_with_text("Source: unpublished draft"))
        self.guard.observe_completed_paths("pdf-hook", ["report.pdf"], workspace=Path.cwd())
        notice = self.guard.consume_context("pdf-hook")
        self.assertIn("LIT_HUMANIZER_POSTWRITE_ADVISORY", notice)
        self.assertIn("rebuild", notice.lower())

    def test_internal_paths_and_scripts_never_enter_reader_copy_context(self):
        self._user_turn(message="Prepare the document.")
        self.assertIsNone(
            self.pkg._pre_tool_call(
                tool_name="write_file",
                args={"path": "evidence/report.md", "content": "Source: internal receipt"},
                session_id="humanizer-hook",
            )
        )
        self.assertIsNone(
            self.pkg._pre_tool_call(
                tool_name="write_file",
                args={"path": "examples/sample.py", "content": "Source: code fixture"},
                session_id="humanizer-hook",
            )
        )


if __name__ == "__main__":
    unittest.main()
