"""Suggestion tier without `lit` (S-B-01..S-B-09) and organic enrollment of the autopilot pieces."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

try:
    from . import routing_eval
    from .plugin_register_test_support import _ASSET_DIR, _FakeCtx, _load_plugin_package
except ImportError:
    import routing_eval
    from plugin_register_test_support import _ASSET_DIR, _FakeCtx, _load_plugin_package

import suggestions  # noqa: E402

PLUGIN = Path(_ASSET_DIR)
PACKAGE = PLUGIN.parent.parent
REPO = PACKAGE.parent.parent


def _context(result) -> str:
    return str((result or {}).get("context") or "") if isinstance(result, dict) else ""


class EvalGate(unittest.TestCase):
    """The suite scores the dev half only. The held-out half is scored once, by
    `python routing_eval.py --record-heldout`, into heldout-score.json; here only its digest
    and that record are checked, so no edit loop can tune a rule against it."""

    def test_s_b_05_every_shipped_rule_meets_the_gate_on_the_dev_half(self):
        for rule in suggestions.RULES:
            result = routing_eval.score(rule, routing_eval.dev_rows())
            self.assertTrue(routing_eval.passes(result), f"{rule.skill} dev: {result}")

    def test_s_b_05_the_recorded_held_out_score_covers_these_exact_rules(self):
        record = json.loads((routing_eval.FIXTURE / "heldout-score.json").read_text(encoding="utf-8"))
        pinned = (routing_eval.FIXTURE / "heldout.sha256").read_text(encoding="utf-8").split()[0]
        self.assertEqual(record["heldout_sha256"], pinned)
        self.assertEqual(record["rules_fingerprint"], routing_eval.fingerprint(suggestions.RULES), "rules changed: re-record")
        self.assertEqual(record["candidates_fingerprint"], routing_eval.fingerprint(suggestions.CANDIDATES))
        self.assertEqual(sorted(record["shipped"]), sorted(rule.skill for rule in suggestions.RULES))
        for skill, result in record["shipped"].items():
            self.assertTrue(routing_eval.passes(result), f"{skill} held-out: {result}")

    def test_s_b_05_dropped_candidates_really_miss_the_gate(self):
        shipped = {rule.skill for rule in suggestions.RULES}
        record = json.loads((routing_eval.FIXTURE / "heldout-score.json").read_text(encoding="utf-8"))
        for rule in suggestions.CANDIDATES:
            self.assertNotIn(rule.skill, shipped)
            results = [routing_eval.score(rule, routing_eval.dev_rows()), record["candidates"][rule.skill]]
            self.assertFalse(all(routing_eval.passes(r) for r in results), rule.skill)
            self.assertIn(rule.skill, suggestions.DROPPED)
            self.assertIn(rule.skill, suggestions.CATALOG_SKILLS)

    def test_s_b_05_the_gate_tests_never_score_the_held_out_half(self):
        def refuse():
            raise AssertionError("the held-out half was read inside the suite")

        with patch.object(routing_eval, "heldout_rows", refuse):
            for name in (
                "test_s_b_05_every_shipped_rule_meets_the_gate_on_the_dev_half",
                "test_s_b_05_the_recorded_held_out_score_covers_these_exact_rules",
                "test_s_b_05_dropped_candidates_really_miss_the_gate",
            ):
                getattr(EvalGate(name), name)()

    def test_s_b_05_held_out_half_is_sealed(self):
        original = routing_eval.FIXTURE
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / "routing-eval"
            shutil.copytree(original, copy)
            with (copy / "heldout.jsonl").open("a", encoding="utf-8") as handle:
                handle.write('{"prompt": "tuned", "expect": [], "near_miss_of": []}\n')
            with patch.object(routing_eval, "FIXTURE", copy):
                with self.assertRaises(ValueError):
                    routing_eval.heldout_rows()
        pinned = (original / "heldout.sha256").read_text(encoding="utf-8").split()[0]
        self.assertEqual(pinned, hashlib.sha256((original / "heldout.jsonl").read_bytes()).hexdigest())


class RuleShape(unittest.TestCase):
    def test_s_b_01_note_offers_fired_skills_plus_none_and_loads_nothing(self):
        note = suggestions.suggestion("plot this csv")
        self.assertIn("lit-scientific-visualization", note)
        self.assertIn("or none", note)
        self.assertIn("Decide yes or no for each", note)
        self.assertIn("Nothing has loaded by itself", note)

    def test_s_b_02_lit_and_slash_prompts_get_nothing(self):
        for prompt in ("lit plot this csv", "LIT plot this csv", "/lit-scientific-visualization plot this csv", "please /lit plot data"):
            self.assertEqual(suggestions.suggestion(prompt), "", prompt)

    def test_s_b_03_fences_inline_code_and_tagged_blocks_are_stripped(self):
        self.assertEqual(suggestions.fired("fix this:\n```\nplot this csv\n```\n"), [])
        self.assertEqual(suggestions.fired("rename `plot the results csv` to run"), [])
        self.assertEqual(suggestions.fired("<task-notification>plot this csv</task-notification> ok"), [])

    def test_s_b_04_budgets(self):
        self.assertLessEqual(len(suggestions.catalog_line().encode()), suggestions.MAX_CATALOG_BYTES)
        both = suggestions.suggestion("draw a diagram and plot the results data")
        self.assertLessEqual(len(both.encode()), suggestions.MAX_SUGGESTION_BYTES)
        self.assertGreaterEqual(len(suggestions.CATALOG_SKILLS), 12)

    def test_s_b_06_korean_stems_are_bare_substrings(self):
        self.assertIn("lit-diagram-drawer", suggestions.fired("개념도를그려줘"))
        self.assertIn("lit-scientific-visualization", suggestions.fired("데이터시각화부탁"))

    def test_s_b_07_schematic_nouns_do_not_route_to_the_diagram_drawer(self):
        self.assertEqual(suggestions.fired("Draw a P&ID for the compressor"), [])
        self.assertEqual(suggestions.fired("draw an architecture diagram"), ["lit-diagram-drawer"])

    def test_s_b_08_noun_as_verb_does_not_fire(self):
        self.assertEqual(suggestions.fired("excel at writing a docx report"), [])


class HookPath(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._env = patch.dict(os.environ, {"HERMES_HOME": self._tmp.name, "LITHERMES_NO_AUTO_UPDATE": "1", "LITHERMES_NO_UPDATE_CHECK": "1"})
        self._env.start()
        self._cwd = os.getcwd()
        os.chdir(self._tmp.name)

    def tearDown(self):
        os.chdir(self._cwd)
        self._env.stop()
        self._tmp.cleanup()

    def test_plain_plot_prompt_gets_the_hint_through_pre_llm_call(self):
        context = _context(self.pkg._pre_llm_call(session_id="b1", user_message="plot this csv", platform="cli"))
        self.assertIn("<lithermes-skill-suggestion>", context)
        self.assertLessEqual(len(context.encode()), self.pkg.MAX_HOST_CONTEXT_BYTES)

    def test_catalog_line_only_when_the_host_has_no_skill_section(self):
        with patch.object(self.pkg, "_CATALOG_PER_PROMPT", False):
            self.assertNotIn("lithermes-skill-catalog", _context(self.pkg._pre_llm_call(session_id="b2", user_message="Rename the variable", platform="cli")))
        with patch.object(self.pkg, "_CATALOG_PER_PROMPT", True):
            self.assertIn("lithermes-skill-catalog", _context(self.pkg._pre_llm_call(session_id="b3", user_message="Rename the variable", platform="cli")))

    def test_register_sets_the_catalog_flag_from_the_host_surface(self):
        ctx = _FakeCtx()
        self.pkg.register(ctx)
        self.assertEqual(self.pkg._CATALOG_PER_PROMPT, not callable(getattr(ctx, "register_system_prompt_section", None)))

    def test_delegate_children_get_no_suggestion(self):
        result = self.pkg._pre_llm_call(session_id="b4", user_message="plot this csv", platform="subagent")
        self.assertNotIn("lithermes-skill-suggestion", _context(result))


class OrganicEnrollment(unittest.TestCase):
    """Every new piece is wired into the hooks, the payload manifest and the package."""

    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()

    def test_modules_are_imported_by_the_plugin_and_listed_in_the_payload_manifest(self):
        manifest = json.loads((PLUGIN / "payload-version.json").read_text(encoding="utf-8"))
        listed = {entry["path"] for entry in manifest["files"]}
        for name in ("autopilot.py", "autopilot_shell.py", "suggestions.py"):
            self.assertIn(name, listed)
            digest = hashlib.sha256((PLUGIN / name).read_bytes()).hexdigest()
            self.assertIn({"path": name, "sha256": digest}, manifest["files"])
        self.assertTrue(hasattr(self.pkg, "autopilot") and hasattr(self.pkg, "suggestions"))

    def test_hooks_route_through_the_autopilot(self):
        init = (PLUGIN / "__init__.py").read_text(encoding="utf-8")
        self.assertRegex(init, r"autopilot\.guard\(")
        self.assertRegex(init, r"autopilot\.turn_end\(")
        self.assertRegex(init, r"autopilot\.prompt_turn\(")
        self.assertRegex(init, r"autopilot\.session_finalize\(")
        self.assertRegex(init, r"autopilot\.verify_hold\(")
        self.assertRegex(init, r"_suggestion_block\(")
        commands = (PLUGIN / "core_workflow_commands.py").read_text(encoding="utf-8")
        self.assertEqual(len(re.findall(r"autopilot\.arm\(", commands)), 2)
        yaml = (PLUGIN / "plugin.yaml").read_text(encoding="utf-8")
        for hook in ("pre_llm_call", "pre_tool_call", "pre_verify", "transform_llm_output", "on_session_finalize"):
            self.assertIn(f"  - {hook}", yaml)

    def test_every_offered_skill_ships_in_the_payload(self):
        names = {rule.skill for rule in (*suggestions.RULES, *suggestions.CANDIDATES)} | set(suggestions.CATALOG_SKILLS)
        for name in sorted(names):
            self.assertTrue((PLUGIN / "skills" / name / "SKILL.md").is_file(), name)

    def test_skill_and_docs_describe_the_autopilot_and_its_host_gaps(self):
        skill = (PLUGIN / "skills" / "start-work" / "SKILL.md").read_text(encoding="utf-8")
        for phrase in ("`lit approve x`", "`lit skip-row", "IMPOSSIBLE:", "WAITING-ON-USER:", "BLOCKED: Hermes has no turn-end hook"):
            self.assertIn(phrase, skill)
        for doc in (REPO / "docs" / "guide.md", REPO / "docs" / "guide.ko.md", REPO / "README.md", REPO / "README_Ko-KR.md"):
            text = doc.read_text(encoding="utf-8")
            self.assertIn("lit approve x", text, doc.name)
            self.assertIn("BLOCKED", text, doc.name)
        changelog = (REPO / "CHANGELOG.md").read_text(encoding="utf-8")
        unreleased = changelog.split("## [Unreleased]", 1)[1].split("\n## [", 1)[0]
        self.assertIn("autopilot", unreleased.lower())
        self.assertIn("park ping", unreleased.lower())


if __name__ == "__main__":
    unittest.main()
