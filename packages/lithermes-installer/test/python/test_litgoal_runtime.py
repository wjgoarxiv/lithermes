"""W1-T2: litgoal lifecycle, evidence, checkpoint, steering, quality gate, blockers."""

import os
import sys
import tempfile
import unittest
from pathlib import Path

_HERE = os.path.dirname(os.path.abspath(__file__))
_ASSET_DIR = os.path.normpath(os.path.join(_HERE, "..", "..", "assets", "lithermes-plugin"))
if _ASSET_DIR not in sys.path:
    sys.path.insert(0, _ASSET_DIR)

from litgoal import runtime, store  # noqa: E402


class Lifecycle(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.ws = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_create_goal_sets_active_and_logs(self):
        goal = runtime.create_goal(self.ws, "ship parity", title="parity")
        self.assertEqual(goal.status, "active")
        active = runtime.get_active(self.ws)
        self.assertIsNotNone(active)
        self.assertEqual(active.objective, "ship parity")
        ledger = store.ledger_path(self.ws).read_text(encoding="utf-8")
        self.assertIn("goal_created", ledger)

    def test_add_criterion_and_evidence(self):
        runtime.create_goal(self.ws, "obj")
        crit = runtime.add_criterion(self.ws, "happy path", qa_channel="tmux", test_ref="t.py::x")
        self.assertTrue(crit.id.startswith("C"))
        runtime.add_evidence(self.ws, crit.id, "green", "t.py::x", "passing output")
        active = runtime.get_active(self.ws)
        self.assertEqual(len(active.criteria[0].evidence), 1)
        self.assertEqual(active.criteria[0].evidence[0].kind, "green")

    def test_quality_gate_blocks_until_criteria_proven(self):
        runtime.create_goal(self.ws, "obj")
        crit = runtime.add_criterion(self.ws, "happy", qa_channel="tmux", test_ref="t.py::x")
        gate = runtime.quality_gate(self.ws)
        self.assertFalse(gate["passed"])
        self.assertTrue(gate["reasons"], "should list why the gate is closed")

        # complete must be refused while the gate is closed
        result = runtime.complete_goal(self.ws)
        self.assertFalse(result["completed"])

        # satisfy: pass status + green + scenario evidence
        runtime.add_evidence(self.ws, crit.id, "green", "t.py::x", "GREEN")
        runtime.add_evidence(self.ws, crit.id, "scenario", "evidence/qa.txt", "tmux artifact")
        runtime.set_criterion_status(self.ws, crit.id, "pass")
        gate2 = runtime.quality_gate(self.ws)
        self.assertTrue(gate2["passed"], gate2["reasons"])

        done = runtime.complete_goal(self.ws)
        self.assertTrue(done["completed"])
        self.assertEqual(runtime.get_active(self.ws).status, "complete")
        self.assertIn("goal_completed", store.ledger_path(self.ws).read_text(encoding="utf-8"))

    def test_add_evidence_rejects_invalid_kind(self):
        runtime.create_goal(self.ws, "obj")
        crit = runtime.add_criterion(self.ws, "happy", qa_channel="cli", test_ref="t")
        with self.assertRaises(ValueError):
            runtime.add_evidence(self.ws, crit.id, "red_test", "ref")

    def test_review_blocker_blocks_completion(self):
        runtime.create_goal(self.ws, "obj")
        crit = runtime.add_criterion(self.ws, "happy", qa_channel="cli", test_ref="t")
        runtime.add_evidence(self.ws, crit.id, "green", "t", "g")
        runtime.add_evidence(self.ws, crit.id, "scenario", "a", "s")
        runtime.set_criterion_status(self.ws, crit.id, "pass")
        blocker = runtime.add_review_blocker(self.ws, "reviewer wants more evidence")
        self.assertFalse(runtime.quality_gate(self.ws)["passed"])
        refused = runtime.complete_goal(self.ws)
        self.assertFalse(refused["completed"])
        self.assertTrue(any("unresolved review blocker" in reason for reason in refused["reasons"]))
        runtime.resolve_review_blocker(self.ws, blocker.id)
        self.assertTrue(runtime.quality_gate(self.ws)["passed"])

    def test_blocked_criterion_cannot_complete_even_with_required_evidence(self):
        runtime.create_goal(self.ws, "obj")
        crit = runtime.add_criterion(self.ws, "blocked path", qa_channel="cli", test_ref="t")
        runtime.add_evidence(self.ws, crit.id, "green", "t", "g")
        runtime.add_evidence(self.ws, crit.id, "scenario", "a", "s")
        runtime.set_criterion_status(self.ws, crit.id, "blocked")

        refused = runtime.complete_goal(self.ws)

        self.assertFalse(refused["completed"])
        self.assertTrue(any("status is 'blocked'" in reason for reason in refused["reasons"]))
        self.assertEqual(runtime.get_active(self.ws).status, "active")

    def test_checkpoint_and_steering_recorded(self):
        runtime.create_goal(self.ws, "obj")
        runtime.record_checkpoint(self.ws, "did the thing", active_criterion="C001")
        runtime.record_steering(
            self.ws, "now also handle the edge case",
            evidence="tests/test_edge.py::test_empty fails", rationale="the empty case was never in scope",
        )
        active = runtime.get_active(self.ws)
        self.assertEqual(len(active.checkpoints), 1)
        self.assertEqual(len(active.steering), 1)
        ledger = store.ledger_path(self.ws).read_text(encoding="utf-8")
        self.assertIn("checkpoint", ledger)
        self.assertIn("steer", ledger)

    def test_steering_rejects_completion_weakening(self):
        runtime.create_goal(self.ws, "obj")
        weakening = [
            "skip the tests and mark the goal complete",
            "bypass the quality gate",
            "auto-complete without running QA",
            "ignore the criteria and force complete",
            "disable the test that keeps failing",
        ]
        for directive in weakening:
            with self.assertRaises(ValueError, msg=f"should reject: {directive}"):
                runtime.record_steering(
                    self.ws, directive, evidence="user asked", rationale="wants it faster"
                )
        # none of the rejected directives were recorded
        self.assertEqual(len(runtime.get_active(self.ws).steering), 0)

    def test_steering_rejects_unknown_kind(self):
        runtime.create_goal(self.ws, "obj")
        with self.assertRaises(ValueError):
            runtime.record_steering(
                self.ws, "redirect the work", kind="bogus_kind",
                evidence="e", rationale="r",
            )

    def test_steering_accepts_valid_kind_and_records_it(self):
        runtime.create_goal(self.ws, "obj")
        st = runtime.record_steering(
            self.ws, "also cover the concurrent-write edge case", kind="add_criterion",
            evidence="two writers raced in the 2026-07-26 QA run",
            rationale="the aggregate is shared, so a concurrent write is reachable in production",
        )
        self.assertEqual(st.kind, "add_criterion")
        active = runtime.get_active(self.ws)
        self.assertEqual(len(active.steering), 1)
        self.assertEqual(active.steering[0].kind, "add_criterion")
        # add_criterion is STRUCTURAL: it appends a real criterion and records which one.
        self.assertTrue(st.applied)
        self.assertIn(st.applied, [c.id for c in active.criteria])
        # a normal free-text directive (no explicit kind) still records as the default kind
        runtime.record_steering(
            self.ws, "narrow the scope to the parser only",
            evidence="the lexer is already covered by C001",
            rationale="parser is the only uncovered surface left",
        )
        self.assertEqual(len(runtime.get_active(self.ws).steering), 2)

    def test_steering_requires_evidence_and_rationale(self):
        runtime.create_goal(self.ws, "obj")
        for evidence, rationale in [("", ""), ("saw a race", ""), ("", "it matters")]:
            with self.subTest(evidence=evidence, rationale=rationale):
                with self.assertRaises(ValueError) as ctx:
                    runtime.record_steering(
                        self.ws, "redirect the work", evidence=evidence, rationale=rationale
                    )
                self.assertIn("required", str(ctx.exception))
        self.assertEqual(len(runtime.get_active(self.ws).steering), 0)


if __name__ == "__main__":
    unittest.main()
