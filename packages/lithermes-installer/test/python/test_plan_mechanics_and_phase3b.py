"""Phase 4 plan mechanics and the Phase 3b claim-graph gate.

Phase 4 restores three mechanics the pinned source has and the reference
implementation dropped. Each is a deliberate improvement BEYOND the reference:
the mandatory draft scaffolder, the column-zero row grammar with a pre-handoff
structural self-check, and the high-accuracy review gate restored from optional
back to required.

Phase 3b is a LICENCE CONDITION, not a preference. The claim-graph gate is adapted
from insane-research (fivetaku, MIT). The gate and its ATTRIBUTION notice move
together or neither moves — `test_phase3b_and_its_attribution_are_inseparable`
fails in BOTH directions so neither can land or leave without the other.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

try:
    from .plugin_register_test_support import _ASSET_DIR, _load_plugin_package
except ImportError:
    from plugin_register_test_support import _ASSET_DIR, _load_plugin_package

_LITRESEARCH = Path(_ASSET_DIR) / "skills" / "litresearch"


class PlanMechanicsTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.core = cls.pkg.core

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.ws = Path(self._tmp.name).resolve()

    def tearDown(self):
        self._tmp.cleanup()


class MandatoryScaffolder(PlanMechanicsTestCase):
    def test_the_draft_lands_in_product_state_not_in_plans(self):
        """`plans/` holds the human-reviewed artifact; drafts are product state."""
        result = self.core.scaffold_plan("rate-limit-login", self.ws)
        draft = Path(result["draft"])
        self.assertTrue(draft.is_file())
        self.assertEqual(
            draft.relative_to(self.ws).parts[:3], (".hermes", "lithermes", "drafts")
        )
        self.assertFalse((self.ws / "plans").exists(), "draft-only must not create a plan")

    def test_rerunning_is_a_resume_safe_no_op(self):
        first = self.core.scaffold_plan("slug-a", self.ws, review_required=True)
        body = Path(first["draft"]).read_text(encoding="utf-8")
        self.assertTrue(first["created"])
        second = self.core.scaffold_plan("slug-a", self.ws, review_required=True)
        self.assertFalse(second["created"], "a re-run must not clobber an existing draft")
        self.assertEqual(Path(second["draft"]).read_text(encoding="utf-8"), body)

    def test_reset_is_the_explicit_structural_reset(self):
        self.core.scaffold_plan("slug-b", self.ws)
        self.assertTrue(self.core.scaffold_plan("slug-b", self.ws, reset=True)["created"])

    def test_the_draft_records_intent_and_review_required(self):
        result = self.core.scaffold_plan("slug-c", self.ws, intent="clear", review_required=True)
        body = Path(result["draft"]).read_text(encoding="utf-8")
        self.assertIn("intent: clear", body)
        self.assertIn("review_required: true", body)
        self.assertIn("REQUIRED: dual high-accuracy review", body)
        plain = self.core.scaffold_plan("slug-d", self.ws, intent="unclear")
        self.assertIn("review_required: false", Path(plain["draft"]).read_text(encoding="utf-8"))

    def test_a_bad_slug_or_intent_is_refused(self):
        with self.assertRaises(ValueError):
            self.core.scaffold_plan("", self.ws)
        with self.assertRaises(ValueError):
            self.core.scaffold_plan("ok", self.ws, intent="maybe")

    def test_draft_only_false_also_produces_the_plan_artifact(self):
        result = self.core.scaffold_plan("slug-e", self.ws, draft_only=False)
        self.assertTrue(Path(result["draft"]).is_file())
        self.assertTrue(Path(result["plan"]).is_file())
        self.assertEqual(Path(result["plan"]).parent.name, "plans")


class RowGrammar(PlanMechanicsTestCase):
    def test_the_shipped_template_satisfies_its_own_grammar(self):
        plan = self.core.create_plan("ship the parser", self.ws)
        self.assertEqual(
            self.core.plan_structure_issues(plan.read_text(encoding="utf-8")), []
        )

    def test_an_indented_row_is_not_a_task(self):
        issues = self.core.plan_structure_issues(
            "## Todos\n  - [ ] 1. indented\n\n## Final verification\n- [ ] F1. ok\n"
        )
        self.assertTrue(any("column zero" in issue for issue in issues))

    def test_a_row_missing_its_dot_is_rejected(self):
        issues = self.core.plan_structure_issues(
            "## Todos\n- [ ] 2 no dot\n- [ ] 1. fine\n\n## Final verification\n- [ ] F1. ok\n"
        )
        self.assertTrue(any("no dot" in issue for issue in issues))

    def test_an_implementation_row_requires_a_non_whitespace_title(self):
        issues = self.core.plan_structure_issues(
            "## Todos\n- [ ] 1.    \n\n## Final verification\n- [ ] F1. ok\n"
        )
        self.assertTrue(any("no implementation rows" in issue for issue in issues))

    def test_a_final_verifier_requires_a_non_whitespace_title(self):
        issues = self.core.plan_structure_issues(
            "## Todos\n- [ ] 1. fine\n\n## Final verification\n- [ ] F1.    \n"
        )
        self.assertTrue(any("no final-verifier rows" in issue for issue in issues))

    def test_a_final_verifier_in_the_wrong_section_is_rejected(self):
        issues = self.core.plan_structure_issues(
            "## Todos\n- [ ] 1. fine\n- [ ] F9. misplaced\n\n## Final verification\n- [ ] F1. ok\n"
        )
        self.assertTrue(any("expected a '## Final verification" in issue for issue in issues))

    def test_a_plan_with_no_rows_at_all_is_rejected(self):
        issues = self.core.plan_structure_issues("## Todos\n\nSome prose.\n\n### 1. A heading\n")
        self.assertTrue(any("no implementation rows" in issue for issue in issues))
        self.assertTrue(any("no final-verifier rows" in issue for issue in issues))

    def test_prose_headings_and_bullets_are_never_counted_as_tasks(self):
        issues = self.core.plan_structure_issues(
            "## Todos\n### 1. Not a task\n- an ordinary bullet\n- [ ] 1. real task\n"
            "\n## Final verification\n- [ ] F1. real verifier\n"
        )
        self.assertEqual(issues, [], "prose must be ignored, not miscounted")

    def test_duplicate_row_numbers_are_reported(self):
        issues = self.core.plan_structure_issues(
            "## Todos\n- [ ] 1. a\n- [ ] 1. b\n\n## Final verification\n- [ ] F1. ok\n"
        )
        self.assertTrue(any("duplicate implementation row numbers" in issue for issue in issues))

    def test_diagnostics_do_not_echo_task_content_or_arbitrary_headings(self):
        secret_tail = "horse battery staple 7391"
        secret_heading = "Production credentials for oracle 8842"
        malformed = (
            f'## Todos\n- [ ] 1 password="correct {secret_tail}"\n\n'
            f"## {secret_heading}\n- [ ] 2. Deploy the service\n\n"
            "## Final verification\n- [ ] F1. ok\n"
        )
        diagnostics = "\n".join(self.core.plan_structure_issues(malformed))
        self.assertNotIn(secret_tail, diagnostics)
        self.assertNotIn(secret_heading, diagnostics)
        with self.assertRaises(ValueError) as caught:
            self.core.assert_plan_structure(malformed)
        self.assertNotIn(secret_tail, str(caught.exception))
        self.assertNotIn(secret_heading, str(caught.exception))

    def test_assert_plan_structure_raises_on_a_malformed_plan(self):
        with self.assertRaises(ValueError) as ctx:
            self.core.assert_plan_structure("## Todos\n  - [ ] 1. indented\n")
        self.assertIn("repair the plan before handoff", str(ctx.exception))
        # and stays silent on a good one
        plan = self.core.create_plan("fine plan", self.ws)
        self.core.assert_plan_structure(plan.read_text(encoding="utf-8"))


class HighAccuracyReviewGate(PlanMechanicsTestCase):
    def test_review_modifiers_are_detected_in_any_phrasing(self):
        for text in [
            "please use high accuracy",
            "ultra high accuracy please",
            "ultra-high accuracy",
            "do a deep review afterwards",
            "고정밀로 검토해줘",
            "정밀 검토 부탁합니다",
            "엄밀 검토해주세요",
            "high-precision pass please",
            "and rigorously review it",
        ]:
            with self.subTest(text=text):
                self.assertTrue(self.core.detect_review_modifier(text))

    def test_ordinary_requests_do_not_trip_the_gate(self):
        for text in [
            "just build it",
            "review the diff",
            "add accuracy metrics to the dashboard",
            "",
            "run the tests",
        ]:
            with self.subTest(text=text):
                self.assertFalse(self.core.detect_review_modifier(text))

    def test_a_modifier_in_the_brief_sets_review_required_end_to_end(self):
        prev = os.getcwd()
        os.chdir(self.ws)
        try:
            hot = self.core.command_lit_plan("add a rate limit to /login with high accuracy")
            cold = self.core.command_lit_plan("add a rate limit to /login")
        finally:
            os.chdir(prev)
        self.assertEqual(hot["review_required"], "true")
        self.assertEqual(cold["review_required"], "false")
        self.assertIn("HIGH-ACCURACY REVIEW IS REQUIRED", hot["agent_message"])
        self.assertNotIn("HIGH-ACCURACY REVIEW IS REQUIRED", cold["agent_message"])
        # the cold path still tells the model the gate can fire in a later turn
        self.assertIn("in ANY later turn", cold["agent_message"])

    def test_lit_plan_scaffolds_the_draft_before_the_plan(self):
        prev = os.getcwd()
        os.chdir(self.ws)
        try:
            result = self.core.command_lit_plan("build the thing")
        finally:
            os.chdir(prev)
        self.assertTrue(Path(result["draft"]).is_file())
        self.assertTrue(Path(result["plan"]).is_file())
        self.assertIn("drafts", Path(result["draft"]).parts)


class Phase3bAndAttribution(unittest.TestCase):
    """The licence condition. Both directions must fail."""

    def setUp(self):
        self.skill = (_LITRESEARCH / "SKILL.md").read_text(encoding="utf-8")
        self.attribution_path = _LITRESEARCH / "ATTRIBUTION.md"

    def test_phase3b_and_its_attribution_are_inseparable(self):
        gate_present = "## Phase 3b" in self.skill or "fivetaku" in self.skill
        notice_present = self.attribution_path.is_file()
        self.assertEqual(
            gate_present, notice_present,
            "Phase 3b and ATTRIBUTION.md must move together. Shipping the adapted "
            "claim-graph gate without the MIT notice is a licence violation; keeping "
            "the notice with no gate is a dangling claim.",
        )

    def test_the_notice_credits_the_author_and_embeds_the_licence(self):
        notice = self.attribution_path.read_text(encoding="utf-8")
        self.assertIn("fivetaku", notice)
        self.assertIn("insane-research", notice)
        self.assertIn("MIT License", notice)
        self.assertIn("Permission is hereby granted, free of charge", notice)
        self.assertIn("THE SOFTWARE IS PROVIDED \"AS IS\"", notice)
        self.assertIn("https://github.com/fivetaku/insane-research", notice)
        self.assertIn("no upstream code", notice.lower().replace("no insane-research code", "no upstream code"))

    def test_the_gate_section_points_at_the_notice(self):
        self.assertIn("## Phase 3b", self.skill)
        section = self.skill.split("## Phase 3b", 1)[1].split("\n## ", 1)[0]
        self.assertIn("fivetaku", section)
        self.assertIn("ATTRIBUTION.md", section)
        self.assertIn("MIT", section)

    def test_the_gate_states_every_clearing_condition(self):
        section = self.skill.split("## Phase 3b", 1)[1].split("\n## ", 1)[0]
        for needle in [
            "2 independent source domains",
            "independent observation groups",
            "counter-search",
            "primary source",
            "observed_at",
            "Unresolved",
            "Refuted",
            "verified-claims",
        ]:
            self.assertIn(needle, section, "Phase 3b is missing: {0}".format(needle))

    def test_the_deliberate_non_port_contract_no_longer_omits_phase3b(self):
        """The old contract declared only TLS/CAPTCHA/proxy/credential non-ports."""
        boundary = self.skill.split("### deliberate non-port boundary", 1)[1][:600]
        self.assertIn("Phase 3b", boundary)
        self.assertIn("ATTRIBUTION.md", boundary)

    def test_the_notice_ships_in_the_payload_manifest(self):
        import json
        manifest = json.loads(
            (Path(_ASSET_DIR) / "payload-version.json").read_text(encoding="utf-8")
        )
        paths = {entry["path"] for entry in manifest["files"]}
        self.assertIn(
            "skills/litresearch/ATTRIBUTION.md", paths,
            "the licence notice must be pinned in the payload, or it will not ship",
        )


if __name__ == "__main__":
    unittest.main()
