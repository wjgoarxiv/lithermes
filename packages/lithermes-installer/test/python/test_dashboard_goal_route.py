"""Dashboard route: the newest litgoal as read-only JSON for the Desktop pane."""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from importlib import import_module
from pathlib import Path
from unittest import mock

_HERE = os.path.dirname(os.path.abspath(__file__))
_ASSET_DIR = os.path.normpath(os.path.join(_HERE, "..", "..", "assets", "lithermes-plugin"))
if _ASSET_DIR not in sys.path:
    sys.path.insert(0, _ASSET_DIR)

from litgoal import runtime, store  # noqa: E402

try:
    from .plugin_register_test_support import _load_plugin_package
except ImportError:
    from plugin_register_test_support import _load_plugin_package

_SPEC = importlib.util.spec_from_file_location(
    "lithermes_dashboard_plugin_api", os.path.join(_ASSET_DIR, "dashboard", "plugin_api.py")
)
plugin_api = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(plugin_api)


def _files(root: Path) -> dict:
    return {
        str(p.relative_to(root)): (p.stat().st_mtime_ns, p.stat().st_size)
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


class GoalRoute(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name).resolve() / "home"
        self.outside = Path(self._tmp.name).resolve() / "elsewhere"
        self.ws = self.home / "project"
        for folder in (self.ws, self.outside):
            folder.mkdir(parents=True)
        patcher = mock.patch.object(plugin_api, "_home_root", return_value=self.home)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)

    def _goal(self, session_id="", objective="ship the pane", scenarios=("happy path",)):
        runtime.create_goal(
            self.ws,
            objective,
            title="Pane",
            criteria=[{"scenario": item, "qa_channel": "tmux", "test_ref": "t"} for item in scenarios],
            session_id=session_id,
        )

    def test_empty_workspace_returns_null_goal(self):
        snapshot = plugin_api.goal_snapshot(str(self.ws))
        self.assertIsNone(snapshot["goal"])
        self.assertEqual((snapshot["criteria"], snapshot["evidence"]), ([], []))
        self.assertFalse(snapshot["gate"]["open"])

    def test_blank_cwd_returns_null_goal_instead_of_refusing(self):
        self.assertIsNone(plugin_api.goal_snapshot("  ")["goal"])

    def test_active_goal_lists_criteria_evidence_and_closed_gate(self):
        self._goal(session_id="s1")
        runtime.add_evidence(self.ws, "C001", "green", "t.py::x", "ok", session_id="s1")
        snapshot = plugin_api.get_goal(str(self.ws))
        self.assertEqual(snapshot["goal"]["title"], "Pane")
        self.assertEqual(snapshot["goal"]["status"], "active")
        self.assertEqual(
            snapshot["criteria"], [{"id": "C001", "text": "happy path", "status": "pending"}]
        )
        self.assertEqual(
            snapshot["evidence"], [{"criterion": "C001", "kind": "green", "ref": "t.py::x", "verified": False}]
        )
        self.assertFalse(snapshot["gate"]["open"])
        self.assertTrue(any("C001" in reason for reason in snapshot["gate"]["reasons"]))

    def test_gate_opens_when_every_criterion_is_proven(self):
        self._goal()
        # The route re-checks run signatures with its own copy of litgoal, so the proof
        # is recorded through that copy: a run signed by another process never opens it.
        _, view_runtime = plugin_api._load_litgoal()
        view_runs = sys.modules[plugin_api._VIEW_PACKAGE + ".runs"]
        run_id = view_runs.record_run(
            self.ws, "", "terminal", {"command": "pytest -q"}, json.dumps({"exit_code": 0})
        )
        view_runtime.add_evidence(self.ws, "C001", "green", f"run:{run_id}")
        view_runtime.add_evidence(self.ws, "C001", "scenario", "evidence/qa.txt")
        view_runtime.set_criterion_status(self.ws, "C001", "pass")
        snapshot = plugin_api.goal_snapshot(str(self.ws))
        self.assertTrue(snapshot["gate"]["open"], snapshot["gate"]["reasons"])
        self.assertEqual(snapshot["gate"]["reasons"], [])
        self.assertEqual(snapshot["criteria"][0]["status"], "pass")
        self.assertTrue(snapshot["evidence"][0]["verified"])

    def test_newest_session_wins_over_older_and_legacy_state(self):
        self._goal(objective="legacy goal")
        self._goal(session_id="old", objective="older session goal")
        self._goal(session_id="new", objective="newer session goal")
        base = store.goals_path(self.ws, "new").stat().st_mtime
        os.utime(store.goals_path(self.ws, ""), (base - 200, base - 200))
        os.utime(store.goals_path(self.ws, "old"), (base - 100, base - 100))
        self.assertEqual(plugin_api.goal_snapshot(str(self.ws))["goal"]["objective"], "newer session goal")

    def test_secrets_are_redacted_and_long_text_is_capped(self):
        self._goal(scenarios=("call with api_key=sk-abcdefghijklmnop1234 " + "x" * 900,))
        runtime.add_evidence(
            self.ws, "C001", "note", "see ghp_abcdefghijklmnop1234 in the log"
        )
        raw = repr(plugin_api.goal_snapshot(str(self.ws)))
        self.assertNotIn("abcdefghijklmnop1234", raw)
        self.assertIn("REDACTED_SECRET", raw)
        self.assertLessEqual(len(plugin_api.goal_snapshot(str(self.ws))["criteria"][0]["text"]), 400)

    def test_cwd_outside_home_is_refused_with_400(self):
        with self.assertRaises(plugin_api.CwdRefused):
            plugin_api.goal_snapshot(str(self.outside))
        if plugin_api.HTTPException is None:
            self.skipTest("FastAPI is not installed in this interpreter")
        with self.assertRaises(plugin_api.HTTPException) as caught:
            plugin_api.get_goal(str(self.outside))
        self.assertEqual(caught.exception.status_code, 400)

    def test_relative_dotdot_and_symlink_escapes_are_refused(self):
        (self.home / "link").symlink_to(self.outside)
        for hostile in (
            "project",
            str(self.ws / ".." / ".." / "elsewhere"),
            str(self.home / "link"),
            str(self.home / "link" / "deeper"),
            "/",
            "bad\0path",
        ):
            with self.subTest(cwd=hostile), self.assertRaises(plugin_api.CwdRefused):
                plugin_api.goal_snapshot(hostile)

    def test_state_file_symlinked_outside_the_workspace_is_ignored(self):
        self._goal(session_id="real")
        stolen = self.outside / "goals.json"
        stolen.write_text(store.goals_path(self.ws, "real").read_text(encoding="utf-8"), encoding="utf-8")
        shutil_target = store.goals_path(self.ws, "real")
        shutil_target.unlink()
        shutil_target.symlink_to(stolen)
        self.assertIsNone(plugin_api.goal_snapshot(str(self.ws))["goal"])

    def test_malformed_state_reports_an_error_instead_of_raising(self):
        path = store.goals_path(self.ws, "broken")
        path.parent.mkdir(parents=True)
        path.write_text("{not json", encoding="utf-8")
        snapshot = plugin_api.goal_snapshot(str(self.ws))
        self.assertIsNone(snapshot["goal"])
        self.assertIn("could not be read", snapshot["error"])

    def test_reading_never_writes(self):
        self._goal(session_id="s1")
        before = _files(self.ws)
        plugin_api.goal_snapshot(str(self.ws))
        self.assertEqual(_files(self.ws), before)

    def test_loads_by_path_in_a_fresh_interpreter_without_the_plugin_on_sys_path(self):
        self._goal(session_id="s1", objective="read from a bare gateway process")
        script = (
            "import importlib.util, json, sys\n"
            "spec = importlib.util.spec_from_file_location('plugin_api', sys.argv[1])\n"
            "module = importlib.util.module_from_spec(spec)\n"
            "spec.loader.exec_module(module)\n"
            "print(json.dumps(module.goal_snapshot(sys.argv[2])))\n"
        )
        api = os.path.join(_ASSET_DIR, "dashboard", "plugin_api.py")
        result = subprocess.run(
            [sys.executable, "-I", "-c", script, api, str(self.ws)],
            capture_output=True, text=True, timeout=60,
            env={**os.environ, "HOME": str(self.home), "PYTHONDONTWRITEBYTECODE": "1"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout)["goal"]["objective"], "read from a bare gateway process"
        )

    @unittest.skipIf(plugin_api.router is None, "FastAPI is not installed in this interpreter")
    def test_router_exposes_exactly_one_get_goal_route(self):
        routes = [(route.path, sorted(route.methods)) for route in plugin_api.router.routes]
        self.assertEqual(routes, [("/goal", ["GET"])])


