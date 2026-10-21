"""Per-route byte budget for the context pre_llm_call hands to Hermes.

Hermes shows the model only part of a large hook result: the plugin's own
composition caps a turn that carries the static rules lane at
MAX_HOST_CONTEXT_BYTES, and the host spills any later-turn result above 10,000
characters to disk, keeping 500 characters from each end. A route that emits
100 KB therefore reaches the model as its first and last few lines. These tests
pin each route under a budget that survives both limits, and check that the
instructions which matter sit inside it and that every deferred pointer resolves.
"""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path

try:
    from .natural_routing_test_support import _ASSET_DIR, NaturalRoutingCase
except ImportError:
    from natural_routing_test_support import _ASSET_DIR, NaturalRoutingCase

HOST_SPILL_CHARS = 10_000
WORKSPACE_PATH_CHARS = 146
PROBE_WINDOW_BYTES = 600

LITWORK_ROUTES = {
    "lit-en": "lit fix the typo in README.md",
    "lit-ko": "lit README.md 오타를 고쳐줘",
    "lit-loop": "lit-loop fix the typo in README.md",
    "litwork": "litwork fix the typo in README.md",
    "short-film": "lit make a short film about the ocean",
}
LITWORK_BUDGET = 4000
LIT_PLAN_BUDGET = 3600
LITRESEARCH_BUDGET = 4000

_SKILL_VIEW = re.compile(r'skill_view\("lithermes:([a-z0-9-]+)"\)')
_SKILL_FILE = re.compile(r"\bskills/[a-z0-9-]+/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.md\b")


def _size(text: str) -> int:
    return len(text.encode("utf-8"))


