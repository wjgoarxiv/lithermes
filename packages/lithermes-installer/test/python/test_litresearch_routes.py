"""Organic LitResearch enrollment and natural-route coverage."""

from __future__ import annotations

try:
    from .natural_routing_test_support import NaturalRoutingCase, _skill_body
    from .plugin_register_test_support import _FakeCtx
except ImportError:
    from natural_routing_test_support import NaturalRoutingCase, _skill_body
    from plugin_register_test_support import _FakeCtx


class LitResearchRoutes(NaturalRoutingCase):
    def test_registered_skill_is_direct_surface_without_slash_command(self):
        ctx = _FakeCtx()
        self.pkg.register(ctx)

        registered = dict(ctx.skills)
        self.assertIn("litresearch", registered)
        self.assertNotIn("litresearch", ctx.commands)
        with open(registered["litresearch"], encoding="utf-8") as handle:
            self.assertEqual(handle.read().strip(), _skill_body("litresearch"))

    def test_natural_routes_point_at_the_complete_litresearch_skill(self):
        # The 45 KB body made every later-turn route spill past the host's
        # 10,000-character limit; the route now names the registered skill, and
        # skill_view loads the same SKILL.md.
        body = _skill_body("litresearch")
        self.assertIn("litresearch", {name for name, _ in self.pkg.PORTED_SKILLS})
        self.assertTrue(body)
        for message in (
            "litresearch compare public evidence",
            "lit research compare public evidence",
        ):
            with self.subTest(message=message):
                result = self._hook(message, session=f"research-{abs(hash(message))}")
                self.assertIsInstance(result, dict)
                context = result["context"]
                self.assertIn('mode="litresearch"', context)
                self.assertIn('name="litresearch"', context)
                self.assertIn('skill_view("lithermes:litresearch")', context)
                self.assertNotIn("<lithermes-skill-body", context)


if __name__ == "__main__":
    import unittest

    unittest.main()
