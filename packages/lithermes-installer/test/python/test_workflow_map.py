"""The plain-text workflow map row drawn under LIT replies from durable state."""
from __future__ import annotations

import importlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

try:
    from .plugin_register_test_support import _load_plugin_package
except ImportError:
    from plugin_register_test_support import _load_plugin_package


def _plan(done: int, total: int, final_done: int = 0, final_total: int = 4) -> str:
    rows = [f"- [{'x' if i < done else ' '}] {i + 1}. task {i + 1}" for i in range(total)]
    finals = [f"- [{'x' if i < final_done else ' '}] F{i + 1}. check {i + 1}" for i in range(final_total)]
    fenced = "```\n- [ ] 99. a fenced example row that must not count\n```"
    return "\n".join(["# Plan", "", "## Todos", *rows, fenced, "", "## Final verification wave", *finals, ""])


class WorkflowMap(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.wm = importlib.import_module(f"{cls.pkg.__name__}.workflow_map")
        cls.mark = importlib.import_module(f"{cls.pkg.__name__}.lit_mark")
        cls.goal_model = importlib.import_module(f"{cls.pkg.__name__}.litgoal.model")
        cls.goal_store = importlib.import_module(f"{cls.pkg.__name__}.litgoal.store")

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.ws = Path(self._tmp.name).resolve()
        self.clock = 1_700_000_000

    def tearDown(self):
        self._tmp.cleanup()

    def _touch(self, path: Path) -> None:
        # Each write is strictly newer than the previous one, so the anchor
        # choice never depends on filesystem timestamp resolution.
        self.clock += 10
        os.utime(path, (self.clock, self.clock))

    def write_plan(self, name: str, text: str) -> Path:
        path = self.ws / "plans" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        self._touch(path)
        return path

    def write_run(self, plan: Path | None, command: str = "start-work", rid: str = "r1") -> Path:
        path = self.ws / ".hermes" / "lithermes" / "runs" / rid / "state.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"run_id": rid, "command": command, "plan": str(plan or ""), "task": "t"}), encoding="utf-8")
        self._touch(path)
        return path

    def write_goal(self, statuses: list[str], *, status: str = "active", blockers: int = 0, session: str = "") -> Path:
        model, store = self.goal_model, self.goal_store
        goal = model.Goal(
            id="g1", objective="o", status=status,
            criteria=[model.Criterion(id=f"C{i}", scenario="s", status=s) for i, s in enumerate(statuses)],
            review_blockers=[model.ReviewBlocker(id=f"B{i}", detail="d") for i in range(blockers)],
        )
        store.save(self.ws, model.LitgoalState(active_goal_id="g1", goals=[goal]), session)
        path = store.goals_path(self.ws, session)
        self._touch(path)
        return path

    def write_work(self, plan: Path, progress: list[str], status: str = "active") -> Path:
        path = self.ws / ".hermes" / "lithermes" / "work" / "work-1" / "state.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        items = [{"id": f"i{i}", "status": s} for i, s in enumerate(progress)]
        path.write_text(json.dumps({"status": status, "plan": str(plan), "progress": items}), encoding="utf-8")
        self._touch(path)
        return path

    def row(self, route: str = "lit-loop", session: str = "") -> str | None:
        return self.wm.workflow_row(route, self.ws, session)

    def test_no_durable_state_draws_no_row(self):
        self.assertIsNone(self.row())
        self.write_run(None, command="lit")
        self.assertIsNone(self.row(), "a plain lit run has no stage signal")

    def test_start_work_run_draws_the_approved_map(self):
        self.write_run(self.write_plan("p.md", _plan(3, 7)))
        self.assertEqual(self.row(), "🔥 LIT · lit-loop — 📝 plan ✓ › 🔨 WORK ▰▰▰▱▱▱▱ 3/7 › 🔍 · › 🏁 ·")

    def test_review_then_done_follow_the_final_verification_rows(self):
        plan = self.write_plan("p.md", _plan(7, 7, final_done=1))
        self.write_run(plan)
        self.assertEqual(self.row("litwork"), "🔥 LIT · litwork — 📝 plan ✓ › 🔨 work ✓ › 🔍 REVIEW ▰▱▱▱▱▱▱ 1/4 › 🏁 ·")
        plan.write_text(_plan(7, 7, final_done=4), encoding="utf-8")
        self._touch(plan)
        self.assertEqual(self.row("litwork"), "🔥 LIT · litwork — 📝 plan ✓ › 🔨 work ✓ › 🔍 review ✓ › 🏁 done ✓")

    def test_only_workflow_routes_draw_the_map(self):
        self.write_run(self.write_plan("p.md", _plan(3, 7)))
        for route in ("lit-humanizer", "lit-docx", "litresearch", "lit-typographic-motion"):
            self.assertIsNone(self.row(route), route)
        for route in ("litwork", "lit-plan", "start-work", "lit-recap"):
            self.assertIsNotNone(self.row(route), route)

    def test_stage_without_a_durable_signal_is_omitted(self):
        self.write_run(self.write_plan("p.md", _plan(2, 5, final_total=0)))
        self.assertEqual(self.row(), "🔥 LIT · lit-loop — 📝 plan ✓ › 🔨 WORK ▰▰▱▱▱▱▱ 2/5 › 🏁 ·")

    def test_newest_plan_alone_is_the_planning_stage(self):
        self.write_run(self.write_plan("old.md", _plan(7, 7, final_done=4)))
        self.write_plan("new.md", _plan(0, 6))
        self.assertEqual(self.row("lit-plan"), "🔥 LIT · lit-plan — 📝 PLAN › 🔨 · › 🔍 · › 🏁 ·")

    def test_litgoal_criteria_drive_work_review_and_done(self):
        self.write_run(self.write_plan("p.md", _plan(0, 3)))
        self.write_goal(["pass", "pass", "in_progress", "pending", "pending"])
        self.assertEqual(self.row(), "🔥 LIT · lit-loop — 📝 plan ✓ › 🔨 WORK ▰▰▱▱▱▱▱ 2/5 › 🔍 · › 🏁 ·")
        self.write_goal(["pass", "in_progress"], status="review_blocked", blockers=2)
        self.assertEqual(self.row(), "🔥 LIT · lit-loop — 📝 plan ✓ › 🔨 WORK ▰▰▰▱▱▱▱ 1/2 › 🔍 REVIEW › 🏁 ·")
        self.write_goal(["pass", "pass"])
        self.assertEqual(self.row(), "🔥 LIT · lit-loop — 📝 plan ✓ › 🔨 work ✓ › 🔍 REVIEW › 🏁 ·")
        self.write_goal(["pass", "pass"], status="complete")
        self.assertEqual(self.row(), "🔥 LIT · lit-loop — 📝 plan ✓ › 🔨 work ✓ › 🔍 review ✓ › 🏁 done ✓")

    def test_session_goal_wins_over_the_legacy_goal(self):
        self.write_goal(["pass", "pass", "pass"], status="complete", session="s-1")
        self.write_goal(["pending"])
        self.assertEqual(self.row(session="s-1"), "🔥 LIT · lit-loop — 🔨 work ✓ › 🔍 review ✓ › 🏁 done ✓")
        self.assertEqual(self.row(session="../escape"), "🔥 LIT · lit-loop — 🔨 WORK ▱▱▱▱▱▱▱ 0/1 › 🔍 · › 🏁 ·")

    def test_bounded_work_progress_counts_its_own_items(self):
        plan = self.write_plan("p.md", _plan(0, 7))
        self.write_work(plan, ["pass", "pass", "in_progress", "pending"])
        self.assertEqual(self.row(), "🔥 LIT · lit-loop — 📝 plan ✓ › 🔨 WORK ▰▰▰▱▱▱▱ 2/4 › 🏁 ·")
        self.write_work(plan, ["pass"] * 4, status="completed")
        self.assertEqual(self.row(), "🔥 LIT · lit-loop — 📝 plan ✓ › 🔨 work ✓ › 🏁 done ✓")
        self.write_work(plan, ["pass"], status="cancelled")
        self.assertIsNone(self.row())

    def test_row_never_carries_paths_commands_or_escape_codes(self):
        plan = self.write_plan("secret-name.md", _plan(1, 2))
        self.write_run(plan, command="start-work --worktree /tmp/x")
        rendered = self.row()
        self.assertIsNotNone(rendered)
        for leak in ("secret", ".md", "start-work", "worktree", "tmp", str(self.ws), "\x1b"):
            self.assertNotIn(leak, rendered)

    def test_malformed_or_oversized_state_is_inert(self):
        bad = self.ws / ".hermes" / "lithermes" / "runs" / "r1" / "state.json"
        bad.parent.mkdir(parents=True)
        bad.write_text("{not json", encoding="utf-8")
        self.assertIsNone(self.row())
        self.write_goal([])
        (self.ws / ".hermes" / "lithermes" / "litgoal" / "goals.json").write_text("[]", encoding="utf-8")
        self.assertIsNone(self.row())
        big = self.write_plan("big.md", _plan(1, 2) + "x" * (self.wm.MAX_PLAN_BYTES + 1))
        self.write_run(big, rid="r2")
        self.assertIsNone(self.row())

    def test_reply_carries_the_row_as_the_last_indented_line(self):
        self.write_run(self.write_plan("p.md", _plan(3, 7)))
        session = "map-session"
        core = self.pkg.core
        core._PENDING_IGNITE.add(session)
        core._PENDING_DISCIPLINE[session] = "lit-loop"
        previous = os.getcwd()
        os.chdir(self.ws)
        try:
            with patch.dict("os.environ", {"TERM": "xterm-256color", "LC_ALL": "en_US.UTF-8"}):
                rendered = core.transform_llm_output(response_text="Done.", session_id=session)
        finally:
            os.chdir(previous)
        mark = "\n".join(f"    {row}" for row in self.mark.acknowledgement("lit-loop").splitlines())
        self.assertTrue(rendered.startswith("Done.\n\n" + mark))
        self.assertTrue(rendered.endswith("\n    🔥 LIT · lit-loop — 📝 plan ✓ › 🔨 WORK ▰▰▰▱▱▱▱ 3/7 › 🔍 · › 🏁 ·"))
        self.assertNotIn("\x1b", rendered)

    def test_dumb_terminal_reply_has_no_emoji_row(self):
        self.write_run(self.write_plan("p.md", _plan(3, 7)))
        row = self.row()
        with patch.dict("os.environ", {"TERM": "dumb"}):
            self.assertEqual(self.mark.acknowledge_reply("lit-loop", "ok", workflow=row),
                             self.mark.acknowledge_reply("lit-loop", "ok"))


if __name__ == "__main__":
    unittest.main()