STAGE_KEYS = ["plan", "runs", "review", "gate", "handoff", "resume"]


class GoalStages(unittest.TestCase):
    """The six-stage timeline: plan, runs, review, gate, handoff, resume."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name).resolve() / "home"
        self.outside = Path(self._tmp.name).resolve() / "elsewhere"
        self.ws = self.home / "project"
        for folder in (self.ws, self.outside):
            folder.mkdir(parents=True)
        patcher = mock.patch.object(plugin_api, "_home_root", return_value=self.home)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)

    def _goal(self, session_id="s1", criteria=2):
        runtime.create_goal(
            self.ws, "fix the export", title="Export",
            criteria=[{"scenario": f"scenario {n}", "qa_channel": "cli"} for n in range(criteria)],
            session_id=session_id,
        )

    def _gate_json(self, payload, session_id="s1"):
        path = store.state_dir(self.ws, session_id) / "gate.json"
        path.write_text(payload if isinstance(payload, str) else json.dumps(payload), encoding="utf-8")
        return path

    def _stages(self):
        stages = plugin_api.goal_snapshot(str(self.ws))["stages"]
        return stages, {stage["key"]: stage for stage in stages}

    def _reported(self, **overrides):
        report = {
            "open": False,
            "reasons": ["C001 evidence R007 is stale: export.py changed after the run", "C002 status is 'pending'"],
            "evaluated_at": "2026-11-09T05:00:00+00:00",
            "runs": [
                {"id": "R004", "exit": 0, "preview": "pytest -q", "stale": False},
                {"id": "R007", "exit": 0, "preview": "pytest -q", "stale": True},
            ],
            "blockers": [{"source": "weakening-guard", "text": "test removed", "resolved": False}],
        }
        report.update(overrides)
        return report

    def test_no_goal_has_no_stages(self):
        self.assertEqual(plugin_api.goal_snapshot(str(self.ws))["stages"], [])

    def test_fresh_goal_lists_six_stages_in_order_with_one_active(self):
        self._goal()
        stages, by_key = self._stages()
        self.assertEqual([stage["key"] for stage in stages], STAGE_KEYS)
        self.assertEqual(
            [stage["label"] for stage in stages], ["Plan", "Runs", "Review", "Gate", "Handoff", "Resume"]
        )
        self.assertEqual(
            [stage["state"] for stage in stages], ["done", "active", "todo", "todo", "todo", "todo"]
        )
        self.assertEqual(by_key["plan"]["detail"], "2 criteria")
        self.assertEqual(by_key["runs"]["detail"], "no runs yet")
        self.assertEqual(by_key["review"]["detail"], "no blockers")
        self.assertTrue(by_key["gate"]["detail"].startswith("CLOSED \u2014 "), by_key["gate"]["detail"])
        self.assertEqual(by_key["handoff"]["detail"], "not written yet")
        self.assertEqual(by_key["resume"]["detail"], "fresh session")

    def test_a_single_criterion_is_singular(self):
        self._goal(criteria=1)
        self.assertEqual(self._stages()[1]["plan"]["detail"], "1 criterion")

    def test_reported_runs_blockers_and_gate_fill_the_stages(self):
        self._goal()
        self._gate_json(self._reported())
        stages, by_key = self._stages()
        self.assertEqual(by_key["runs"]["detail"], "R004 \u2713  R007 \u26a0 stale")
        self.assertEqual(by_key["runs"]["tone"], "warn")
        self.assertEqual(
            by_key["runs"]["items"],
            [{"text": "R004 \u2713", "tone": ""}, {"text": "R007 \u26a0 stale", "tone": "warn"}],
        )
        self.assertEqual(by_key["review"]["detail"], "1 blocker: test removed")
        self.assertEqual(by_key["review"]["tone"], "danger")
        self.assertEqual(by_key["review"]["items"], [{"text": "test removed", "tone": "danger"}])
        self.assertEqual(by_key["gate"]["detail"], "CLOSED \u2014 2 reasons")
        self.assertEqual(by_key["gate"]["tone"], "danger")
        self.assertEqual([stage["state"] for stage in stages], ["done", "active", "todo", "todo", "todo", "todo"])

    def test_top_level_gate_follows_the_session_report_and_says_so(self):
        self._goal()
        self._gate_json(self._reported())
        gate = plugin_api.goal_snapshot(str(self.ws))["gate"]
        self.assertFalse(gate["open"])
        self.assertEqual(len(gate["reasons"]), 2)
        self.assertEqual(gate["source"], "session")
        self.assertEqual(gate["evaluated_at"], "2026-11-09T05:00:00+00:00")

    def test_evidence_citing_a_stale_run_is_marked_stale(self):
        self._goal()
        runtime.add_evidence(self.ws, "C001", "green", "run:R007", "ok", session_id="s1")
        runtime.add_evidence(self.ws, "C002", "green", "run:R004", "ok", session_id="s1")
        self._gate_json(self._reported())
        rows = {row["ref"]: row for row in plugin_api.goal_snapshot(str(self.ws))["evidence"]}
        self.assertIs(rows["run:R007"].get("stale"), True)
        self.assertNotIn("stale", rows["run:R004"])

    def test_without_a_report_the_gate_is_the_live_one_and_unlabelled(self):
        self._goal()
        gate = plugin_api.goal_snapshot(str(self.ws))["gate"]
        self.assertNotIn("source", gate)
        self.assertFalse(gate["open"])

    def test_a_clean_open_report_completes_plan_runs_review_and_gate(self):
        self._goal()
        self._gate_json(self._reported(
            open=True, reasons=[], blockers=[],
            runs=[{"id": "R004", "exit": 0, "preview": "pytest -q", "stale": False}],
        ))
        stages, by_key = self._stages()
        self.assertEqual(
            [stage["state"] for stage in stages], ["done", "done", "done", "done", "active", "todo"]
        )
        self.assertEqual(by_key["gate"]["detail"], "OPEN")
        self.assertEqual(by_key["gate"]["tone"], "ok")
        self.assertEqual(by_key["review"]["detail"], "no blockers")
        self.assertEqual(by_key["runs"]["detail"], "R004 \u2713")

    def test_a_failed_run_is_marked_and_resolved_blockers_are_not_counted(self):
        self._goal()
        self._gate_json(self._reported(
            runs=[{"id": "R001", "exit": 1, "preview": "pytest -q", "stale": False}],
            blockers=[{"source": "weakening-guard", "text": "old", "resolved": True}],
        ))
        _, by_key = self._stages()
        self.assertEqual(by_key["runs"]["detail"], "R001 \u2717 exit 1")
        self.assertEqual(by_key["runs"]["tone"], "danger")
        self.assertEqual(by_key["review"]["detail"], "no blockers")

    def test_a_single_reason_is_singular(self):
        self._goal()
        self._gate_json(self._reported(reasons=["C002 status is 'pending'"]))
        self.assertEqual(self._stages()[1]["gate"]["detail"], "CLOSED \u2014 1 reason")

    def test_only_the_last_three_runs_show(self):
        self._goal()
        self._gate_json(self._reported(
            runs=[{"id": f"R00{n}", "exit": 0, "preview": "x", "stale": False} for n in range(1, 6)],
        ))
        self.assertEqual(self._stages()[1]["runs"]["detail"], "R003 \u2713  R004 \u2713  R005 \u2713")

    def test_review_without_a_report_reads_the_goal_state(self):
        self._goal()
        runtime.add_review_blocker(self.ws, "tests lost an assertion", session_id="s1")
        _, by_key = self._stages()
        self.assertEqual(by_key["review"]["detail"], "1 blocker: tests lost an assertion")
        self.assertEqual(by_key["review"]["tone"], "danger")

    def test_a_saved_handoff_card_marks_the_handoff_stage_with_its_local_time(self):
        self._goal()
        card_dir = self.ws / ".hermes" / "lithermes" / "handoff"
        card_dir.mkdir(parents=True)
        (card_dir / "s1.json").write_text(
            json.dumps({"session_id": "s1", "written_at": "2026-11-09T14:02:00+00:00"}), encoding="utf-8"
        )
        with mock.patch.dict(os.environ, {"TZ": "UTC"}):
            time.tzset()
            try:
                _, by_key = self._stages()
            finally:
                os.environ.pop("TZ", None)
                time.tzset()
        self.assertEqual(by_key["handoff"]["detail"], "saved 14:02")
        self.assertEqual(by_key["handoff"]["state"], "done")

    def test_a_handoff_card_for_another_session_does_not_count(self):
        self._goal()
        card_dir = self.ws / ".hermes" / "lithermes" / "handoff"
        card_dir.mkdir(parents=True)
        (card_dir / "other.json").write_text(json.dumps({"written_at": "2026-11-09T14:02:00+00:00"}), encoding="utf-8")
        self.assertEqual(self._stages()[1]["handoff"]["detail"], "not written yet")

    def test_an_adopted_goal_marks_the_resume_stage(self):
        self._goal(session_id="3f1a9c2e-77aa-4b1c-9d00-aaaaaaaaaaaa")
        store.adopt(self.ws, "3f1a9c2e-77aa-4b1c-9d00-aaaaaaaaaaaa", "next-session")
        base = store.goals_path(self.ws, "next-session").stat().st_mtime
        os.utime(store.goals_path(self.ws, "3f1a9c2e-77aa-4b1c-9d00-aaaaaaaaaaaa"), (base - 100, base - 100))
        _, by_key = self._stages()
        self.assertEqual(by_key["resume"]["detail"], "resumed from an earlier session")
        self.assertNotIn("3f1a", json.dumps(by_key["resume"]), "never the raw session id")
        self.assertEqual(by_key["resume"]["state"], "done")
        # With the earlier session's handoff card on disk, its time is shown.
        card_dir = self.ws / ".hermes" / "lithermes" / "handoff"
        card_dir.mkdir(parents=True, exist_ok=True)
        (card_dir / "3f1a9c2e-77aa-4b1c-9d00-aaaaaaaaaaaa.json").write_text(
            json.dumps({"written_at": "2026-11-09T14:02:00+00:00"}), encoding="utf-8"
        )
        with mock.patch.dict(os.environ, {"TZ": "UTC"}):
            time.tzset()
            try:
                _, by_key = self._stages()
            finally:
                os.environ.pop("TZ", None)
                time.tzset()
        self.assertEqual(by_key["resume"]["detail"], "resumed from an earlier session (handoff 14:02)")

    def test_hostile_reports_are_ignored_or_bounded_and_redacted(self):
        self._goal()
        for payload in ("{not json", json.dumps(["list"]), json.dumps({"open": "yes", "reasons": "x"}), "x" * 400_000):
            with self.subTest(payload=payload[:20]):
                self._gate_json(payload)
                snapshot = plugin_api.goal_snapshot(str(self.ws))
                self.assertNotIn("source", snapshot["gate"])
                self.assertEqual([stage["key"] for stage in snapshot["stages"]], STAGE_KEYS)
        self._gate_json(self._reported(
            reasons=["token ghp_abcdefghijklmnop1234 " + "y" * 900] * 80,
            runs=[{"id": "R1", "exit": "zero", "preview": "p", "stale": "no"}, "junk", None]
            + [{"id": f"R{n}", "exit": 0, "preview": "p", "stale": False} for n in range(2, 900)],
            blockers=[{"text": "api_key=sk-abcdefghijklmnop1234 " + "z" * 900, "resolved": False}] + ["junk", 7],
        ))
        snapshot = plugin_api.goal_snapshot(str(self.ws))
        raw = repr(snapshot)
        self.assertNotIn("abcdefghijklmnop1234", raw)
        self.assertLessEqual(len(snapshot["gate"]["reasons"]), 20)
        self.assertTrue(all(len(reason) <= 300 for reason in snapshot["gate"]["reasons"]))
        self.assertTrue(all(len(stage["detail"]) <= 300 for stage in snapshot["stages"]))

    def test_a_report_symlinked_outside_the_workspace_is_ignored(self):
        self._goal()
        stolen = self.outside / "gate.json"
        stolen.write_text(json.dumps(self._reported(open=True, reasons=[])), encoding="utf-8")
        (store.state_dir(self.ws, "s1") / "gate.json").symlink_to(stolen)
        gate = plugin_api.goal_snapshot(str(self.ws))["gate"]
        self.assertNotIn("source", gate)
        self.assertFalse(gate["open"])

    def test_building_stages_never_writes(self):
        self._goal()
        self._gate_json(self._reported())
        before = _files(self.ws)
        plugin_api.goal_snapshot(str(self.ws))
        self.assertEqual(_files(self.ws), before)


class StagesFromARealGateSnapshot(unittest.TestCase):
    """gate.json written by the session's own gate, then read by the gateway-side route.

    The other stage tests hand-write the file. This one lets the plugin write it (a recorded
    terminal run, evidence, an in-session gate evaluation) so the writer's path and shape
    are proven to be the ones the route reads.
    """

    SESSION = "s1"

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name).resolve() / "home"
        self.ws = self.home / "project"
        self.ws.mkdir(parents=True)
        self._prev = os.getcwd()
        os.chdir(self.ws)
        patcher = mock.patch.object(plugin_api, "_home_root", return_value=self.home)
        patcher.start()
        self.addCleanup(self._cleanup)
        self.addCleanup(patcher.stop)
        self.pkg = _load_plugin_package()
        self.session_runtime = import_module("lithermes_plugin_pkg.litgoal.runtime")
        self.tools = import_module("lithermes_plugin_pkg.litgoal.tools")
        self.runs = import_module("lithermes_plugin_pkg.litgoal.runs")
        self.snapshot = import_module("lithermes_plugin_pkg.litgoal.gate_snapshot")
        (self.ws / "export.py").write_text("rows = ['a']\n", encoding="utf-8")
        self.tools.tool_goal_set(
            {"objective": "fix the export", "criteria": [{"scenario": "export keeps every row"}]},
            session_id=self.SESSION,
        )

    def _cleanup(self):
        os.chdir(self._prev)
        self._tmp.cleanup()

    def _terminal(self, command="pytest -q", exit_code=0):
        self.pkg._post_tool_call(
            tool_name="terminal",
            args={"command": command},
            result=json.dumps({"output": "...", "exit_code": exit_code}),
            session_id=self.SESSION,
            task_id="t1",
        )
        return self.runs.recent_runs(self.ws, self.SESSION, limit=500)[-1]["id"]

    def _finish(self, run_id):
        rt = self.session_runtime
        rt.add_evidence(self.ws, "C001", "green", f"run:{run_id}", session_id=self.SESSION)
        rt.add_evidence(self.ws, "C001", "scenario", "qa.txt", session_id=self.SESSION)
        rt.set_criterion_status(self.ws, "C001", "pass", session_id=self.SESSION)

    def _gate(self):
        return self.session_runtime.quality_gate(self.ws, session_id=self.SESSION, persist=True)

    def _by_key(self):
        return {stage["key"]: stage for stage in plugin_api.goal_snapshot(str(self.ws))["stages"]}

    def test_the_writer_and_the_route_share_one_path(self):
        self._gate()
        written = self.snapshot.gate_path(self.ws, self.SESSION)
        self.assertEqual(written, store.state_dir(self.ws, self.SESSION) / "gate.json")
        self.assertTrue(written.is_file())

    def test_a_passing_run_shows_as_a_tick_and_the_gate_as_open(self):
        run_id = self._terminal()
        self._finish(run_id)
        self.assertTrue(self._gate()["passed"])
        snapshot = plugin_api.goal_snapshot(str(self.ws))
        by_key = {stage["key"]: stage for stage in snapshot["stages"]}
        self.assertEqual(snapshot["gate"]["source"], "session")
        self.assertTrue(snapshot["gate"]["open"])
        self.assertEqual(by_key["runs"]["detail"], f"{run_id} \u2713")
        self.assertEqual(by_key["gate"]["detail"], "OPEN")
        self.assertEqual(by_key["review"]["detail"], "no blockers")

    def test_a_run_made_stale_by_a_later_edit_shows_stale_and_the_gate_closed(self):
        run_id = self._terminal()
        self._finish(run_id)
        time.sleep(0.01)
        (self.ws / "export.py").write_text("rows = ['a', 'b']\n", encoding="utf-8")
        self.session_runtime.add_review_blocker(self.ws, "reviewer wants a retry", session_id=self.SESSION)
        self.assertFalse(self._gate()["passed"])
        snapshot = plugin_api.goal_snapshot(str(self.ws))
        by_key = {stage["key"]: stage for stage in snapshot["stages"]}
        self.assertEqual(snapshot["gate"]["source"], "session")
        self.assertFalse(snapshot["gate"]["open"])
        self.assertEqual(by_key["runs"]["detail"], f"{run_id} \u26a0 stale")
        self.assertEqual(by_key["runs"]["tone"], "warn")
        self.assertEqual(by_key["review"]["detail"], "1 blocker: reviewer wants a retry")
        self.assertTrue(by_key["gate"]["detail"].startswith("CLOSED"))

    def test_a_status_change_alone_refreshes_the_snapshot_the_route_reads(self):
        run_id = self._terminal()
        rt = self.session_runtime
        rt.add_evidence(self.ws, "C001", "green", f"run:{run_id}", session_id=self.SESSION)
        rt.add_evidence(self.ws, "C001", "scenario", "qa.txt", session_id=self.SESSION)
        self.assertFalse(plugin_api.goal_snapshot(str(self.ws))["gate"]["open"])
        rt.set_criterion_status(self.ws, "C001", "pass", session_id=self.SESSION)
        self.assertTrue(plugin_api.goal_snapshot(str(self.ws))["gate"]["open"])

    def test_a_review_blocker_alone_refreshes_the_snapshot_the_route_reads(self):
        run_id = self._terminal()
        self._finish(run_id)
        self.assertTrue(plugin_api.goal_snapshot(str(self.ws))["gate"]["open"])
        blocker = self.session_runtime.add_review_blocker(self.ws, "needs a retry", session_id=self.SESSION)
        self.assertEqual(self._by_key()["review"]["detail"], "1 blocker: needs a retry")
        self.session_runtime.resolve_review_blocker(self.ws, blocker.id, session_id=self.SESSION)
        self.assertEqual(self._by_key()["review"]["detail"], "no blockers")

    def test_without_a_snapshot_file_the_route_falls_back_to_the_live_reading(self):
        self.snapshot.gate_path(self.ws, self.SESSION).unlink()
        snapshot = plugin_api.goal_snapshot(str(self.ws))
        self.assertNotIn("source", snapshot["gate"])


if __name__ == "__main__":
    unittest.main()
