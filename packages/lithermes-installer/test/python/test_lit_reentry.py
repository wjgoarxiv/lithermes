"""A repeat `lit` continues the active mode instead of restarting it.

Every case drives the registered ``pre_llm_call`` hook with a real session id
and a real project directory, the way Hermes does, and reads the durable state
the route leaves behind (run directories and plan files).
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

try:
    from .natural_routing_test_support import NaturalRoutingCase
except ImportError:
    from natural_routing_test_support import NaturalRoutingCase

CONTINUE_BUDGET = 600
APPROVED_PLAN = (
    "# Approved widget plan\n\n## Todos\n- [ ] 1. Build the widget.\n- [ ] 2. Test the widget.\n\n"
    "## Final verification\n- [ ] F1. Verify the widget plan.\n"
)


def _size(out) -> int:
    return len(out["context"].encode("utf-8"))


class LitReentry(NaturalRoutingCase):
    def setUp(self):
        super().setUp()
        self.project = tempfile.TemporaryDirectory(prefix="lithermes-reentry-project-")
        self.addCleanup(self.project.cleanup)
        self.root = Path(self.project.name)
        previous = os.getcwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)

    def lit(self, message: str, session: str = "reentry"):
        out = self._hook(message, session=session, isolated=False)
        self.assertIsInstance(out, dict, message)
        return out

    def runs(self) -> list[Path]:
        return sorted((self.root / ".hermes" / "lithermes" / "runs").glob("*/state.json"))

    def plans(self) -> list[Path]:
        return sorted((self.root / "plans").glob("*.md"))

    def write_plan(self, name: str = "widget") -> Path:
        path = self.root / "plans" / f"{name}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(APPROVED_PLAN, encoding="utf-8")
        return path

    def test_five_repeat_lit_prompts_send_one_activation_and_four_short_notes(self):
        sizes = []
        for message in (
            "lit fix the bug",
            "lit add a test",
            "lit also cover the edge case",
            "lit keep going on the parser",
            "lit and update the docs",
        ):
            out = self.lit(message)
            sizes.append(_size(out))
            if len(sizes) > 1:
                context = out["context"]
                self.assertNotIn("skill_view", context)
                self.assertNotIn("SKILL.md", context)
                self.assertNotIn("<lithermes-skill", context)
                self.assertIn("already active", context)
        self.assertGreater(sizes[0], 1500)
        for size in sizes[1:]:
            self.assertLessEqual(size, CONTINUE_BUDGET)
        self.assertEqual(len(self.runs()), 1, "a repeat lit must not open another run directory")

    def test_continue_names_the_run_ledger_it_keeps_appending_to(self):
        self.lit("lit fix the bug")
        run_id = self.runs()[0].parent.name
        self.assertIn(f".hermes/lithermes/runs/{run_id}/ledger.jsonl", self.lit("lit add a test")["context"])

    def test_lit_plan_after_lit_loop_switches_to_the_full_plan_activation_once(self):
        self.lit("lit fix the bug")
        switched = self.lit("lit plan the release")
        self.assertIn('<lithermes-natural-route mode="lit-plan">', switched["context"])
        self.assertGreater(_size(switched), 1000)
        self.assertEqual(len(self.plans()), 1)

    def test_repeat_lit_plan_continues_without_a_second_plan_file(self):
        first = self.lit("lit plan the release")
        self.assertIn("Durable plan:", first["context"])
        for message in ("lit plan also cover rollback", "lit plan one more thing"):
            out = self.lit(message)
            self.assertLessEqual(_size(out), CONTINUE_BUDGET)
            self.assertIn("planning-only", out["context"].lower())
            self.assertNotIn("Durable plan:", out["context"])
        self.assertEqual(len(self.plans()), 1, "a repeat lit plan must not write another plan file")

    def test_switching_back_to_lit_loop_is_a_fresh_full_activation(self):
        self.lit("lit fix the bug")
        self.lit("lit plan the release")
        back = self.lit("lit fix the next bug")
        self.assertGreater(_size(back), 1500)
        self.assertEqual(len(self.runs()), 2)

    def test_bare_lit_resumes_a_started_plan_without_creating_anything(self):
        plan = self.write_plan()
        self.pkg.core.command_start_work(f"--worktree {self.root} {plan.stem}")
        before = (len(self.runs()), len(self.plans()))
        for message in ("lit", "lit continue with the next step"):
            out = self.lit(message, session=f"resume-{len(message)}")
            self.assertLessEqual(_size(out), CONTINUE_BUDGET)
            self.assertIn("resuming", out["context"].lower())
            self.assertIn(plan.name, out["context"])
            self.assertNotIn("skill_view", out["context"])
        self.assertEqual((len(self.runs()), len(self.plans())), before)

    def test_resume_then_a_task_prompt_keeps_continuing_that_run(self):
        plan = self.write_plan()
        self.pkg.core.command_start_work(f"--worktree {self.root} {plan.stem}")
        self.lit("lit")
        out = self.lit("lit now finish item 2")
        self.assertLessEqual(_size(out), CONTINUE_BUDGET)
        self.assertEqual(len(self.runs()), 1)

    def test_a_finished_plan_is_not_resumable(self):
        plan = self.write_plan()
        self.pkg.core.command_start_work(f"--worktree {self.root} {plan.stem}")
        plan.write_text(APPROVED_PLAN.replace("- [ ]", "- [x]"), encoding="utf-8")
        out = self.lit("lit")
        self.assertGreater(_size(out), 1500)

    def test_lit_new_and_lit_restart_start_over_with_the_full_activation(self):
        self.lit("lit fix the bug")
        self.assertLessEqual(_size(self.lit("lit add a test")), CONTINUE_BUDGET)
        for word in ("new", "restart"):
            out = self.lit(f"lit {word} rebuild the parser")
            self.assertGreater(_size(out), 1500)
            self.assertIn("rebuild the parser", out["context"])
            self.assertNotIn(f"task: {word} rebuild", out["context"])
        self.assertEqual(len(self.runs()), 3)

    def test_lit_new_plan_restarts_into_the_full_plan_activation(self):
        self.lit("lit plan the release")
        out = self.lit("lit new plan the rollback")
        self.assertIn('<lithermes-natural-route mode="lit-plan">', out["context"])
        self.assertEqual(len(self.plans()), 2)

    def test_only_a_bare_idle_lit_asks_what_to_start(self):
        bare = self.lit("lit", session="idle")
        self.assertIn("no task", bare["context"].lower())
        task = self.lit("lit fix X", session="busy")
        self.assertNotIn("no task", task["context"].lower())
        again = self.lit("lit", session="busy")
        self.assertNotIn("no task", again["context"].lower())
        self.assertLessEqual(_size(again), CONTINUE_BUDGET)

    def test_bare_lit_continues_whatever_discipline_is_active(self):
        self.lit("lit plan the release")
        for message in ("lit", "lit continue with the next step"):
            out = self.lit(message)
            self.assertLessEqual(_size(out), CONTINUE_BUDGET)
            self.assertIn("lit-plan is already active", out["context"])
            self.assertIn("planning-only", out["context"].lower())
            self.assertNotIn("no task", out["context"].lower())
        self.assertEqual(len(self.plans()), 1)
        self.assertEqual(len(self.runs()), 0)

    def test_bare_lit_continues_an_active_lit_loop_without_a_new_run(self):
        self.lit("lit fix the bug")
        out = self.lit("lit")
        self.assertLessEqual(_size(out), CONTINUE_BUDGET)
        self.assertIn("litwork is already active", out["context"])
        self.assertEqual(len(self.runs()), 1)

    def test_a_different_session_starts_fresh(self):
        self.lit("lit fix the bug", session="one")
        self.assertLessEqual(_size(self.lit("lit add a test", session="one")), CONTINUE_BUDGET)
        other = self.lit("lit add a test", session="two")
        self.assertGreater(_size(other), 1500)
        self.assertEqual(len(self.runs()), 2)

    def test_a_new_host_session_forgets_the_previous_one_with_the_same_id(self):
        self.lit("lit fix the bug")
        self.pkg.core.on_session_start(session_id="reentry", platform="cli")
        self.assertGreater(_size(self.lit("lit add a test")), 1500)

    def test_a_context_compaction_after_activation_sends_the_activation_again(self):
        self.lit("lit fix the bug")
        compacted = [{"role": "user", "content": "summary", "_compressed_summary": True}]
        out = self.pkg._pre_llm_call(
            user_message="lit add a test", session_id="reentry", platform="cli",
            conversation_history=compacted,
        )
        self.assertGreater(_size(out), 1500)
        again = self.pkg._pre_llm_call(
            user_message="lit and another", session_id="reentry", platform="cli",
            conversation_history=compacted,
        )
        self.assertLessEqual(_size(again), CONTINUE_BUDGET)

    def test_a_second_context_compaction_sends_the_activation_again(self):
        self.lit("lit fix the bug")
        first = [{"role": "user", "content": "summary one", "_compressed_summary": True}]
        second = [{"role": "user", "content": "summary two, folding in one", "_compressed_summary": True}]

        def turn(message, history):
            return self.pkg._pre_llm_call(
                user_message=message, session_id="reentry", platform="cli", conversation_history=history,
            )

        self.assertGreater(_size(turn("lit add a test", first)), 1500)
        self.assertLessEqual(_size(turn("lit and another", first)), CONTINUE_BUDGET)
        self.assertGreater(_size(turn("lit once more", second)), 1500)
        self.assertLessEqual(_size(turn("lit and the docs", second)), CONTINUE_BUDGET)

    def test_a_requested_reader_mode_still_reaches_a_continue_turn(self):
        self.lit("lit fix the bug")
        out = self.lit("lit technical mode: add a test")
        self.assertIn("selected_mode: technical", out["context"])

    def test_corrupt_run_state_falls_back_to_a_full_activation(self):
        self.lit("lit fix the bug")
        self.runs()[0].write_text("{not json", encoding="utf-8")
        out = self.lit("lit add a test")
        self.assertGreater(_size(out), 1500)
        self.assertLessEqual(_size(self.lit("lit and another")), CONTINUE_BUDGET)

    def test_a_deleted_plan_falls_back_to_a_full_plan_activation(self):
        self.lit("lit plan the release")
        self.plans()[0].unlink()
        out = self.lit("lit plan the release again")
        self.assertIn("Durable plan:", out["context"])

    def test_a_malformed_session_record_falls_back_to_a_full_activation(self):
        self.lit("lit fix the bug")
        self.pkg.core._lit_reentry._ACTIVE["reentry"] = 42
        self.assertGreater(_size(self.lit("lit add a test")), 1500)

    def test_corrupt_work_and_run_state_never_block_a_bare_lit(self):
        plan = self.write_plan()
        self.pkg.core.command_start_work(f"--worktree {self.root} {plan.stem}")
        self.runs()[0].write_text("[]", encoding="utf-8")
        work = self.root / ".hermes" / "lithermes" / "work" / "work-bad"
        work.mkdir(parents=True)
        (work / "state.json").write_text("\x00\x01", encoding="utf-8")
        out = self.lit("lit")
        self.assertGreater(_size(out), 1500)

    def test_a_long_plan_name_never_pushes_a_continue_note_past_the_budget(self):
        long_name = "the-release-" + "rollback-and-recovery-" * 12
        self.lit(f"lit plan {long_name}")
        out = self.lit("lit plan more", session="reentry")
        self.assertLessEqual(_size(out), CONTINUE_BUDGET)
        self.assertIn("planning-only", out["context"].lower())

    def test_a_recorded_lit_run_is_never_written_from_a_continue_turn(self):
        self.lit("lit fix the bug")
        ledger = self.runs()[0].parent / "ledger.jsonl"
        lines = ledger.read_text(encoding="utf-8").splitlines()
        for message in ("lit add a test", "lit and more"):
            self.lit(message)
        self.assertEqual(ledger.read_text(encoding="utf-8").splitlines(), lines)
        self.assertEqual(json.loads(lines[0])["event"], "run_started")


if __name__ == "__main__":
    unittest.main()
