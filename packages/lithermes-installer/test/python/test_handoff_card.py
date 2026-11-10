"""Session-end handoff card: a deterministic file written by on_session_finalize.

Every case drives the registered ``on_session_finalize`` hook with a real session id
and a real project directory, then reads the files the hook leaves behind. The card
involves no model call, no network and no subprocess; the tests pin that too.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

try:
    from .natural_routing_test_support import NaturalRoutingCase
except ImportError:
    from natural_routing_test_support import NaturalRoutingCase

from litgoal import store  # noqa: E402  (path set up by the support module)


class _Ctx:
    """Collects hooks; every other registration call is accepted and ignored."""

    def __init__(self):
        self.hooks = {}

    def register_hook(self, name, callback):
        self.hooks[name] = callback

    def __getattr__(self, name):
        return lambda *args, **kwargs: None


class HandoffCard(NaturalRoutingCase):
    def setUp(self):
        super().setUp()
        self.project = tempfile.TemporaryDirectory(prefix="lithermes-card-project-")
        self.addCleanup(self.project.cleanup)
        self.ws = Path(self.project.name).resolve()
        previous = os.getcwd()
        os.chdir(self.ws)
        self.addCleanup(os.chdir, previous)
        self.card_dir = self.ws / ".hermes" / "lithermes" / "handoff"
        # Runs are signed with a per-module key, so the goal must be seeded through the very
        # litgoal modules the plugin package loaded, or its live gate cannot verify them.
        self.runs = self.pkg.litgoal_runs
        self.runtime = sys.modules[self.pkg.__name__ + ".litgoal.runtime"]

    def seed(self, session="s1", *, criteria=2, passed=0, title="Fix the export"):
        self.runtime.create_goal(
            self.ws, "fix the month-end export", title=title, session_id=session,
            criteria=[{"scenario": f"scenario {n}", "qa_channel": "cli"} for n in range(criteria)],
        )
        for n in range(passed):
            cid = f"C{n + 1:03d}"
            run_id = self.runs.record_run(
                self.ws, session, "terminal", {"command": "pytest -q"}, json.dumps({"exit_code": 0})
            )
            self.runtime.add_evidence(self.ws, cid, "green", f"run:{run_id}", session_id=session)
            self.runtime.add_evidence(self.ws, cid, "scenario", "evidence/qa.txt", session_id=session)
            self.runtime.set_criterion_status(self.ws, cid, "pass", session_id=session)

    def finalize(self, **kwargs):
        return self.pkg._finalize_session(**{"session_id": "s1", "platform": "cli", **kwargs})

    def card(self, name="s1.json"):
        return json.loads((self.card_dir / name).read_text(encoding="utf-8"))

    def write_gate(self, session, payload):
        path = store.state_dir(self.ws, session) / "gate.json"
        path.write_text(payload if isinstance(payload, str) else json.dumps(payload), encoding="utf-8")

    def test_finalize_writes_session_card_latest_json_and_markdown(self):
        self.seed(passed=1)
        self.assertIsNone(self.finalize())
        card = self.card()
        self.assertEqual(self.card("latest.json"), card)
        self.assertEqual(card["session_id"], "s1")
        self.assertEqual(card["goal"]["title"], "Fix the export")
        self.assertEqual(card["goal"]["status"], "active")
        self.assertEqual(
            [(c["id"], c["status"]) for c in card["criteria"]], [("C001", "pass"), ("C002", "pending")]
        )
        self.assertFalse(card["gate"]["open"])
        self.assertTrue(any("C002" in reason for reason in card["gate"]["reasons"]))
        self.assertEqual([(r["id"], r["exit"]) for r in card["runs"]], [("R001", 0)])
        self.assertIn("C002", card["next_step"])
        self.assertIsNotNone(datetime.fromisoformat(card["written_at"]).tzinfo)
        markdown = (self.card_dir / "latest.md").read_text(encoding="utf-8")
        for needle in ("Fix the export", "s1", "CLOSED", card["next_step"], "C001", "R001"):
            self.assertIn(needle, markdown)
        self.assertEqual(sorted(p.name for p in self.card_dir.iterdir()), ["latest.json", "latest.md", "s1.json"])

    def test_the_card_is_deterministic_apart_from_its_timestamp(self):
        self.seed(passed=1)
        self.finalize()
        first = self.card()
        self.finalize()
        second = self.card()
        first.pop("written_at"), second.pop("written_at")
        self.assertEqual(first, second)

    def test_next_step_is_the_first_open_reason_when_every_criterion_passes(self):
        self.seed(criteria=1, passed=1)
        self.runtime.add_review_blocker(self.ws, "tests lost an assertion", session_id="s1")
        self.finalize()
        card = self.card()
        self.assertTrue(card["next_step"].startswith("unresolved review blocker B001"), card["next_step"])

    def test_gate_json_wins_and_only_the_last_three_runs_are_kept(self):
        self.seed()
        reported = [
            {"id": f"R00{n}", "exit": 0, "preview": f"pytest run {n}", "stale": n == 4} for n in range(1, 5)
        ]
        self.write_gate("s1", {
            "open": True, "reasons": [], "evaluated_at": "2026-11-09T01:02:03+00:00",
            "runs": reported, "blockers": [],
        })
        self.finalize()
        card = self.card()
        self.assertTrue(card["gate"]["open"])
        self.assertEqual(card["gate"]["reasons"], [])
        self.assertEqual([r["id"] for r in card["runs"]], ["R002", "R003", "R004"])
        self.assertTrue(card["runs"][-1]["stale"])

    def test_a_malformed_gate_json_falls_back_to_the_live_gate(self):
        self.seed()
        for payload in ("{not json", json.dumps(["wrong shape"]), json.dumps({"open": "yes"})):
            with self.subTest(payload=payload):
                self.write_gate("s1", payload)
                self.assertIsNone(self.finalize())
                self.assertFalse(self.card()["gate"]["open"])
                self.assertTrue(self.card()["gate"]["reasons"])

    def test_a_session_without_a_goal_writes_nothing_and_keeps_the_previous_latest(self):
        self.seed()
        self.finalize()
        before = (self.card_dir / "latest.json").read_bytes()
        self.assertIsNone(self.finalize(session_id="no-goal"))
        self.assertFalse((self.card_dir / "no-goal.json").exists())
        self.assertEqual((self.card_dir / "latest.json").read_bytes(), before)

    def test_a_finished_goal_gets_a_card_that_says_so(self):
        self.seed(criteria=1, passed=1)
        self.runtime.complete_goal(self.ws, session_id="s1")
        self.finalize()
        card = self.card()
        self.assertEqual(card["goal"]["status"], "complete")
        self.assertIn("complete", card["next_step"].lower())

    def test_hostile_session_ids_never_raise_and_write_nothing(self):
        self.seed()
        for hostile in (None, "", ["s1"], 7, "../escape", "a/b", ".hidden", "x" * 200):
            with self.subTest(session=hostile):
                self.assertIsNone(self.finalize(session_id=hostile))
        self.assertFalse(self.card_dir.exists())
        self.assertFalse((self.ws.parent / "escape.json").exists())

    def test_malformed_goal_state_never_raises(self):
        path = store.goals_path(self.ws, "broken")
        path.parent.mkdir(parents=True)
        path.write_text("{not json", encoding="utf-8")
        with self.assertLogs("lithermes.handoff_card", level="WARNING"):
            self.assertIsNone(self.finalize(session_id="broken"))
        self.assertFalse(self.card_dir.exists())

    def test_an_unwritable_handoff_folder_never_raises(self):
        self.seed()
        (self.ws / ".hermes" / "lithermes").mkdir(parents=True, exist_ok=True)
        self.card_dir.write_text("a file where the folder should be", encoding="utf-8")
        with self.assertLogs("lithermes.handoff_card", level="WARNING"):
            self.assertIsNone(self.finalize())

    def test_a_write_outside_the_declared_isolation_root_is_refused_quietly(self):
        self.seed()
        with tempfile.TemporaryDirectory() as elsewhere, patch.dict(
            os.environ, {"LITHERMES_ISOLATED_ROOT": elsewhere}
        ):
            with self.assertLogs("lithermes.handoff_card", level="WARNING"):
                self.assertIsNone(self.finalize())
        self.assertFalse(self.card_dir.exists())

    def test_a_failing_card_still_releases_the_session(self):
        self.seed()
        with patch.object(self.pkg.handoff_card, "write_session_card", side_effect=RuntimeError("boom")), \
             patch.object(self.pkg.bounded_work, "release_bounded_session") as release, \
             self.assertLogs("lithermes.handoff_card", level="WARNING"):
            self.assertIsNone(self.finalize())
        release.assert_called_once_with("s1")

    def test_secrets_in_the_goal_are_redacted_from_every_card_file(self):
        self.seed(title="call with api_key=sk-abcdefghijklmnop1234")
        self.finalize()
        for path in self.card_dir.iterdir():
            self.assertNotIn("abcdefghijklmnop1234", path.read_text(encoding="utf-8"), path.name)

    def test_the_card_needs_no_network_and_starts_no_process(self):
        self.seed(passed=1)
        with patch.object(socket.socket, "connect", side_effect=AssertionError("network")), \
             patch.object(subprocess, "Popen", side_effect=AssertionError("subprocess")):
            self.finalize()
        self.assertTrue((self.card_dir / "s1.json").is_file())

    def test_the_registered_finalize_hook_writes_the_card(self):
        self.seed()
        ctx = _Ctx()
        self.pkg.register(ctx)
        self.assertIsNone(ctx.hooks["on_session_finalize"](session_id="s1", platform="cli", reason="shutdown"))
        self.assertTrue((self.card_dir / "s1.json").is_file())
        self.assertNotEqual(ctx.hooks["on_session_reset"], ctx.hooks["on_session_finalize"])


if __name__ == "__main__":
    unittest.main()