class RouteContextBudget(NaturalRoutingCase):
    def setUp(self):
        super().setUp()
        # A realistic, long workspace path of WORKSPACE_PATH_CHARS characters,
        # whatever the temp root: the ledger line names it, so a short temp path
        # would understate the route and a long one would make the test flaky.
        root = Path(self.isolated_root.name).resolve()
        filler = WORKSPACE_PATH_CHARS - len(str(root)) - 1
        self.workspace = root / ("project-workspace-" * 10)[: max(filler, 8)]
        self.workspace.mkdir(parents=True)
        (self.workspace / "package.json").write_text("{}", encoding="utf-8")
        self.previous_cwd = os.getcwd()
        os.chdir(self.workspace)
        self.addCleanup(os.chdir, self.previous_cwd)
        self.registered = {name for name, _ in self.pkg.PORTED_SKILLS}

    def _turn(self, message: str, session: str, *, first: bool) -> str:
        history = [] if first else [
            {"role": "user", "content": "earlier"},
            {"role": "assistant", "content": "reply"},
        ]
        out = self.pkg._pre_llm_call(
            user_message=message,
            session_id=session,
            platform="cli",
            workspace=str(self.workspace),
            conversation_history=history,
            is_first_turn=first,
        )
        if out is None:
            return ""
        self.assertIsInstance(out, dict)
        return str(out["context"])

    def _assert_pointers_resolve(self, context: str):
        for name in _SKILL_VIEW.findall(context):
            self.assertIn(name, self.registered, f"skill_view names unregistered lithermes:{name}")
            self.assertTrue((Path(_ASSET_DIR) / "skills" / name / "SKILL.md").is_file(), name)
        for relative in _SKILL_FILE.findall(context):
            self.assertTrue((Path(_ASSET_DIR) / relative).is_file(), f"pointer names a missing file: {relative}")

    def _assert_visible_route(self, context: str, budget: int):
        self.assertLessEqual(_size(context), budget)
        self.assertLess(len(context), HOST_SPILL_CHARS)
        self.assertNotIn("<lithermes-skill-body", context)
        self.assertLessEqual(context.count("<lithermes-llm-contract>"), 1)
        self.assertNotIn("<lithermes-bounded-composition", context)
        self._assert_pointers_resolve(context)

    def test_litwork_routes_fit_the_budget_on_the_first_and_later_turns(self):
        for label, message in LITWORK_ROUTES.items():
            for first in (True, False):
                with self.subTest(route=label, first_turn=first):
                    context = self._turn(message, f"budget-{label}-{first}", first=first)
                    self._assert_visible_route(context, LITWORK_BUDGET)
                    probe = context.encode("utf-8").find("🔥 **LIT IGNITED · litwork** 🔥".encode("utf-8"))
                    self.assertGreaterEqual(probe, 0)
                    self.assertLess(probe, PROBE_WINDOW_BYTES)
                    if first:
                        self.assertIn('<lithermes-rules deferred="budget">', context)

    def test_litwork_route_carries_its_run_binding_and_directive(self):
        context = self._turn(LITWORK_ROUTES["lit-ko"], "budget-binding", first=True)
        runs = list((self.workspace / ".hermes" / "lithermes" / "runs").iterdir())
        self.assertEqual(len(runs), 1)
        self.assertIn(f"ledger: {runs[0] / 'ledger.jsonl'}", context)
        self.assertTrue((runs[0] / "evidence").is_dir())
        self.assertIn("evidence/ beside the ledger", context)
        self.assertIn("task: README.md 오타를 고쳐줘", context)
        self.assertIn("progress appended", context)
        for required in (
            "Current Hermes working directory is the default output root",
            "Do not copy or install into the account home",
            "Use the request language for user-facing artifact text",
            "goal_set",
            "goal_complete is REFUSED",
            "get_goal",
            "PIN -> RED -> GREEN",
            "Reviewer gate",
            "2 identical failures: ask the user",
            "2 empty exploration waves: act",
            'skill_view("lithermes:litwork")',
            'skill_view("lithermes:lit-code")',
            ".py",
            ".go",
            "lithermes:frontend-ui-ux",
            "original user task",
            "<lithermes-reader-facing-communication>",
        ):
            self.assertIn(required, context)

    def test_second_lit_prompt_in_one_session_stays_whole(self):
        self._turn(LITWORK_ROUTES["lit-en"], "budget-seq", first=True)
        second = self._turn("lit now fix the typo in CHANGELOG.md", "budget-seq", first=False)
        self._assert_visible_route(second, LITWORK_BUDGET)
        self.assertIn("already active", second)
        self.assertLessEqual(len(second.encode("utf-8")), 600)

    def test_lit_plan_keeps_its_guard_and_plan_path_in_view(self):
        for first in (True, False):
            with self.subTest(first_turn=first):
                context = self._turn("lit-plan fix the typo in README.md", f"budget-plan-{first}", first=first)
                self._assert_visible_route(context, LIT_PLAN_BUDGET)
                head = context.encode("utf-8")[:2500].decode("utf-8", "ignore")
                self.assertIn("planning-only", head)
                self.assertIn("Do not implement", head)
                self.assertIn("Durable plan:", head)
                self.assertIn('skill_view("lithermes:lit-plan")', context)

    def test_litresearch_keeps_its_boundary_in_view(self):
        for first in (True, False):
            with self.subTest(first_turn=first):
                context = self._turn("litresearch heat pumps", f"budget-research-{first}", first=first)
                self._assert_visible_route(context, LITRESEARCH_BUDGET)
                for required in ("login, paywall, CAPTCHA", "Attempt/Verdict", ".hermes/lithermes/litresearch/"):
                    self.assertIn(required, context)
                self.assertIn('skill_view("lithermes:litresearch")', context)

    def test_plain_prompt_keeps_the_static_rules_lane_and_nothing_later(self):
        first = self._turn("what is 2+2", "budget-plain", first=True)
        self.assertIn('<lithermes-rules lane="static"', first)
        self.assertLessEqual(_size(first), self.pkg.MAX_HOST_CONTEXT_BYTES)
        self.assertEqual(self._turn("what is 2+2", "budget-plain-later", first=False), "")

    def test_lazy_references_name_files_that_ship(self):
        # The turn-1 composition replaces any oversized skill body with a pointer.
        # Every pointer must name a registered skill or a file in the payload.
        for message in ("review-work check this diff", "litgoal bind release", "lit-init --max-depth=2"):
            with self.subTest(message=message):
                context = self._turn(message, f"budget-lazy-{abs(hash(message))}", first=True)
                self.assertIn("<lithermes-skill-reference", context)
                self._assert_pointers_resolve(context)


if __name__ == "__main__":
    import unittest

    unittest.main()
