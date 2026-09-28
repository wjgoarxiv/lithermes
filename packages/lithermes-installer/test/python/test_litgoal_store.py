"""W1-T1: litgoal durable state model + store (round-trip, atomic write, paths)."""

import json
import os
import sys
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

_HERE = os.path.dirname(os.path.abspath(__file__))
_ASSET_DIR = os.path.normpath(os.path.join(_HERE, "..", "..", "assets", "lithermes-plugin"))
if _ASSET_DIR not in sys.path:
    sys.path.insert(0, _ASSET_DIR)

from litgoal import model, runtime, store  # noqa: E402


def _valid_persisted_state():
    return {
        "version": 1,
        "created_at": "2026-07-27T00:00:00+00:00",
        "updated_at": "2026-07-27T00:00:00+00:00",
        "active_goal_id": "G001",
        "goals": [{
            "id": "G001",
            "objective": "ship",
            "title": "",
            "status": "active",
            "criteria": [{
                "id": "C001",
                "scenario": "works",
                "qa_channel": "cli",
                "test_ref": "test::works",
                "status": "pass",
                "evidence": [
                    {"kind": "green", "ref": "test::works", "detail": "", "at": ""},
                    {"kind": "scenario", "ref": "evidence/qa.txt", "detail": "", "at": ""},
                ],
            }],
            "checkpoints": [],
            "steering": [],
            "review_blockers": [],
        }],
    }


class StatePaths(unittest.TestCase):
    def test_state_dir_anchored_under_hermes_lithermes(self):
        ws = Path("/tmp/example-ws")
        d = store.state_dir(ws)
        self.assertEqual(d, ws / ".hermes" / "lithermes" / "litgoal")
        self.assertEqual(store.goals_path(ws), d / "goals.json")
        self.assertEqual(store.ledger_path(ws), d / "ledger.jsonl")
        self.assertEqual(store.evidence_dir(ws), d / "evidence")


