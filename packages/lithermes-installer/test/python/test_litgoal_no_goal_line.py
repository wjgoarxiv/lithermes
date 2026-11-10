"""The visible line for a lit session that claims completion with no goal ever opened.

A pressure nudge ("hurry, I only need CI green") made the model skip goal_set. The
banner still said LIT IGNITED, but no criterion, no gate and no handoff card existed,
so nothing could refuse the false "done". This line closes that gap: only inside a
session where a work route is active, only when the reply claims completion, and only
while the session holds no litgoal goal at all.
"""

from __future__ import annotations

import json
import unittest

try:
    from .test_litgoal_stale_and_testguard import SESSION, Base
except ImportError:
    from test_litgoal_stale_and_testguard import SESSION, Base

NO_GOAL = "⛔ LIT: not done — no goal was opened, so nothing was verified (type lit to start one)"
GATE_MARK = "⛔ LIT: not done — "


class NoGoalBase(Base):
    def reply(self, text, session_id=SESSION, **extra):
        return self.pkg._transform_llm_output(response_text=text, session_id=session_id, **extra)

    def activate(self, discipline="litwork", session_id=SESSION):
        self.pkg.core._lit_reentry.remember(session_id, discipline)
        self.addCleanup(self.pkg.core._lit_reentry.forget, session_id)


class NoGoalLine(NoGoalBase):
    def test_a_lit_session_claiming_done_with_no_goal_gets_the_line(self):
        self.activate()
        out = self.reply("Fixed both bugs. All done.")
        self.assertIsNotNone(out)
        self.assertTrue(out.startswith("Fixed both bugs. All done."), "the reply is never rewritten")
        self.assertEqual(out.rstrip().splitlines()[-1], NO_GOAL)

    def test_the_real_lit_route_arms_the_line(self):
        self.pkg._pre_llm_call(user_message="lit fix the export bug", session_id=SESSION, platform="cli")
        self.addCleanup(self.pkg.core._lit_reentry.forget, SESSION)
        out = self.reply("Done, the bug is fixed.")
        self.assertEqual(out.rstrip().splitlines()[-1], NO_GOAL)

    def test_the_line_survives_a_later_turn_without_the_word_lit(self):
        self.pkg._pre_llm_call(user_message="lit fix the export bug", session_id=SESSION, platform="cli")
        self.addCleanup(self.pkg.core._lit_reentry.forget, SESSION)
        self.pkg._pre_llm_call(user_message="5 minutes left, hurry. I only need CI green", session_id=SESSION, platform="cli")
        self.assertEqual(self.reply("CI is green, done.").rstrip().splitlines()[-1], NO_GOAL)

    def test_ordinary_chat_without_lit_stays_quiet(self):
        self.assertIsNone(self.reply("Fixed both bugs. All done."))

    def test_another_session_s_lit_does_not_arm_this_one(self):
        self.activate(session_id="other")
        self.assertIsNone(self.reply("All done."))

    def test_a_lit_session_without_a_completion_claim_stays_quiet(self):
        self.activate()
        for text in ("I will look into it.", "This is not fixed yet.", "고쳐 볼게요."):
            with self.subTest(text=text):
                self.assertIsNone(self.reply(text))

    def test_korean_completion_claims_are_recognised(self):
        self.activate()
        for text in ("이제 끝냈어요.", "고쳤습니다."):
            with self.subTest(text=text):
                self.assertEqual(self.reply(text).rstrip().splitlines()[-1], NO_GOAL)

    def test_planning_and_review_routes_never_get_the_line(self):
        for discipline in ("lit-plan", "review-work", "lit-brainstorm", "litresearch"):
            with self.subTest(discipline=discipline):
                self.activate(discipline)
                self.assertIsNone(self.reply("The plan is done."))

    def test_work_routes_get_the_line(self):
        for discipline in ("litwork", "lit-loop", "start-work"):
            with self.subTest(discipline=discipline):
                self.activate(discipline)
                self.assertIsNotNone(self.reply("All done."))

    def test_a_delegate_child_never_gets_the_line(self):
        self.activate()
        self.assertIsNone(self.reply("All done.", platform="subagent"))

    def test_the_exact_standalone_line_is_idempotent(self):
        self.activate()
        first = self.reply("Done.")
        self.assertIsNone(self.reply(first))
        self.assertIsNone(self.reply(f"Done.\n\n{NO_GOAL}\n\nthanks"))

    def test_the_line_hidden_in_a_fence_or_comment_does_not_suppress_it(self):
        self.activate()
        for text in (f"Done.\n```\n{NO_GOAL}\n```", f"Done. <!-- {NO_GOAL} -->", f"Done. `{NO_GOAL}`"):
            with self.subTest(text=text):
                self.assertEqual(self.reply(text).rstrip().splitlines()[-1], NO_GOAL)

    def test_a_workspace_with_a_garbled_goal_file_stays_quiet(self):
        self.activate()
        path = self.store.goals_path(self.ws, SESSION)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{not json", encoding="utf-8")
        self.assertIsNone(self.reply("All done."))


class NoGoalLineYieldsToTheGoalGate(NoGoalBase):
    def test_an_open_goal_gets_the_gate_line_not_the_no_goal_line(self):
        self.write("export.py", "rows = ['a']\n")
        self.goal()
        self.activate()
        out = self.reply("All done.")
        last = out.rstrip().splitlines()[-1]
        self.assertTrue(last.startswith(GATE_MARK), out)
        self.assertNotIn(NO_GOAL, out)

    def test_a_goal_this_install_completed_leaves_the_session_quiet(self):
        self.write("export.py", "rows = ['a']\n")
        self.goal()
        self.green(self.terminal("true"))
        self.finish_criterion()
        self.assertTrue(self.runtime.complete_goal(self.ws, session_id=SESSION)["completed"])
        self.activate()
        self.assertIsNone(self.reply("All done."))

    def test_a_goal_opened_after_the_nudge_ends_the_no_goal_line(self):
        self.activate()
        self.assertIn(NO_GOAL, self.reply("All done.") or "")
        self.goal()
        out = self.reply("All done.")
        self.assertNotIn(NO_GOAL, out or "")
        self.assertEqual(json.loads(self.state_file("goals.json").read_text())["goals"][0]["id"], "G001")


if __name__ == "__main__":
    unittest.main()
