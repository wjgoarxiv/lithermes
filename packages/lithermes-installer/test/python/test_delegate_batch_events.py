from __future__ import annotations

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


class DelegateBatchIntentTelemetry(unittest.TestCase):
    def setUp(self):
        self._old_home = os.environ.get("HERMES_HOME")
        self.hermes_home = tempfile.TemporaryDirectory(prefix="lh-events-home-")
        os.environ["HERMES_HOME"] = self.hermes_home.name

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("HERMES_HOME", None)
        else:
            os.environ["HERMES_HOME"] = self._old_home
        self.hermes_home.cleanup()

    def _events(self):
        path = Path(self.hermes_home.name) / "lithermes" / "events.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

    def test_record_delegate_batch_intent_redacts_and_writes_local_event(self):
        with tempfile.TemporaryDirectory(prefix="lh-workspace-") as workspace:
            event = core.record_delegate_batch_intent(
                workspace=Path(workspace),
                mode="review-work",
                lanes=["goal", "qa", "code-quality", "security", "context"],
                session_id="sess-secret",
                context={
                    "note": "Authorization: Bearer shh-secret-token-123",
                    "url": "https://telemetry.example.invalid/collect",
                },
            )

        events = self._events()
        self.assertEqual(len(events), 1)
        saved = events[0]
        self.assertEqual(saved["event"], "delegate_batch_intent")
        self.assertEqual(saved["mode"], "review-work")
        self.assertEqual(saved["lanes"], ["goal", "qa", "code-quality", "security", "context"])
        self.assertEqual(saved["run_id"], event["run_id"])
        self.assertIn("/delegate_batches/", saved["artifact_dir"])
        self.assertTrue(saved["artifact_dir"].endswith("/"))
        payload = json.dumps(saved, sort_keys=True)
        self.assertNotIn("shh-secret-token-123", payload)
        self.assertNotIn("telemetry.example.invalid", payload)
        self.assertNotIn("https://", payload)
        self.assertIn("[REDACTED", payload)

    def test_review_work_emits_one_five_lane_delegate_batch_intent(self):
        with tempfile.TemporaryDirectory(prefix="lh-workspace-") as workspace:
            result = core.command_review_work(f"--worktree {workspace} --base HEAD~1")
        msg = result["agent_message"]
        self.assertIn("IN ONE delegate_task call", msg)
        self.assertIn("array of 5 entries", msg)
        for lane, _ in core.REVIEW_LANES:
            self.assertIn(f"lane[{lane}]", msg)

        events = [event for event in self._events() if event.get("event") == "delegate_batch_intent"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["mode"], "review-work")
        self.assertEqual(events[0]["lanes"], [lane for lane, _ in core.REVIEW_LANES])
        self.assertIn("/delegate_batches/", events[0]["artifact_dir"])

    def test_subagent_stop_is_observer_only_redacted_and_tolerates_logging_failure(self):
        ret = core.subagent_stop(
            parent_session_id="parent-1",
            child_role="qa",
            child_status="done Authorization: Bearer shh-secret-token-123",
            duration_ms=1234,
        )
        self.assertIsNone(ret)
        saved = self._events()[-1]
        self.assertEqual(saved["event"], "subagent_stop")
        self.assertEqual(saved["parent_session_id"], "parent-1")
        self.assertEqual(saved["child_role"], "qa")
        self.assertEqual(saved["duration_ms"], 1234)
        payload = json.dumps(saved, sort_keys=True)
        self.assertNotIn("shh-secret-token-123", payload)
        self.assertIn("[REDACTED", payload)

        with tempfile.TemporaryDirectory(prefix="lh-file-home-") as tmp:
            file_home = Path(tmp) / "not-a-dir"
            file_home.write_text("x", encoding="utf-8")
            os.environ["HERMES_HOME"] = str(file_home)
            self.assertIsNone(core.subagent_stop(child_status="ok"))


if __name__ == "__main__":
    unittest.main()
