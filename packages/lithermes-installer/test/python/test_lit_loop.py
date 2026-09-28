"""W3/W4: adaptive plan template, durable notepad + criteria run-state,
criterion ledger schema, QA channels, and goal-tool-integrated messages."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

_HERE = os.path.dirname(os.path.abspath(__file__))
_ASSET_DIR = os.path.normpath(os.path.join(_HERE, "..", "..", "assets", "lithermes-plugin"))
if _ASSET_DIR not in sys.path:
    sys.path.insert(0, _ASSET_DIR)

import core  # noqa: E402


class PlanTemplate(unittest.TestCase):
    def test_create_plan_has_reference_grade_sections(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = core.create_plan("build the parity feature", Path(tmp))
            text = path.read_text(encoding="utf-8")
            for marker in [
                "## TL;DR", "## Success Criteria", "C001",
                "## Scope", "Must NOT", "## Verification", "## Execution",
                "Dependency matrix", "F1", "F2", "F3", "F4",
                "## Commit", "Action:", "Output:", "Verification:",
                "QA scenario", "## Final DoneClaim",
            ]:
                self.assertIn(marker, text, f"plan template missing '{marker}'")

    def test_extract_success_criteria_parses_template(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = core.create_plan("demo", Path(tmp))
            crits = core.extract_success_criteria(path.read_text(encoding="utf-8"))
            self.assertEqual(len(crits), 1)
            self.assertEqual(crits[0]["id"], "C001")
            self.assertIn("qa_channel", crits[0])


class RunStateNotepad(unittest.TestCase):
    def test_write_run_state_creates_notepad_and_persists_criteria(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            plan = core.create_plan("demo task", ws)
            run_dir = core.write_run_state(ws, task="demo task", command="lit-loop", plan=plan)
            state = json.loads((run_dir / "state.json").read_text(encoding="utf-8"))
            self.assertIn("notepad_path", state)
            notepad = Path(state["notepad_path"])
            self.assertTrue(notepad.exists())
            note_text = notepad.read_text(encoding="utf-8")
            for section in ["## Plan", "## Success criteria", "## Now", "## Todo", "## Findings", "## Learnings"]:
                self.assertIn(section, note_text)
            self.assertEqual(len(state.get("criteria", [])), 1)

    def test_record_criterion_event_appends_ledger(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            run_dir = core.write_run_state(ws, task="t", command="lit")
            core.record_criterion_event(run_dir, "C001", "test_red_captured", ref="t.py::x", detail="RED")
            core.record_criterion_event(run_dir, "C001", "cleanup_receipt", detail="killed 1; rm -rf /tmp/x")
            ledger = (run_dir / "ledger.jsonl").read_text(encoding="utf-8")
            self.assertIn("test_red_captured", ledger)
            self.assertIn("cleanup_receipt", ledger)


class GoalIntegratedMessages(unittest.TestCase):
    def test_litwork_context_documents_manual_qa_and_cleanup(self):
        ctx = core.LIT_CONTEXT
        for token in ["RED", "GREEN", "tmux", "curl", "cleanup receipt"]:
            self.assertIn(token, ctx, f"LIT_CONTEXT missing '{token}'")

    def test_goal_instruction_references_durable_goal_tools_and_worktree(self):
        msg = core.build_goal_instruction("ship it", workspace=Path("/tmp/ws"))
        self.assertIn("goal_set", msg)
        self.assertIn("goal_complete", msg)

    def test_lit_loop_agent_message_mentions_reviewer_and_worktree(self):
        res = core.command_lit_loop('"do the thing" --completion-promise "done when X"')
        msg = res["agent_message"]
        self.assertIn("worktree", msg.lower())
        self.assertIn("reviewer", msg.lower())

    def test_start_work_returns_dispatch_with_discipline(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            core.create_plan("a demo plan", ws)
            res = core.command_start_work(f"--worktree {ws}")
            self.assertIsInstance(res, dict)
            msg = res["agent_message"]
            self.assertIn("worktree", msg.lower())
            self.assertIn("reviewer", msg.lower())
            self.assertIn("goal_set", msg)


class TriggerTaskClamp(unittest.TestCase):
    def test_clamp_bounds_oversized_task(self):
        huge = "x" * 10000
        clamped = core._clamp_task(huge)
        self.assertLessEqual(len(clamped), core.MAX_TASK_LEN + 8)  # +ellipsis
        self.assertTrue(clamped.endswith("[…]"))

    def test_clamp_leaves_small_task_intact(self):
        self.assertEqual(core._clamp_task("fix the bug"), "fix the bug")

    def test_run_context_extraction_is_clamped(self):
        msg = "<lithermes-run-context>\ntask: " + ("y" * 9000) + "\n</lithermes-run-context>"
        task = core._extract_run_context_task(msg)
        self.assertLessEqual(len(task), core.MAX_TASK_LEN + 8)


class LitTriggerFiring(unittest.TestCase):
    """The bare-`lit` trigger: word-bounded, must NOT fire on substrings."""

    def test_lit_fires_as_trailing_word(self):
        self.assertTrue(core.LIT_PATTERN.search("이거 바로 진행해줘 lit"))

    def test_lit_fires_standalone_and_leading(self):
        self.assertTrue(core.LIT_PATTERN.search("lit"))
        self.assertTrue(core.LIT_PATTERN.search("lit do the repo QA"))
        self.assertTrue(core.LIT_PATTERN.search("litwork please"))

    def test_substrings_never_fire(self):
        for benign in [
            "split this file",        # 'lit' inside 'split'
            "literally amazing",      # 'lit' inside 'literally'
            "the implicit contract",  # 'lit' inside 'implicit'
            "facility audit",         # 'lit' inside 'facility'
            "quality gate",           # no standalone lit
            "flit and slit",          # 'lit' inside other words
        ]:
            self.assertIsNone(core.LIT_PATTERN.search(benign), f"must NOT fire: {benign!r}")

    def test_hyphenated_compounds_never_fire(self):
        # 'lit-review' etc. are NOT the bare trigger (hyphen-adjacent); command
        # routing handles real 'lit-loop'/'lit-plan' commands separately.
        for benign in ["lit-review please", "do a lit-then-do", "x lit-loop y", "lit_loop_var"]:
            self.assertIsNone(core.LIT_PATTERN.search(benign), f"must NOT fire: {benign!r}")

    def test_direct_pattern_binds_leading_task(self):
        m = core.DIRECT_LIT_PATTERN.match("lit run the release plan")
        self.assertIsNotNone(m)
        self.assertEqual(m.group("task"), "run the release plan")
        self.assertIsNone(core.DIRECT_LIT_PATTERN.match("split the file"))


if __name__ == "__main__":
    unittest.main()
