"""W1-T3/T4/T5: litgoal model-facing tools, CLI surface, and snapshot hook."""

import json
import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

_HERE = os.path.dirname(os.path.abspath(__file__))
_ASSET_DIR = os.path.normpath(os.path.join(_HERE, "..", "..", "assets", "lithermes-plugin"))
if _ASSET_DIR not in sys.path:
    sys.path.insert(0, _ASSET_DIR)

from litgoal import cli, hook, runtime, store, tools  # noqa: E402


def _seed_032_state(workspace, *, status="active", resolved=False):
    payload = {
        "version": 1,
        "created_at": "2026-07-24T00:00:00+00:00",
        "updated_at": "2026-07-24T00:00:00+00:00",
        "active_goal_id": "G001",
        "goals": [{
            "id": "G001",
            "objective": "legacy review",
            "title": "legacy",
            "status": status,
            "criteria": [],
            "checkpoints": [],
            "steering": [],
            "review_blockers": [{
                "id": "B001",
                "detail": "legacy open finding",
                "resolved": resolved,
            }],
        }],
    }
    path = store.goals_path(Path(workspace))
    path.parent.mkdir(parents=True, exist_ok=True)
    original = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    path.write_text(original, encoding="utf-8")
    return path, original


class _FakeCtx:
    def __init__(self):
        self.tools = []

    def register_tool(self, name, toolset, schema, handler, description="", **kw):
        self.tools.append({"name": name, "toolset": toolset, "schema": schema, "handler": handler, "description": description})


class HermesCallingConvention(unittest.TestCase):
    """Hermes invokes a registered tool as handler(args, **kwargs) where kwargs
    carries session_id and task_id (tools/registry.py: entry.handler(args,
    **kwargs)). Every handler must therefore accept **kwargs or the live
    model-facing call throws TypeError on host context fields."""

    def test_all_tool_handlers_accept_var_keyword(self):
        import inspect
        for spec in tools.TOOL_SPECS:
            sig = inspect.signature(spec["handler"])
            has_var_kw = any(p.kind == p.VAR_KEYWORD for p in sig.parameters.values())
            self.assertTrue(has_var_kw, f"{spec['name']} handler must accept **kwargs")

    def test_handlers_do_not_raise_with_task_id(self):
        import os
        import tempfile
        prev = os.getcwd()
        with tempfile.TemporaryDirectory() as tmp:
            os.chdir(tmp)
            try:
                # Mimic Hermes registry.dispatch: handler(args, task_id=..., session_id=...).
                tools.tool_goal_status({}, task_id="task-123", session_id="s")
                tools.tool_goal_set({"objective": "x"}, task_id="task-123")
                tools.tool_goal_complete({}, task_id="task-123")
            finally:
                os.chdir(prev)


class ToolRegistration(unittest.TestCase):
    def test_register_tools_registers_full_goal_surface(self):
        ctx = _FakeCtx()
        names = tools.register_tools(ctx)
        for required in ["goal_status", "goal_set", "goal_add_criterion", "goal_evidence",
                         "goal_criterion_status", "goal_steer", "goal_checkpoint", "goal_complete"]:
            self.assertIn(required, names)
        # every tool carries a JSON-schema object
        for spec in ctx.tools:
            self.assertEqual(spec["schema"]["type"], "object")
            self.assertEqual(spec["toolset"], "lithermes-goal")

    def test_tool_descriptions_expose_contract_evidence_vocabulary(self):
        ctx = _FakeCtx()
        tools.register_tools(ctx)
        joined = "\n".join(spec["description"] for spec in ctx.tools)
        for required in ("lithermes_llm_contract/v1", "#contract.evidence", "#contract.hard_stops"):
            self.assertIn(required, joined)


