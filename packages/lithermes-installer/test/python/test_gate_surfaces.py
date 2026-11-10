"""Round-2 gate surfaces: the slash HUD card, keyed gate toasts, and the receipts the pane shows."""

from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

try:
    from .plugin_register_test_support import _ASSET_DIR, _FakeCtx, _load_plugin_package
except ImportError:
    from plugin_register_test_support import _ASSET_DIR, _FakeCtx, _load_plugin_package

ESC = "\x1b"
_ANSI = re.compile(r"\x1b\[[0-9;]*m")
COLOUR_ENV = {"COLORTERM": "truecolor", "LANG": "en_US.UTF-8", "TERM": "xterm-256color"}


def _api():
    spec = importlib.util.spec_from_file_location(
        "lithermes_round2_plugin_api", os.path.join(_ASSET_DIR, "dashboard", "plugin_api.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Handle:
    def __init__(self, sink, text, ok=True):
        self.sink, self.ok, self.texts = sink, ok, [text]

    def edit(self, text):
        self.texts.append(text)
        self.sink.edits.append(text)
        return {"ok": self.ok, "message_id": "m1", "edited": True}


class _SurfaceCtx(_FakeCtx):
    def __init__(self, surface="tui", cwd=""):
        super().__init__()
        self.surface, self.cwd = surface, cwd
        self.posts, self.edits, self.handles = [], [], []

    def session_surface(self):
        return self.surface

    def session_cwd(self):
        return self.cwd

    def post_message(self, text):
        self.posts.append(text)
        handle = _Handle(self, text)
        self.handles.append(handle)
        return handle


def _snapshot(**overrides):
    base = {
        "goal": {"id": "G001", "title": "Fix the quarterly export so totals match", "objective": "x", "status": "active"},
        "criteria": [
            {"id": "C001", "text": "rows kept", "status": "pass"},
            {"id": "C002", "text": "totals match", "status": "pass"},
            {"id": "C003", "text": "pdf renders", "status": "pending"},
        ],
        "evidence": [],
        "gate": {
            "open": False,
            "reasons": ["C002 evidence R007 is stale: report/export.py changed after the run (re-run the tests)"],
            "source": "session",
        },
        "stages": [],
        "receipts": [
            {"id": "R007", "exit": 0, "command": "pytest -q", "at": "2026-11-10T05:00:00+00:00", "stale": True,
             "cited_by": ["C002"], "stale_reason": "report/export.py changed after the run"},
            {"id": "R006", "exit": 1, "command": "pytest -q", "at": "2026-11-10T04:58:00+00:00", "stale": False,
             "cited_by": []},
            {"id": "R004", "exit": 0, "command": "pytest -q", "at": "2026-11-10T04:50:00+00:00", "stale": False,
             "cited_by": ["C001"]},
        ],
    }
    base.update(overrides)
    return base


class HudCard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.card = cls.pkg.hud_card

    def test_colour_follows_the_surface_not_a_tty(self):
        with mock.patch.object(sys.stdout, "isatty", return_value=False):
            # Hermes 0.23 names a slash command from any local app "local" (it runs in the gateway).
            for surface in ("cli", "tui", "local"):
                self.assertIn(ESC, self.card.render(_snapshot(), "litwork", surface, COLOUR_ENV), surface)
        for surface in ("desktop", "telegram", ""):
            self.assertNotIn(ESC, self.card.render(_snapshot(), "litwork", surface, COLOUR_ENV), surface)
        self.assertNotIn(ESC, self.card.render(_snapshot(), "litwork", "tui", {**COLOUR_ENV, "NO_COLOR": "1"}))
        self.assertIn("\x1b[38;5;", self.card.render(_snapshot(), "litwork", "cli", {"LANG": "en_US.UTF-8"}))

    def test_card_names_goal_proof_runs_gate_and_next_step(self):
        plain = self.card.render(_snapshot(), "litwork", "desktop", COLOUR_ENV)
        self.assertIn("LIT · litwork", plain)
        self.assertIn("gate CLOSED", plain)
        self.assertIn("2/3 criteria", plain)
        self.assertIn("R004 ✓", plain)
        self.assertIn("R006 ✗ exit 1", plain)
        self.assertIn("R007 ⚠ stale", plain)
        self.assertIn("next  C002 evidence R007 is stale", plain)
        opened = self.card.render(_snapshot(gate={"open": True, "reasons": []}), "litgoal", "desktop", COLOUR_ENV)
        self.assertIn("gate OPEN ✓", opened)
        first = self.card.render(None, "litwork", "desktop", COLOUR_ENV)
        self.assertIn("no goal yet", first)
        self.assertIn("criteria", first)

    def test_tui_output_stays_under_the_ink_fold(self):
        long = _snapshot(goal={"id": "G1", "title": "t" * 300, "objective": "", "status": "active"})
        card = self.card.render(long, "lit-loop", "tui", COLOUR_ENV)
        fitted = self.card.fit_tui(card, "Started LitHermes Litwork run: " + "/very/long/path" * 30)
        self.assertLessEqual(len(fitted), self.card.TUI_LIMIT)
        self.assertIn(ESC, fitted)
        self.assertIn("Started LitHermes", _ANSI.sub("", fitted))


class SlashSurfaces(unittest.TestCase):
    def setUp(self):
        self.pkg = _load_plugin_package()
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.ws = Path(self._tmp.name).resolve() / "project"
        self.ws.mkdir()
        env = mock.patch.dict(os.environ, COLOUR_ENV)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("NO_COLOR", None)
        os.environ.pop("CI", None)

    def _display(self, ctx, name, args):
        self.pkg.register(ctx)
        result = ctx.command_handlers[name](args + f" --worktree {self.ws}")
        return result.get("display") if isinstance(result, dict) else str(result)

    def test_tui_lit_shows_a_coloured_card_under_400_chars(self):
        with mock.patch.object(sys.stdout, "isatty", return_value=False):
            display = self._display(_SurfaceCtx("tui", str(self.ws)), "lit", '"fix the export"')
        self.assertLessEqual(len(display), 400, display)
        self.assertIn(ESC, display)
        plain = _ANSI.sub("", display)
        self.assertIn("LIT · litwork", plain)
        self.assertIn("no goal yet", plain)

    def test_desktop_card_is_plain_and_cli_card_coloured(self):
        desktop = self._display(_SurfaceCtx("desktop", str(self.ws)), "lit", '"fix the export"')
        self.assertNotIn(ESC, desktop)
        self.assertIn("LIT IGNITED · litwork", desktop)
        self.assertIn("no goal yet", desktop)
        with mock.patch.object(sys.stdout, "isatty", return_value=False):
            cli = self._display(_SurfaceCtx("cli", str(self.ws)), "lit", '"fix the export"')
        self.assertIn(ESC, cli)
        self.assertIn("no goal yet", _ANSI.sub("", cli))

    def test_local_slash_output_is_coloured_on_a_0_23_gateway(self):
        with mock.patch.object(sys.stdout, "isatty", return_value=False):
            display = self._display(_SurfaceCtx("local", str(self.ws)), "lit", '"fix the export"')
        self.assertIn(ESC, display)
        card = "\n".join(display.splitlines()[-4:])
        self.assertIn("\x1b[38;5;", card)
        self.assertNotIn("\x1b[38;2;", card, "the card uses the lean 256-colour spans")
        self.assertIn("no goal yet", _ANSI.sub("", display))

    def test_card_reads_the_goal_in_the_session_workspace(self):
        from litgoal import runtime

        runtime.create_goal(
            self.ws, "fix it", title="Export totals",
            criteria=[{"scenario": "totals match", "qa_channel": "tmux", "test_ref": "t"}], session_id="s1",
        )
        runtime.refresh_gate(self.ws, "s1")
        display = self._display(_SurfaceCtx("desktop", str(self.ws)), "litgoal", "")
        self.assertIn("goal  Export totals", display)
        self.assertIn("gate CLOSED", display)
        self.assertIn("0/1 criteria", display)

    def test_older_host_without_session_surface_keeps_the_previous_output(self):
        ctx = _FakeCtx()
        display = self._display(ctx, "lit", '"fix the export"')
        self.assertNotIn("no goal yet", display)
        self.assertTrue(_ANSI.sub("", display).splitlines()[0].startswith("▗▖"))

    def test_replies_never_carry_escapes_on_any_surface(self):
        with mock.patch.object(sys.stdout, "isatty", return_value=True):
            reply = self.pkg.lit_mark.acknowledge_reply("litwork", "done here", workflow="map")
            ignited = self.pkg.core.ignite({"display": "x", "agent_message": "y"}, "litwork", surface="tui", card="c")
        self.assertNotIn(ESC, reply)
        self.assertNotIn(ESC, ignited["agent_message"])


def _write_gate(ws: Path, session: str, **report):
    from litgoal import store

    payload = {"open": False, "reasons": [], "evaluated_at": "2026-11-10T05:00:00+00:00", "runs": [], "blockers": []}
    payload.update(report)
    path = store.state_dir(ws, session) / "gate.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


class GateToasts(unittest.TestCase):
    def setUp(self):
        self.pkg = _load_plugin_package()
        self.toasts = self.pkg.gate_toasts
        self.toasts.reset()
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.addCleanup(self.toasts.bind, None)
        self.ws = Path(self._tmp.name).resolve() / "project"
        self.ws.mkdir()
        from litgoal import runtime

        runtime.create_goal(
            self.ws, "fix it", title="Export totals",
            criteria=[{"scenario": "totals match", "qa_channel": "tmux", "test_ref": "t"}], session_id="s1",
        )
        self.ctx = _SurfaceCtx("tui")
        self.toasts.bind(self.ctx)

    def test_one_toast_per_goal_edited_in_place_on_each_real_change(self):
        _write_gate(self.ws, "s1", reasons=["C001 status is 'pending' (need 'pass')"])
        first = self.toasts.observe(self.ws, "s1")
        self.assertIn("lit gate CLOSED · Export totals", first)
        self.assertIsNone(self.toasts.observe(self.ws, "s1"), "no change, no toast")
        _write_gate(self.ws, "s1", open=True)
        self.assertIn("lit gate OPEN", self.toasts.observe(self.ws, "s1"))
        _write_gate(self.ws, "s1", reasons=["C001 evidence R004 is stale: app.py changed after the run (re-run the tests)"])
        stale = self.toasts.observe(self.ws, "s1")
        self.assertIn("R004 is stale: app.py changed", stale)
        _write_gate(self.ws, "s1", reasons=["unresolved review blocker B001: test_totals removed"],
                    blockers=[{"source": "testguard", "text": "test_totals removed", "resolved": False}])
        guard = self.toasts.observe(self.ws, "s1")
        self.assertIn("a test was weakened · test_totals removed", guard)
        self.assertEqual(len(self.ctx.posts), 1, "edits replace the goal's toast instead of stacking")
        self.assertEqual(self.ctx.handles[0].texts, [first, self.ctx.edits[0], stale, guard])
        for text in self.ctx.handles[0].texts:
            self.assertNotIn(ESC, text)

    def test_toasts_fail_open(self):
        _write_gate(self.ws, "s1", reasons=["x"])

        class Broken(_SurfaceCtx):
            def post_message(self, text):
                raise RuntimeError("host exploded")

        self.toasts.bind(Broken("tui"))
        self.assertIsNone(self.toasts.observe(self.ws, "s1"))
        self.toasts.reset()

        class Refused(_SurfaceCtx):
            def post_message(self, text):
                self.posts.append(text)
                return _Handle(self, text, ok=False)

        refused = Refused("cli")
        self.toasts.bind(refused)
        self.assertIsNone(self.toasts.observe(self.ws, "s1"))
        self.toasts.bind(object())
        self.assertIsNone(self.toasts.observe(self.ws, "s1"))
        self.assertIsNone(self.toasts.observe(None, "s1"))
        with mock.patch.object(self.toasts.runtime, "get_active", side_effect=ValueError("corrupt")):
            self.toasts.bind(self.ctx)
            self.assertIsNone(self.toasts.observe(self.ws, "s1"))

    def test_every_surface_gets_the_one_hook_toast_and_goal_less_sessions_none(self):
        # The Desktop pane raises no notification of its own, so Desktop takes this one too.
        _write_gate(self.ws, "s1", reasons=["x"])
        for surface in ("desktop", "local"):
            self.toasts.reset()
            ctx = _SurfaceCtx(surface)
            self.toasts.bind(ctx)
            self.assertIsNotNone(self.toasts.observe(self.ws, "s1"), surface)
            self.assertEqual(len(ctx.posts), 1, surface)
        self.toasts.bind(self.ctx)
        self.assertIsNone(self.toasts.observe(self.ws, "other-session"))

    def test_post_tool_call_toasts_after_a_file_edit_makes_a_run_stale(self):
        ctx = _SurfaceCtx("tui", str(self.ws))
        self.pkg.register(ctx)
        self.toasts.reset()
        with mock.patch.object(self.pkg, "_session_workspace", return_value=self.ws), \
                mock.patch.object(self.pkg.gate_toasts.runtime, "refresh_gate") as refresh:
            _write_gate(self.ws, "s1", reasons=["C001 status is 'pending' (need 'pass')"])
            self.pkg._post_tool_call(
                tool_name="write_file", args={"path": str(self.ws / "app.py"), "content": "x"},
                result="{}", session_id="s1", status="ok",
            )
        refresh.assert_called_once_with(self.ws, "s1")
        self.assertEqual(len(ctx.posts), 1)
        self.assertIn("lit gate CLOSED", ctx.posts[0])


class Receipts(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.ws = Path(self._tmp.name).resolve() / "project"
        self.ws.mkdir()
        from litgoal import runtime

        runtime.create_goal(
            self.ws, "fix it", title="Export totals",
            criteria=[{"scenario": "totals match", "qa_channel": "tmux", "test_ref": "t"}], session_id="s1",
        )

    def test_route_lists_signed_runs_newest_first_with_age_citation_and_stale_reason(self):
        from litgoal import runtime

        runtime.add_evidence(self.ws, "C001", "green", "run:R002", "pass", session_id="s1")
        _write_gate(
            self.ws, "s1",
            reasons=["C001 evidence R002 is stale: app.py changed after the run (re-run the tests)"],
            runs=[
                {"id": "R001", "exit": 1, "preview": "pytest -q", "at": "2026-11-10T04:00:00+00:00", "stale": False},
                {"id": "R002", "exit": 0, "preview": "pytest -q", "at": "2026-11-10T04:05:00+00:00", "stale": True,
                 "changed": ["app.py", "b.py", "c.py", "d.py"]},
            ],
        )
        snapshot = _api().workspace_snapshot(self.ws)
        receipts = snapshot["receipts"]
        self.assertEqual([r["id"] for r in receipts], ["R002", "R001"])
        self.assertEqual(receipts[0]["cited_by"], ["C001"])
        self.assertEqual(receipts[0]["at"], "2026-11-10T04:05:00+00:00")
        self.assertEqual(receipts[0]["stale_reason"], "app.py, b.py, c.py and 1 more changed after the run")
        self.assertEqual(receipts[1]["exit"], 1)
        self.assertNotIn("stale_reason", receipts[1])

    def test_previews_and_reasons_hide_the_home_folder_and_the_plugin_path(self):
        # Run notes cap a preview at 100 characters, so a short home keeps the whole command.
        env = mock.patch.dict(os.environ, {"HOME": "/Users/me"})
        env.start()
        self.addCleanup(env.stop)
        home = "/Users/me"
        plugin = home + "/.hermes/profiles/litdemo/plugins/lithermes"
        _write_gate(
            self.ws, "s1",
            reasons=[f"C001 evidence R002 is stale: {home}/proj/app.py changed after the run (re-run the tests)"],
            runs=[{"id": "R002", "exit": 0, "preview": f'node "{plugin}/skills/lit-pptx/bin/office.mjs" qa ha',
                   "at": "2026-11-10T04:05:00+00:00", "stale": True, "changed": [f"{home}/proj/app.py"]}],
        )
        snapshot = _api().workspace_snapshot(self.ws)
        text = json.dumps(snapshot)
        self.assertNotIn(home, text)
        self.assertEqual(snapshot["receipts"][0]["command"], 'node "<lithermes>/skills/lit-pptx/bin/office.mjs" qa ha')
        self.assertIn("~/proj/app.py changed after the run", snapshot["gate"]["reasons"][0])
        self.assertEqual(snapshot["receipts"][0]["stale_reason"], "~/proj/app.py changed after the run")

    def test_cited_by_names_each_criterion_once_in_order(self):
        from litgoal import runtime

        runtime.add_criterion(self.ws, "rows kept", qa_channel="tmux", test_ref="t", session_id="s1")
        for criterion in ("C002", "C001", "C002", "C001"):
            runtime.add_evidence(self.ws, criterion, "green", "run:R002", "pass", session_id="s1")
        _write_gate(self.ws, "s1", runs=[{"id": "R002", "exit": 0, "preview": "pytest", "at": "", "stale": False}])
        self.assertEqual(_api().workspace_snapshot(self.ws)["receipts"][0]["cited_by"], ["C001", "C002"])

    def test_runs_stage_warns_only_for_runs_the_gate_names_as_stale(self):
        from litgoal import runtime

        runtime.add_evidence(self.ws, "C001", "green", "run:R002", "pass", session_id="s1")
        runs = [
            {"id": "R001", "exit": 0, "preview": "pytest -q", "at": "2026-11-10T04:00:00+00:00", "stale": True},
            {"id": "R002", "exit": 0, "preview": "pytest -q", "at": "2026-11-10T04:05:00+00:00", "stale": True},
            {"id": "R003", "exit": 0, "preview": "pytest -q", "at": "2026-11-10T04:09:00+00:00", "stale": False},
        ]
        # Gate open: no run is named, so none warns and Runs is done.
        _write_gate(self.ws, "s1", open=True, reasons=[], runs=runs)
        runs_stage = next(s for s in _api().workspace_snapshot(self.ws)["stages"] if s["key"] == "runs")
        self.assertEqual([i["text"] for i in runs_stage["items"]], ["R001 superseded", "R002 superseded", "R003 ✓"])
        self.assertNotIn("⚠", runs_stage["detail"])
        self.assertEqual(runs_stage["tone"], "")
        self.assertEqual(runs_stage["state"], "done")
        # Gate closed on R002: only R002 warns; R001 stays superseded.
        _write_gate(self.ws, "s1", reasons=["C001 evidence R002 is stale: app.py changed after the run (re-run the tests)"], runs=runs)
        runs_stage = next(s for s in _api().workspace_snapshot(self.ws)["stages"] if s["key"] == "runs")
        self.assertEqual([i["text"] for i in runs_stage["items"]], ["R001 superseded", "R002 ⚠ stale", "R003 ✓"])
        self.assertEqual([i["tone"] for i in runs_stage["items"]], ["", "warn", ""])
        self.assertEqual(runs_stage["tone"], "warn")

    def test_hud_card_marks_an_unnamed_stale_run_superseded(self):
        card = _load_plugin_package().hud_card
        opened = _snapshot(gate={"open": True, "reasons": []})
        plain = card.render(opened, "litgoal", "desktop", COLOUR_ENV)
        self.assertIn("R007 superseded", plain)
        self.assertNotIn("⚠", plain)
        self.assertIn("R007 ⚠ stale", card.render(_snapshot(), "litgoal", "desktop", COLOUR_ENV))

    def test_gate_json_records_when_each_run_ran_and_what_moved(self):
        from litgoal import gate_snapshot, runtime

        runtime.refresh_gate(self.ws, "s1")
        data = json.loads(gate_snapshot.gate_path(self.ws, "s1").read_text(encoding="utf-8"))
        self.assertEqual(data["runs"], [])
        record = {"id": "R001", "exit_code": 0, "cmd_preview": "pytest", "at": "2026-11-10T04:00:00+00:00", "fp": None}

        class Now:
            def get(self):
                return {"kind": "plain", "digest": "x"}

        entry = gate_snapshot._run_entry(record, Now())
        self.assertEqual((entry["at"], entry["stale"], entry["changed"]), ("2026-11-10T04:00:00+00:00", True, []))


if __name__ == "__main__":
    unittest.main()
