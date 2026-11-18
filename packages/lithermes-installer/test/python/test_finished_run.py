"""A start-work run whose recorded plan is fully ticked is finished, never work in progress."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

_ASSET_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "lithermes-plugin"))
if _ASSET_DIR not in sys.path:
    sys.path.insert(0, _ASSET_DIR)

import core_recap_state  # noqa: E402
import lit_reentry  # noqa: E402


def _run(ws: Path, rid: str, plan: str | None) -> None:
    run = ws / ".hermes" / "lithermes" / "runs" / rid
    run.mkdir(parents=True)
    state = {"run_id": rid, "command": "start-work", "task": f"Start work from {rid}", "created_at": "2026-11-18T00:00:00+00:00"}
    if plan is not None:
        state["plan"] = str(ws / plan)
    (run / "state.json").write_text(json.dumps(state), encoding="utf-8")


class FinishedRun(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ws = Path(self.tmp.name)
        (self.ws / "plans").mkdir()
        (self.ws / "plans" / "a.md").write_text("# A\n\n## Todos\n- [x] 1. One\n- [x] 2. Two\n", encoding="utf-8")
        (self.ws / "plans" / "b.md").write_text("# B\n\n## Todos\n- [ ] 1. Open step\n", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_plan_a_ticked_while_plan_b_open_reads_finished(self):
        _run(self.ws, "run-a", "plans/a.md")
        digest = core_recap_state.read_recap_digest(self.ws)
        self.assertEqual([item for item in digest.in_progress if "run-a" in item], [])
        self.assertTrue(any("run-a" in item and "finished" in item for item in digest.completed), digest.completed)
        self.assertIsNone(lit_reentry._resumable_work(self.ws))

    def test_an_open_recorded_plan_stays_in_progress(self):
        _run(self.ws, "run-b", "plans/b.md")
        digest = core_recap_state.read_recap_digest(self.ws)
        self.assertTrue(any("run-b" in item for item in digest.in_progress), digest.in_progress)

    def test_old_record_without_a_plan_guesses_from_the_folder(self):
        _run(self.ws, "run-old", None)
        self.assertTrue(any("run-old" in item for item in core_recap_state.read_recap_digest(self.ws).in_progress))
        (self.ws / "plans" / "b.md").write_text("# B\n\n## Todos\n- [x] 1. Open step\n", encoding="utf-8")
        digest = core_recap_state.read_recap_digest(self.ws)
        self.assertEqual([item for item in digest.in_progress if "run-old" in item], [])


if __name__ == "__main__":
    unittest.main()