class RoundTrip(unittest.TestCase):
    def test_load_or_create_then_save_round_trips(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            state = store.load_or_create(ws)
            self.assertEqual(state.version, model.STATE_VERSION)
            self.assertEqual(state.goals, [])

            goal = model.Goal(id="G001", objective="ship the thing")
            goal.criteria.append(
                model.Criterion(id="C001", scenario="happy path", qa_channel="tmux", test_ref="t.py::test_happy")
            )
            state.goals.append(goal)
            state.active_goal_id = "G001"
            store.save(ws, state)

            reloaded = store.load_or_create(ws)
            self.assertEqual(reloaded.active_goal_id, "G001")
            self.assertEqual(len(reloaded.goals), 1)
            self.assertEqual(reloaded.goals[0].objective, "ship the thing")
            self.assertEqual(reloaded.goals[0].criteria[0].qa_channel, "tmux")
            self.assertEqual(reloaded.goals[0].criteria[0].status, "pending")

    def test_save_is_atomic_no_partial_temp_left(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            state = store.load_or_create(ws)
            store.save(ws, state)
            # no leftover *.tmp sibling files in the state dir
            leftovers = list(store.state_dir(ws).glob("*.tmp"))
            self.assertEqual(leftovers, [], f"atomic write left temp files: {leftovers}")

    def test_append_ledger_writes_jsonl(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            store.append_ledger(ws, {"kind": "goal_created", "goal_id": "G001"})
            store.append_ledger(ws, {"kind": "criterion_added", "criterion_id": "C001"})
            lines = store.ledger_path(ws).read_text(encoding="utf-8").strip().splitlines()
            self.assertEqual(len(lines), 2)
            self.assertIn("goal_created", lines[0])

    def test_malformed_existing_goals_state_fails_controlled_without_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            store.goals_path(ws).parent.mkdir(parents=True, exist_ok=True)
            store.goals_path(ws).write_text("{not valid json", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "malformed litgoal state"):
                store.load_or_create(ws)
            self.assertEqual(store.goals_path(ws).read_text(encoding="utf-8"), "{not valid json")

    def test_schema_invalid_existing_state_fails_before_model_construction_without_overwrite(self):
        malformed_states = {
            "top-level list": [],
            "unsupported version": {"version": 999, "goals": []},
            "goals is not a list": {"version": 1, "goals": {}},
            "unknown goal status": {
                "version": 1,
                "active_goal_id": "G001",
                "goals": [{"id": "G001", "objective": "ship", "status": "invented"}],
            },
            "evidence is not a list": {
                "version": 1,
                "active_goal_id": "G001",
                "goals": [{
                    "id": "G001",
                    "objective": "ship",
                    "criteria": [{"id": "C001", "scenario": "works", "evidence": {}}],
                }],
            },
        }
        for label, payload in malformed_states.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as tmp:
                ws = Path(tmp)
                path = store.goals_path(ws)
                path.parent.mkdir(parents=True, exist_ok=True)
                original = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                path.write_text(original, encoding="utf-8")

                with self.assertRaisesRegex(ValueError, "malformed litgoal state"):
                    store.load_or_create(ws)

                self.assertEqual(path.read_text(encoding="utf-8"), original)

    def test_missing_required_fields_and_duplicate_ids_close_the_public_gate_without_rewrite(self):
        cases = {}

        missing_version = _valid_persisted_state()
        del missing_version["version"]
        cases["missing version"] = missing_version

        missing_objective = _valid_persisted_state()
        del missing_objective["goals"][0]["objective"]
        cases["missing objective"] = missing_objective

        missing_scenario = _valid_persisted_state()
        del missing_scenario["goals"][0]["criteria"][0]["scenario"]
        cases["missing scenario"] = missing_scenario

        missing_ref = _valid_persisted_state()
        del missing_ref["goals"][0]["criteria"][0]["evidence"][0]["ref"]
        cases["missing evidence ref"] = missing_ref

        duplicate_criterion = _valid_persisted_state()
        duplicate_criterion["goals"][0]["criteria"].append(
            deepcopy(duplicate_criterion["goals"][0]["criteria"][0])
        )
        cases["duplicate criterion id"] = duplicate_criterion

        duplicate_goal = _valid_persisted_state()
        duplicate_goal["goals"].append(deepcopy(duplicate_goal["goals"][0]))
        cases["duplicate goal id"] = duplicate_goal

        duplicate_blocker = _valid_persisted_state()
        blocker = {"id": "B001", "detail": "finding", "resolved": False}
        duplicate_blocker["goals"][0]["review_blockers"] = [blocker, deepcopy(blocker)]
        cases["duplicate blocker id"] = duplicate_blocker

        invalid_blocker_flag = _valid_persisted_state()
        invalid_blocker_flag["goals"][0]["review_blockers"] = [
            {"id": "B001", "detail": "finding", "resolved": 0}
        ]
        cases["blocker resolved is not literal bool"] = invalid_blocker_flag

        dangling_active = _valid_persisted_state()
        dangling_active["active_goal_id"] = "G999"
        cases["active goal reference missing"] = dangling_active

        for label, payload in cases.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as tmp:
                ws = Path(tmp)
                path = store.goals_path(ws)
                path.parent.mkdir(parents=True, exist_ok=True)
                original = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                path.write_text(original, encoding="utf-8")

                with self.assertRaisesRegex(ValueError, "malformed litgoal state"):
                    runtime.quality_gate(ws)

                self.assertEqual(path.read_text(encoding="utf-8"), original)

    def test_checkpoint_and_steering_ids_close_the_public_gate_without_rewrite(self):
        checkpoint = {
            "id": "K001",
            "at": "2026-07-27T00:00:00+00:00",
            "summary": "checkpoint",
            "active_criterion": "C001",
        }
        steering = {
            "id": "S001",
            "at": "2026-07-27T00:00:00+00:00",
            "directive": "continue",
            "kind": "redirect",
            "evidence": "review",
            "rationale": "required",
            "applied": "",
        }
        cases = {}

        empty_checkpoint_id = _valid_persisted_state()
        empty_checkpoint_id["goals"][0]["checkpoints"] = [
            {**checkpoint, "id": ""}
        ]
        cases["empty checkpoint id"] = empty_checkpoint_id

        duplicate_checkpoint_id = _valid_persisted_state()
        duplicate_checkpoint_id["goals"][0]["checkpoints"] = [
            checkpoint,
            deepcopy(checkpoint),
        ]
        cases["duplicate checkpoint id"] = duplicate_checkpoint_id

        empty_steering_id = _valid_persisted_state()
        empty_steering_id["goals"][0]["steering"] = [
            {**steering, "id": ""}
        ]
        cases["empty steering id"] = empty_steering_id

        duplicate_steering_id = _valid_persisted_state()
        duplicate_steering_id["goals"][0]["steering"] = [
            steering,
            deepcopy(steering),
        ]
        cases["duplicate steering id"] = duplicate_steering_id

        for label, payload in cases.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as tmp:
                ws = Path(tmp)
                path = store.goals_path(ws)
                path.parent.mkdir(parents=True, exist_ok=True)
                original = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                path.write_text(original, encoding="utf-8")

                with self.assertRaisesRegex(ValueError, "malformed litgoal state"):
                    runtime.quality_gate(ws)

                self.assertEqual(path.read_text(encoding="utf-8"), original)


class DurableWrite(unittest.TestCase):
    def test_save_calls_fsync_and_dir_fsync(self):
        """os.fsync must be called on the tmp file fd AND (best-effort) on the parent dir."""
        import unittest.mock as mock

        fsync_calls = []

        def spy_fsync(fd):
            fsync_calls.append(fd)

        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            state = store.load_or_create(ws)
            with mock.patch("os.fsync", side_effect=spy_fsync):
                store.save(ws, state)

        # At minimum one fsync call must have been made (for the tmp file fd).
        self.assertGreater(len(fsync_calls), 0, "os.fsync was never called during save()")

    def test_save_tmp_in_same_dir_as_target(self):
        """mkstemp must create the tmp file in the same directory as goals.json."""
        import unittest.mock as mock

        tmp_dirs_used = []
        original_mkstemp = tempfile.mkstemp

        def spy_mkstemp(*args, **kwargs):
            tmp_dirs_used.append(kwargs.get("dir"))
            return original_mkstemp(*args, **kwargs)

        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            state = store.load_or_create(ws)
            target_parent = str(store.goals_path(ws).parent)
            with mock.patch("tempfile.mkstemp", side_effect=spy_mkstemp):
                store.save(ws, state)

        self.assertTrue(
            any(d == target_parent for d in tmp_dirs_used),
            f"mkstemp not called with goals.json parent dir; dirs seen: {tmp_dirs_used}",
        )


if __name__ == "__main__":
    unittest.main()
