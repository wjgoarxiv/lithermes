"""lit-team is a skill now: this session leads, members never commit (S3)."""

from __future__ import annotations

from pathlib import Path

try:
    from .natural_routing_test_support import NaturalRoutingCase, _ASSET_DIR, _FakeCtx
except ImportError:
    from natural_routing_test_support import NaturalRoutingCase, _ASSET_DIR, _FakeCtx


class LitTeamSkill(NaturalRoutingCase):
    def test_route_points_at_the_skill_and_keeps_the_lead_rules(self):
        context = self._hook("lit team mode ship the release", session="team-route")["context"]
        self.assertIn('<lithermes-skill-reference name="lit-team">', context)
        self.assertIn("this session is the lead", context)

    def test_slash_command_catalog_and_help(self):
        ctx = _FakeCtx()
        self.pkg.register(ctx)
        result = ctx.command_handlers["lit-team"]("split the migration")
        message = result["agent_message"]
        self.assertIn('<lithermes-skill-body name="lit-team">', message)
        self.assertIn("&lt;", self.core.command_lit_team("<b>x</b>")["agent_message"])
        self.assertIn("lit-team", self.core.SLASH_COMMANDS)
        self.assertIn("lit-team", [name for name, _ in self.pkg.PORTED_SKILLS])

    def test_skill_carries_the_probed_hermes_surfaces(self):
        text = (Path(_ASSET_DIR) / "skills" / "lit-team" / "SKILL.md").read_text(encoding="utf-8")
        for required in (
            "name: lit-team",
            "max_concurrent_children",
            "worktree_isolation",
            'action: "steer"',
            'action: "stop"',
            "HERDR_ENV=1",
            "git worktree add",
            ".hermes/lithermes/team/<slug>/team.md",
            "no commit, push, stash, reset",
            "Merge and re-verify",
            "receipt.md",
        ):
            self.assertIn(required, text)
