"""`lit <prompt>` names a skill plan when more than one skill fits (S1).

The cascade still picks one primary route; the plan adds the other matched content routes as
companions, capped at three skills, plus lit-crucible for a risky design ask. `lit +x +y` forces
the plan. Read-only primaries gain no write-capable companion. Code spans and fences are inert.
"""

from __future__ import annotations

from pathlib import Path

try:
    from .natural_routing_test_support import NaturalRoutingCase
except ImportError:
    from natural_routing_test_support import NaturalRoutingCase


def _plan_line(context: str) -> str:
    for line in context.splitlines():
        if line.startswith("Skill plan: "):
            return line
    return ""


class SkillPlan(NaturalRoutingCase):
    def _context(self, message: str) -> str:
        result = self._hook(message)
        self.assertIsInstance(result, dict, message)
        return str(result.get("context") or "")

    def test_two_content_skills_become_a_plan_in_cascade_order(self):
        context = self._context("lit make a 10-slide deck. Then draw a flowchart of the release steps.")
        self.assertIn("<lithermes-skill-plan>", context)
        # The route already fills most of the budget, so the hook sends the short form; the install line names both.
        self.assertEqual(_plan_line(context), "Skill plan: 1 lit-pptx (primary) → 2 lit-diagram-drawer")
        self.assertEqual(
            _plan_line(self._full_block("lit make a 10-slide deck. Then draw a flowchart of the release steps.")),
            "Skill plan: 1 lit-pptx (primary) (not installed) → 2 lit-diagram-drawer (not installed)",
        )

    def test_korean_prompt_names_deck_and_report(self):
        line = _plan_line(self._context("lit 발표자료 만들고 보고서도 작성해줘"))
        self.assertTrue(line.startswith("Skill plan: 1 lit-pptx (primary)"), line)
        self.assertIn("2 lit-docx", line)

    def test_plain_prompt_keeps_one_route_and_no_plan(self):
        for message in ("lit fix the typo in README.md", "lit README.md 오타를 고쳐줘", "lit adhd"):
            with self.subTest(message=message):
                self.assertNotIn("<lithermes-skill-plan>", self._context(message))

    def test_risky_design_adds_crucible_first(self):
        line = _plan_line(self._full_block("lit redesign the dashboard layout"))
        self.assertEqual(line, "Skill plan: 1 frontend-ui-ux (primary) (not installed) → 2 lit-crucible")
        self.assertIn("lit-crucible", _plan_line(self._context("lit redesign the dashboard layout")))
        line = _plan_line(self._context("lit 결제 모듈 아키텍처 설계해줘"))
        self.assertIn("lit-crucible", line)

    def test_explain_ask_never_adds_crucible(self):
        self.assertNotIn("<lithermes-skill-plan>", self._context("lit explain the architecture of the parser"))

    def _full_block(self, message: str) -> str:
        """The unshed plan block, as a turn with room for it would carry it."""
        visible = self.core.strip_markdown_code(message, preserve_offsets=True)
        hatch = self.core._skill_plan.parse_skill_hatch(visible, message)
        return self.core.skill_plan_block(hatch.rest if hatch else message, hatch)

    def test_cap_is_three_skills(self):
        context = self._full_block(
            "lit redesign the settings page. Make a slide deck about it. Write a report too. Draw a flowchart of it."
        )
        line = _plan_line(context)
        self.assertEqual(line.count(" → "), 2, line)
        self.assertIn("Left out:", context)
        self.assertIn("(over the cap)", context)

    def test_installed_extension_is_offered_without_install_line(self):
        home = Path(self.isolated_root.name) / "home"
        for skill in ("lit-pptx", "lit-diagram-drawer"):
            (home / "skills" / skill).mkdir(parents=True)
            (home / "skills" / skill / "SKILL.md").write_text(f"---\nname: {skill}\n---\n", encoding="utf-8")
        context = self._context("lit make a 10-slide deck. Then draw a flowchart of the release steps.")
        self.assertEqual(_plan_line(context), "Skill plan: 1 lit-pptx (primary) → 2 lit-diagram-drawer")
        self.assertNotIn("Not installed on this profile", context)
        self.assertIn("lit-pptx", context)

    def test_missing_extension_gets_one_install_line(self):
        message = "lit make a 10-slide deck. Then draw a flowchart of the release steps."
        for context in (self._context(message), self._full_block(message)):
            install = [line for line in context.splitlines() if line.startswith("Not installed on this profile")]
            self.assertEqual(len(install), 1)
            self.assertIn("lit-pptx, lit-diagram-drawer", install[0])
            self.assertIn("extensions install <id> --yes", install[0])
        # A moved skill that is not installed never appears in the catalog.
        catalog = next(line for line in self._full_block(message).splitlines() if line.startswith("Catalog: "))
        self.assertNotIn("lit-docx", catalog)

    def test_escape_hatch_forces_the_plan_and_is_cut_from_the_task(self):
        hooked = self._context("lit +viz +review +nope build the results page")
        self.assertIn("lit-scientific-visualization", _plan_line(hooked))
        self.assertNotIn("+viz", hooked.replace("lit +…", ""))
        context = self._full_block("lit +viz +review +nope build the results page")
        line = _plan_line(context)
        self.assertIn("lit-scientific-visualization", line)
        self.assertIn("review-work", line)
        self.assertIn("keep it exactly", context)
        self.assertIn("Ignored unknown plan names: +nope.", context)
        self.assertNotIn("Catalog: ", context)
        self.assertNotIn("+viz", context.replace("lit +…", ""))

    def test_read_only_primary_gains_no_writer(self):
        self.assertNotIn("<lithermes-skill-plan>", self._context("lit review this branch and redesign the settings page"))
        context = self._context("lit +ui +crucible review this branch")
        line = _plan_line(context)
        self.assertIn("lit-crucible", line)
        self.assertNotIn("frontend-ui-ux", line)
        self.assertIn("Left out: frontend-ui-ux (review-work is read-only).", context)

    def test_code_spans_and_fences_are_inert(self):
        for message in (
            "please explain `lit +viz +ui make the page`",
            "explain this:\n```\nlit make a deck. Then draw a flowchart.\n```",
        ):
            with self.subTest(message=message):
                result = self._hook(message)
                context = str((result or {}).get("context") or "")
                self.assertNotIn("<lithermes-skill-plan>", context)

    def test_plan_block_echoes_no_prompt_text(self):
        context = self._context("lit make a 10-slide deck about SECRET-MARKER. Then draw a flowchart of SECRET-MARKER.")
        block = context[context.index("<lithermes-skill-plan>"):]
        self.assertNotIn("SECRET-MARKER", block)

    def test_delegate_child_turn_gets_no_plan(self):
        result = self.pkg._pre_llm_call(
            user_message="lit make a 10-slide deck. Then draw a flowchart.", session_id="child", platform="subagent"
        )
        self.assertNotIn("<lithermes-skill-plan>", str((result or {}).get("context") or ""))


class SkillPlanBudget(NaturalRoutingCase):
    def _context(self, message: str) -> str:
        return str(self._hook(message)["context"])

    def test_plan_never_pushes_the_turn_past_the_host_cap(self):
        for message in (
            "Create a clear architecture or data-flow diagram for service operators.\n\nlit",
            "lit make a 10-slide deck. Then draw a flowchart of the release steps. Also write a report.",
        ):
            with self.subTest(message=message):
                context = self._context(message)
                self.assertLessEqual(len(context.encode("utf-8")), self.pkg.MAX_HOST_CONTEXT_BYTES)
        self.assertEqual(self.core._HOST_CONTEXT_CAP, self.pkg.MAX_HOST_CONTEXT_BYTES)

    def test_drawing_an_architecture_is_not_a_risky_design(self):
        from skill_plan import wants_crucible
        self.assertFalse(wants_crucible("draw the service architecture diagram", ["lit-diagram-drawer"]))
        self.assertTrue(wants_crucible("migrate the session store to postgres", ["litwork"]))


if __name__ == "__main__":
    import unittest

    unittest.main()
