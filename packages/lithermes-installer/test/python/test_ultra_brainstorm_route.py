"""ultra-brainstorm reaches the session through every Hermes surface a skill uses (S2)."""

from __future__ import annotations

try:
    from .natural_routing_test_support import NaturalRoutingCase, _FakeCtx
except ImportError:
    from natural_routing_test_support import NaturalRoutingCase, _FakeCtx


class UltraBrainstormRoute(NaturalRoutingCase):
    def test_bare_and_lit_forms_route_to_the_skill_not_lit_brainstorm(self):
        for message in ("ultra-brainstorm names for the CLI", "lit ultra-brainstorm names for the CLI"):
            with self.subTest(message=message):
                context = self._hook(message, session=f"ub-{len(message)}")["context"]
                self.assertIn('mode="ultra-brainstorm"', context)
                self.assertIn('skill_view("lithermes:ultra-brainstorm")', context)
                self.assertNotIn('mode="lit-brainstorm"', context)
        self.assertIn('mode="lit-brainstorm"', self._hook("lit brainstorm names for the CLI", session="ub-plain")["context"])

    def test_slash_command_help_and_catalog(self):
        ctx = _FakeCtx()
        self.pkg.register(ctx)
        self.assertIn("ultra-brainstorm", ctx.command_handlers)
        result = ctx.command_handlers["ultra-brainstorm"]("names for the CLI")
        self.assertIn("ultra-brainstorm", result["agent_message"])
        self.assertIn("ultra-brainstorm", self.core.SLASH_COMMANDS)
        self.assertIn("ultra-brainstorm", [name for name, _ in self.pkg.PORTED_SKILLS])
