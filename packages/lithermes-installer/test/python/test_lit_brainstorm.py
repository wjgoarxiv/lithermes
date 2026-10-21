"""lit-brainstorm route, enrollment, and the clarified litgoal / review-work meanings.

Every routing case drives the registered ``pre_llm_call`` hook with a real session id
and a real project directory, the way Hermes does.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

try:
    from .natural_routing_test_support import NaturalRoutingCase, _skill_body
except ImportError:
    from natural_routing_test_support import NaturalRoutingCase, _skill_body

LITGOAL_MEANING = "litgoal sets and keeps the finish line; lit-loop and start-work run toward it."
BRAINSTORM_ROUTE_WORDS = ("brainstorm", "brainstorming", "ideation", "ideate", "idea", "ideas")


class LitBrainstormRoute(NaturalRoutingCase):
    def setUp(self):
        super().setUp()
        self.project = tempfile.TemporaryDirectory(prefix="lithermes-brainstorm-project-")
        self.addCleanup(self.project.cleanup)
        self.root = Path(self.project.name)
        previous = os.getcwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)

    def lit(self, message: str, session: str = "brainstorm"):
        out = self._hook(message, session=session, isolated=False)
        self.assertIsInstance(out, dict, message)
        return out

    def test_every_route_word_after_lit_reaches_lit_brainstorm(self):
        for word in BRAINSTORM_ROUTE_WORDS:
            with self.subTest(word=word):
                route = self.core.detect_lit_mode(f"lit {word} a name for my app")
                self.assertIsNotNone(route)
                self.assertEqual(route.mode, "lit-brainstorm")
                self.assertEqual(route.objective, "a name for my app")

    def test_the_skill_id_is_a_bare_route_with_and_without_lit(self):
        for message in ("lit-brainstorm a name for my app", "lit lit-brainstorm a name for my app"):
            with self.subTest(message=message):
                route = self.core.detect_lit_mode(message)
                self.assertEqual(route.mode, "lit-brainstorm")
                self.assertEqual(route.objective, "a name for my app")

    def test_neighbouring_routes_keep_their_modes(self):
        expected = {
            "lit plan the release": "lit-plan",
            "lit review this diff": "review-work",
            "lit goal ship the release": "litgoal",
            "lit research async runtimes": "litresearch",
            "lit interview me about the release": "litwork",
        }
        for message, mode in expected.items():
            with self.subTest(message=message):
                self.assertEqual(self.core.detect_lit_mode(message).mode, mode)

    def test_the_route_words_are_not_swallowed_as_ordinary_prose(self):
        for message in (
            "/lit-brainstorm a name",
            "lit-brainstorm-extra geometry",
            "lit ideal state of the cache",
            "lit brainstormer config",
            "lit idea-bank refactor",
            "document `lit brainstorm names` only",
            "brainstorming sessions are tiring",
        ):
            with self.subTest(message=message):
                route = self.core.detect_lit_mode(message)
                self.assertTrue(route is None or route.mode != "lit-brainstorm", message)

    def test_hook_injects_a_brainstorm_only_route_without_run_state(self):
        for message in ("lit brainstorm a name for my app", "lit ideation a name for my app", "lit idea a name for my app"):
            with self.subTest(message=message):
                out = self.lit(message, session=f"bs-{abs(hash(message))}")
                context = out["context"]
                self.assertIn('mode="lit-brainstorm"', context)
                self.assertIn("lithermes:lit-brainstorm", context)
                self.assertIn('skill_view("lithermes:lit-brainstorm")', context)
                self.assertIn("LIT IGNITED · lit-brainstorm", context)
                self.assertIn("Do not implement", context)
                self.assertIn("deep-interview", context)
                self.assertIn("lit-plan", context)
                self.assertLess(len(context), 10_000)
                self.assertFalse((self.root / ".hermes" / "lithermes" / "runs").exists())
                self.assertFalse((self.root / "plans").exists())

    def test_a_repeat_brainstorm_turn_continues_with_a_short_guard(self):
        first = self.lit("lit brainstorm a name for my app", session="bs-repeat")
        second = self.lit("lit brainstorm more, but playful ones", session="bs-repeat")
        self.assertNotIn("<lithermes-skill", second["context"])
        self.assertLessEqual(len(second["context"].encode("utf-8")), 600)
        self.assertIn("Brainstorm-only", second["context"])
        self.assertGreater(len(first["context"].encode("utf-8")), len(second["context"].encode("utf-8")))

    def test_plugin_registers_and_indexes_the_skill_inside_the_host_budget(self):
        registered = dict(self.pkg.PORTED_SKILLS)
        self.assertIn("lit-brainstorm", registered)
        self.assertTrue((Path(self.pkg.__file__).parent / "skills" / "lit-brainstorm" / "SKILL.md").is_file())
        section = self.pkg.skill_index_section()
        self.assertIn("- lit-brainstorm: ", section)
        self.assertLessEqual(len(section), self.pkg.SKILL_INDEX_MAX_CHARS)

    def test_deep_interview_sends_open_brainstorming_to_lit_brainstorm(self):
        body = _skill_body("deep-interview")
        self.assertRegex(body, r"open-ended brainstorming.{0,60}lit-brainstorm")


class LitgoalAndReviewWorkMeanings(NaturalRoutingCase):
    def setUp(self):
        super().setUp()
        self.project = tempfile.TemporaryDirectory(prefix="lithermes-meanings-project-")
        self.addCleanup(self.project.cleanup)
        self.root = Path(self.project.name)
        previous = os.getcwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)

    def lit(self, message: str, session: str):
        out = self._hook(message, session=session, isolated=False)
        self.assertIsInstance(out, dict, message)
        return out["context"]

    def test_litgoal_route_name_equals_skill_name(self):
        for message in ("litgoal bind release readiness", "lit goal bind release readiness"):
            with self.subTest(message=message):
                route = self.core.detect_lit_mode(message)
                self.assertEqual(route.mode, "litgoal")
                self.assertTrue((Path(self.pkg.__file__).parent / "skills" / route.mode / "SKILL.md").is_file())

    def test_litgoal_says_what_it_is_everywhere_it_is_described(self):
        self.assertIn(LITGOAL_MEANING, _skill_body("litgoal"))
        self.assertIn(LITGOAL_MEANING, self.lit("litgoal bind release readiness", "meaning-route"))
        self.assertIn("finish line", dict(self.pkg.PORTED_SKILLS)["litgoal"])
        message = self.core.command_litgoal("ship the release")["agent_message"]
        self.assertIn(LITGOAL_MEANING, message)

    def test_the_meanings_reach_the_model_inside_the_host_spill_limit(self):
        for message, needle in (
            ("lit review plan plans/widget.md", "Review mode: plan (forced by the user)"),
            ("lit review the diff", "Review mode: auto-pick"),
            ("lit goal ship the release", LITGOAL_MEANING),
        ):
            with self.subTest(message=message):
                context = self.lit(message, f"spill-{abs(hash(message))}")
                self.assertLess(len(context), 10_000)
                self.assertIn(needle, context)

    def test_review_work_skill_names_both_modes_and_the_auto_pick_rule(self):
        body = _skill_body("review-work")
        for required in (
            "Plan review",
            "Work review",
            "lit review plan",
            "lit review work",
            "/review-work plan",
            "/review-work work",
            "first line of the report",
            "ticked",
            "ask the user",
        ):
            self.assertIn(required, body)

    def test_forced_lit_review_mode_reaches_the_route(self):
        plan = self.lit("lit review plan plans/widget.md", "review-forced-plan")
        self.assertIn("Review mode: plan (forced by the user)", plan)
        work = self.lit("lit review work the last commit", "review-forced-work")
        self.assertIn("Review mode: work (forced by the user)", work)

    def test_unforced_lit_review_states_the_auto_pick_rule(self):
        context = self.lit("lit review plans and the diff of the parser", "review-auto")
        self.assertIn("Review mode: auto-pick", context)
        self.assertIn("ticked", context)

    def test_review_work_command_forces_plan_mode_without_dispatching_work_lanes(self):
        message = self.core.command_review_work("plan plans/widget.md")["agent_message"]
        self.assertIn("Review mode: plan (forced by the user)", message)
        self.assertNotIn("Dispatch ALL FIVE lanes", message)
        self.assertNotIn("```diff", message)

    def test_review_work_command_picks_work_when_a_diff_exists(self):
        import subprocess

        for args in (["init", "-q"], ["config", "user.email", "t@example.com"], ["config", "user.name", "t"]):
            subprocess.run(["git", *args], cwd=self.root, check=True)
        (self.root / "app.py").write_text("print(1)\n", encoding="utf-8")
        subprocess.run(["git", "add", "-A"], cwd=self.root, check=True)
        subprocess.run(["git", "commit", "-qm", "base"], cwd=self.root, check=True)
        (self.root / "app.py").write_text("print(2)\n", encoding="utf-8")
        message = self.core.command_review_work("--base HEAD")["agent_message"]
        self.assertIn("Review mode: work (auto-picked: changed files outside plans/)", message)
        self.assertIn("Dispatch ALL FIVE lanes", message)

    def test_review_work_command_picks_plan_when_only_older_commits_changed_files(self):
        import subprocess

        for args in (["init", "-q"], ["config", "user.email", "t@example.com"], ["config", "user.name", "t"]):
            subprocess.run(["git", *args], cwd=self.root, check=True)
        plan = self.root / "plans" / "widget.md"
        plan.parent.mkdir()
        plan.write_text("# Widget\n\n## Todos\n- [ ] 1. Build it.\n", encoding="utf-8")
        subprocess.run(["git", "add", "-A"], cwd=self.root, check=True)
        subprocess.run(["git", "commit", "-qm", "plan"], cwd=self.root, check=True)
        (self.root / "README.md").write_text("notes\n", encoding="utf-8")
        subprocess.run(["git", "add", "-A"], cwd=self.root, check=True)
        subprocess.run(["git", "commit", "-qm", "readme"], cwd=self.root, check=True)
        message = self.core.command_review_work("")["agent_message"]
        self.assertIn("Review mode: plan (auto-picked: an unticked plan and no changed files)", message)
        self.assertNotIn("Dispatch ALL FIVE lanes", message)

    def test_review_work_command_picks_work_for_an_explicit_base(self):
        import subprocess

        for args in (["init", "-q"], ["config", "user.email", "t@example.com"], ["config", "user.name", "t"]):
            subprocess.run(["git", *args], cwd=self.root, check=True)
        plan = self.root / "plans" / "widget.md"
        plan.parent.mkdir()
        plan.write_text("# Widget\n\n## Todos\n- [ ] 1. Build it.\n", encoding="utf-8")
        subprocess.run(["git", "add", "-A"], cwd=self.root, check=True)
        subprocess.run(["git", "commit", "-qm", "plan"], cwd=self.root, check=True)
        (self.root / "app.py").write_text("print(1)\n", encoding="utf-8")
        subprocess.run(["git", "add", "-A"], cwd=self.root, check=True)
        subprocess.run(["git", "commit", "-qm", "app"], cwd=self.root, check=True)
        message = self.core.command_review_work("--base HEAD~1")["agent_message"]
        self.assertIn("Review mode: work (auto-picked: changed files outside plans/)", message)

    def test_review_work_command_asks_when_neither_a_plan_nor_a_diff_exists(self):
        import subprocess

        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        message = self.core.command_review_work("--base HEAD")["agent_message"]
        self.assertIn("Review mode: ask", message)
        self.assertNotIn("Dispatch ALL FIVE lanes", message)

    def test_review_work_command_picks_plan_for_an_unticked_plan_and_no_diff(self):
        import subprocess

        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        plan = self.root / "plans" / "widget.md"
        plan.parent.mkdir()
        plan.write_text("# Widget\n\n## Todos\n- [ ] 1. Build it.\n", encoding="utf-8")
        message = self.core.command_review_work("--base HEAD")["agent_message"]
        self.assertIn("Review mode: plan (auto-picked: an unticked plan and no changed files)", message)