class ToolHandlers(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._prev = os.getcwd()
        os.chdir(self._tmp.name)

    def tearDown(self):
        os.chdir(self._prev)
        self._tmp.cleanup()

    def test_set_then_status_then_gated_complete(self):
        tools.tool_goal_set({"objective": "ship it", "criteria": [{"scenario": "happy", "qa_channel": "tmux", "test_ref": "t::x"}]})
        snap = json.loads(tools.tool_goal_status())
        self.assertEqual(snap["active_goal"]["objective"], "ship it")
        cid = snap["active_goal"]["criteria"][0]["id"]

        refused = json.loads(tools.tool_goal_complete())
        self.assertFalse(refused["completed"])

        tools.tool_goal_evidence({"criterion_id": cid, "kind": "green", "ref": "t::x", "detail": "GREEN"})
        tools.tool_goal_evidence({"criterion_id": cid, "kind": "scenario", "ref": "evidence/qa.txt"})
        tools.tool_goal_criterion_status({"criterion_id": cid, "status": "pass"})
        done = json.loads(tools.tool_goal_complete())
        self.assertTrue(done["completed"], done)

    def test_status_reports_user_managed_unobserved_native_capability(self):
        snap = json.loads(tools.tool_goal_status())
        receipt = snap["native_goal_capability"]
        self.assertEqual(receipt["mode"], "user_managed")
        self.assertEqual(receipt["state"], "unobserved")
        self.assertIn("cache-coherent host controller/post-judge API", receipt["reason"])
        self.assertIn("no automatic update, clear, or resume", receipt["reason"])

    def test_handlers_scope_state_by_host_session_id(self):
        tools.tool_goal_set({"objective": "alpha"}, session_id="session-a")
        tools.tool_goal_set({"objective": "beta"}, session_id="session-b")

        alpha = json.loads(tools.tool_goal_status({}, session_id="session-a"))
        beta = json.loads(tools.tool_goal_status({}, session_id="session-b"))

        self.assertEqual(alpha["active_goal"]["objective"], "alpha")
        self.assertEqual(beta["active_goal"]["objective"], "beta")
        self.assertTrue(store.goals_path(Path.cwd(), "session-a").exists())
        self.assertTrue(store.goals_path(Path.cwd(), "session-b").exists())
        self.assertFalse(store.goals_path(Path.cwd()).exists())

    def test_handlers_fall_back_to_the_host_task_id(self):
        tools.tool_goal_set({"objective": "alpha"}, task_id="task-a")
        tools.tool_goal_set({"objective": "beta"}, task_id="task-b")

        alpha = json.loads(tools.tool_goal_status({}, task_id="task-a"))
        beta = json.loads(tools.tool_goal_status({}, task_id="task-b"))

        self.assertEqual(alpha["active_goal"]["objective"], "alpha")
        self.assertEqual(beta["active_goal"]["objective"], "beta")

    def test_status_reports_only_current_attempt_evidence_as_gate_evidence(self):
        tools.tool_goal_set({"objective": "retry", "criteria": [{"scenario": "s"}]})
        tools.tool_goal_evidence({"criterion_id": "C001", "kind": "green", "ref": "old-green"})
        tools.tool_goal_evidence({"criterion_id": "C001", "kind": "scenario", "ref": "old-scenario"})
        tools.tool_goal_criterion_status({"criterion_id": "C001", "status": "fail"})
        tools.tool_goal_criterion_status({"criterion_id": "C001", "status": "in_progress"})

        criterion = json.loads(tools.tool_goal_status())["active_goal"]["criteria"][0]
        self.assertEqual(criterion["attempt"], 2)
        self.assertEqual(criterion["evidence_kinds"], [])

    def test_status_set_tool_cannot_force_active_while_a_review_blocker_is_open(self):
        tools.tool_goal_set({"objective": "review me"})
        runtime.add_review_blocker(Path.cwd(), "review finding")

        result = json.loads(tools.tool_goal_status_set({"status": "active"}))

        self.assertEqual(result["active_goal"]["status"], "review_blocked")
        self.assertEqual(result["active_goal"]["unresolved_blockers"], ["B001"])

    def test_tool_status_and_gate_derive_legacy_open_blocker_without_rewriting_state(self):
        path, original = _seed_032_state(Path.cwd())

        result = json.loads(tools.tool_goal_status())

        self.assertEqual(result["active_goal"]["status"], "review_blocked")
        self.assertEqual(result["quality_gate"]["status"], "review_blocked")
        self.assertFalse(result["quality_gate"]["passed"])
        self.assertEqual(path.read_text(encoding="utf-8"), original)

    def test_tool_status_preserves_explicit_legacy_blocked_without_rewriting_state(self):
        path, original = _seed_032_state(Path.cwd(), status="blocked")

        result = json.loads(tools.tool_goal_status())

        self.assertEqual(result["active_goal"]["status"], "blocked")
        self.assertEqual(result["quality_gate"]["status"], "blocked")
        self.assertEqual(path.read_text(encoding="utf-8"), original)


class SnapshotHook(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._prev = os.getcwd()
        os.chdir(self._tmp.name)

    def tearDown(self):
        os.chdir(self._prev)
        self._tmp.cleanup()

    def test_snapshot_none_without_goal_then_present(self):
        self.assertIsNone(hook.snapshot_context(user_message="hi"))
        tools.tool_goal_set({"objective": "do x", "criteria": [{"scenario": "s", "qa_channel": "cli"}]})
        ctx = hook.snapshot_context(user_message="hi")
        self.assertIsNotNone(ctx)
        self.assertIn("Active goal", ctx)
        self.assertIn("CLOSED", ctx)
        self.assertIn("lithermes_llm_contract/v1", ctx)
        self.assertIn("#contract.evidence", ctx)

    def test_snapshot_reads_only_the_host_session_state(self):
        tools.tool_goal_set({"objective": "alpha", "criteria": [{"scenario": "a"}]}, session_id="session-a")
        tools.tool_goal_set({"objective": "beta", "criteria": [{"scenario": "b"}]}, session_id="session-b")

        alpha = hook.snapshot_context(user_message="hi", session_id="session-a")
        beta = hook.snapshot_context(user_message="hi", session_id="session-b")

        self.assertIn("alpha", alpha)
        self.assertNotIn("beta", alpha)
        self.assertIn("beta", beta)
        self.assertNotIn("alpha", beta)

    def test_host_session_does_not_fall_back_to_legacy_state(self):
        runtime.create_goal(Path.cwd(), "legacy-only")

        self.assertIsNone(hook.snapshot_context(user_message="hi", session_id="new-session"))
        self.assertIn("legacy-only", hook.snapshot_context(user_message="hi"))

    def test_snapshot_marks_prior_attempt_evidence_as_missing(self):
        runtime.create_goal(Path.cwd(), "retry", criteria=[{"scenario": "s"}])
        runtime.add_evidence(Path.cwd(), "C001", "green", "old-green")
        runtime.add_evidence(Path.cwd(), "C001", "scenario", "old-scenario")
        runtime.set_criterion_status(Path.cwd(), "C001", "fail")
        runtime.set_criterion_status(Path.cwd(), "C001", "in_progress")
        runtime.set_criterion_status(Path.cwd(), "C001", "pass")

        ctx = hook.snapshot_context(user_message="hi")

        self.assertIn("attempt 2", ctx)
        self.assertIn("missing: green, scenario", ctx)


class CliSurface(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.ws = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def test_cli_set_status_complete_flow(self):
        self.assertEqual(cli.main(["--workspace", self.ws, "set", "--objective", "cli goal",
                                    "--criterion", "happy|cli|t::x"]), 0)
        self.assertEqual(cli.main(["--workspace", self.ws, "status"]), 0)
        # complete is refused (exit 1) until proven
        self.assertEqual(cli.main(["--workspace", self.ws, "complete"]), 1)
        cli.main(["--workspace", self.ws, "evidence", "C001", "--kind", "green", "--ref", "t::x"])
        cli.main(["--workspace", self.ws, "evidence", "C001", "--kind", "scenario", "--ref", "a.txt"])
        cli.main(["--workspace", self.ws, "criterion-status", "C001", "pass"])
        self.assertEqual(cli.main(["--workspace", self.ws, "complete"]), 0)

    def test_cli_status_prints_native_capability_receipt_without_active_goal(self):
        output = io.StringIO()
        with redirect_stdout(output):
            result = cli.main(["--workspace", self.ws, "status"])

        self.assertEqual(result, 0)
        rendered = output.getvalue()
        self.assertIn("native goal capability: mode=user_managed state=unobserved", rendered)
        self.assertIn("cache-coherent host controller/post-judge API", rendered)
        self.assertIn("no automatic update, clear, or resume", rendered)
        self.assertIn("no active litgoal", rendered)

    def test_cli_resolving_the_last_review_blocker_returns_to_active(self):
        with redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main(["--workspace", self.ws, "set", "--objective", "cli goal"]), 0)
            self.assertEqual(cli.main(["--workspace", self.ws, "blocker", "review finding"]), 0)
            self.assertEqual(cli.main(["--workspace", self.ws, "resolve-blocker", "B001"]), 0)
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(cli.main(["--workspace", self.ws, "status"]), 0)

        rendered = output.getvalue()
        self.assertIn("goal G001 [active]: cli goal", rendered)
        self.assertIn("blocker B001 [resolved] review finding", rendered)

    def test_cli_resolving_a_review_blocker_preserves_manual_blocked_status(self):
        with redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main(["--workspace", self.ws, "set", "--objective", "cli goal"]), 0)
            self.assertEqual(cli.main(["--workspace", self.ws, "blocker", "review finding"]), 0)
            self.assertEqual(cli.main(["--workspace", self.ws, "goal-status", "blocked"]), 0)
            self.assertEqual(cli.main(["--workspace", self.ws, "resolve-blocker", "B001"]), 0)
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(cli.main(["--workspace", self.ws, "status"]), 0)

        rendered = output.getvalue()
        self.assertIn("goal G001 [blocked]: cli goal", rendered)
        self.assertIn("blocker B001 [resolved] review finding", rendered)

    def test_cli_cannot_force_active_while_a_review_blocker_is_open(self):
        with redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main(["--workspace", self.ws, "set", "--objective", "cli goal"]), 0)
            self.assertEqual(cli.main(["--workspace", self.ws, "blocker", "review finding"]), 0)
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(cli.main(["--workspace", self.ws, "goal-status", "active"]), 0)

        rendered = output.getvalue()
        self.assertIn("goal G001 [review_blocked]: cli goal", rendered)
        self.assertIn("blocker B001 [OPEN] review finding", rendered)

    def test_cli_status_derives_legacy_open_blocker_without_rewriting_state(self):
        path, original = _seed_032_state(self.ws)
        output = io.StringIO()

        with redirect_stdout(output):
            self.assertEqual(cli.main(["--workspace", self.ws, "status"]), 0)

        self.assertIn("goal G001 [review_blocked]: legacy review", output.getvalue())
        self.assertIn("quality gate: CLOSED", output.getvalue())
        self.assertEqual(path.read_text(encoding="utf-8"), original)

    def test_cli_resolves_a_legacy_open_blocker_back_to_active(self):
        path, _ = _seed_032_state(self.ws)
        output = io.StringIO()

        with redirect_stdout(output):
            self.assertEqual(
                cli.main(["--workspace", self.ws, "resolve-blocker", "B001"]), 0
            )

        persisted = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(persisted["goals"][0]["status"], "active")
        self.assertIs(persisted["goals"][0]["review_blockers"][0]["resolved"], True)
        self.assertIn("goal G001 [active]: legacy review", output.getvalue())


if __name__ == "__main__":
    unittest.main()
