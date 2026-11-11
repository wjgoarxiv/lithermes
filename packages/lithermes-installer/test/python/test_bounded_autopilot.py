"""Bounded work keeps running: `lit cancel` from any session, protected paths, parked steps."""

from __future__ import annotations

import fcntl
import json
import os
import subprocess
import sys
import tempfile
import time
import unicodedata
import unittest
from pathlib import Path
from unittest import mock

_HERE = os.path.dirname(os.path.abspath(__file__))
_ASSET_DIR = os.path.normpath(os.path.join(_HERE, "..", "..", "assets", "lithermes-plugin"))
if _ASSET_DIR not in sys.path:
    sys.path.insert(0, _ASSET_DIR)

try:
    from .plugin_register_test_support import _FakeCtx, _load_plugin_package
except ImportError:
    from plugin_register_test_support import _FakeCtx, _load_plugin_package


def _plan(workspace: Path, *, complete: bool = False) -> Path:
    plans = workspace / "plans"
    plans.mkdir(parents=True, exist_ok=True)
    mark = "x" if complete else " "
    path = plans / "approved.md"
    path.write_text(
        "\n".join(
            [
                "# Approved bounded work",
                "",
                "## Todos",
                f"- [{mark}] T001 | write the source",
                f"- [{mark}] T002 | write the docs",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return path


class _AutopilotCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name).resolve()
        self.base = base
        self.home = base / "home"
        self.hermes = base / "hermes-home"
        for folder in (self.home, self.hermes):
            folder.mkdir()
        self.ws = base / "ws"
        self.ws.mkdir()
        (self.ws / "src").mkdir()
        (self.ws / "docs").mkdir()
        self.plan = _plan(self.ws)
        env = mock.patch.dict(os.environ, {"HOME": str(self.home), "HERMES_HOME": str(self.hermes)})
        env.start()
        self.addCleanup(env.stop)
        self.pkg = _load_plugin_package()
        self.ctx = _FakeCtx()
        self.pkg.register(self.ctx)
        self.bw = self.pkg.bounded_work
        self.bw._SESSION_WORKTREES.clear()
        self.bw._PENDING_TOKEN_REPLY.clear()
        self.bw._TOKEN_RESULTS.clear()
        self.bw._PARKED_ROW_SHOWN.clear()

    def tearDown(self):
        self.bw._SESSION_WORKTREES.clear()
        self._tmp.cleanup()

    def _start(self, grants=None, *, session="session-a", ws=None, complete=False):
        ws = ws or self.ws
        plan = _plan(ws, complete=complete)
        created = self.bw.init_bounded_work(
            ws, plan, grants=grants or [{"action": "write", "root": str(ws / "src")}]
        )
        work_id = created["state"]["work_id"]
        self.bw.bind_bounded_work(ws, work_id, created["activation_token"], session_id=session)
        return work_id

    def _state(self, work_id, ws=None):
        return self.bw.load_bounded_work(ws or self.ws, work_id)

    def _raw_state(self, work_id, ws=None):
        path = (ws or self.ws) / ".hermes" / "lithermes" / "work" / work_id / "state.json"
        return json.loads(path.read_text(encoding="utf-8"))

    def _parked_path(self, work_id, ws=None):
        return (ws or self.ws) / ".hermes" / "lithermes" / "work" / work_id / "parked.json"

    def _parked(self, work_id, ws=None):
        path = self._parked_path(work_id, ws)
        if not path.exists():
            return []
        return json.loads(path.read_text(encoding="utf-8"))["entries"]

    def _events(self, work_id, ws=None):
        path = (ws or self.ws) / ".hermes" / "lithermes" / "work" / work_id / "ledger.jsonl"
        return [json.loads(line)["event"] for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

    def _tool(self, tool_name, args, session="session-a"):
        return self.pkg._pre_tool_call(tool_name=tool_name, args=args, session_id=session)

    def _write(self, path, session="session-a"):
        return self._tool("write_file", {"path": str(path), "content": "x"}, session)

    def _prompt(self, message, *, session="session-a", cwd=None, turn="turn-1", platform="cli"):
        return self.pkg._pre_llm_call(
            user_message=message,
            session_id=session,
            turn_id=turn,
            platform=platform,
            workspace=str(cwd or self.ws),
        )

    def _reply(self, session="session-a", text="model reply", turn="turn-1"):
        replaced = self.pkg._transform_llm_output_with_offer(
            session_id=session, response_text=text, turn_id=turn
        )
        return text if replaced is None else replaced

    def _old_paused_state(self, action="execute-test", *, session="s"):
        """A state written before this port: paused at one model-requested boundary."""
        work_id = self._start([{"action": "write", "root": str(self.ws / "src")}], session=session)
        run_dir = self.ws / ".hermes" / "lithermes" / "work" / work_id
        state = self._raw_state(work_id)
        boundary = {
            "id": "b-old",
            "action": action,
            "root": str(self.ws),
            "reason_digest": "",
            "requested_at": "2026-11-01T00:00:00+00:00",
        }
        state["revision"] += 1
        state["status"] = "paused"
        state["boundary"] = boundary
        state["boundary_history"] = [boundary]
        (run_dir / "state.json").write_text(json.dumps(state), encoding="utf-8")
        with (run_dir / "ledger.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {"event": "work_paused", "at": "x", "revision": state["revision"], "state_after": state}
                )
                + "\n"
            )
        return work_id, state["revision"]


class PromptTokens(_AutopilotCase):
    def test_parse_prompt_token_accepts_only_the_whole_prompt(self):
        cases = {
            "lit cancel": "cancel",
            "lit 취소": "cancel",
            "  lit cancel  ": "cancel",
            "lit\tcancel": "cancel",
            unicodedata.normalize("NFD", "lit 취소"): "cancel",
            "lit approve": "approve",
            "lit 승인": "approve",
            "lit deny": "deny",
            "lit 거절": "deny",
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(self.bw.parse_prompt_token(text), expected)
        for text in (
            '"lit cancel"',
            "```\nlit cancel\n```",
            "/lit cancel",
            "please lit cancel now",
            "lit cancel\nmore",
            "lit cancel" + " " * 503,
            "lit approve it",
            "> lit deny",
            "",
        ):
            with self.subTest(refused=text):
                self.assertIsNone(self.bw.parse_prompt_token(text))
        self.assertEqual(len("lit cancel" + " " * 503), 513)


class PromptCancel(_AutopilotCase):
    def test_owner_cancel_is_a_veto_with_the_exact_receipt(self):
        work_id = self._start()
        result = self._prompt("lit cancel")
        self.assertEqual(result["action"], "block")
        self.assertIn(f"LIT: cancelled bounded work {work_id}", result["message"])
        self.assertIn("plans/approved.md", result["message"])
        self.assertIn("lit cancel", result["context"])
        state = self._state(work_id)
        self.assertEqual(state["status"], "cancelled")
        self.assertEqual(state["cancelled_by"], "prompt")
        self.assertEqual(self._events(work_id).count("work_cancelled"), 1)
        self.assertEqual(self._reply(), result["message"])
        self.assertIsNone(self.bw.take_token_reply("session-a"))

    def test_cancel_from_another_session_blocks_the_owner_and_tells_it_once(self):
        work_id = self._start()
        result = self._prompt("lit 취소", session="session-b", turn="b1")
        self.assertIn("Its session is told on its next prompt", result["message"])
        blocked = self._write(self.ws / "src" / "a.py")
        self.assertEqual(blocked["action"], "block")
        self.assertIn("cancelled with lit cancel", blocked["message"])
        self.assertIsNone(self._tool("read_file", {"path": str(self.plan)}))
        note = self._prompt("what next?", turn="a2")
        self.assertIn("from another session", note["context"])
        self.assertTrue(self._raw_state(work_id)["cancel_notice"]["notified"])
        later = self._prompt("and now?", turn="a3")
        self.assertNotIn("from another session", json.dumps(later or {}))
        self.assertIsNone(self._write(self.ws / "src" / "a.py"))

    def test_a_nested_folder_reaches_the_run(self):
        work_id = self._start()
        nested = self.ws / "pkg" / "sub"
        nested.mkdir(parents=True)
        self._prompt("lit cancel", session="other", cwd=nested, turn="n1")
        self.assertEqual(self._state(work_id)["status"], "cancelled")

    def _git(self, *args, cwd):
        subprocess.run(
            ["git", *args],
            cwd=cwd,
            check=True,
            capture_output=True,
            env={**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull},
        )

    def _repo_with_linked_worktree(self):
        self._git("init", "-q", "-b", "main", cwd=self.ws)
        self._git("-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base", cwd=self.ws)
        linked = self.base / "ws-linked"
        self._git("worktree", "add", "-q", str(linked), "-b", "lane", cwd=self.ws)
        return linked.resolve()

    def test_a_linked_worktree_reaches_the_main_checkout_and_back(self):
        linked = self._repo_with_linked_worktree()
        work_id = self._start()
        self._prompt("lit cancel", session="lane", cwd=linked, turn="l1")
        self.assertEqual(self._state(work_id)["status"], "cancelled")

        (linked / "src").mkdir(exist_ok=True)
        lane_work = self._start(ws=linked, session="lane-owner")
        self._prompt("lit cancel", session="main-session", cwd=self.ws, turn="m1")
        self.assertEqual(self._state(lane_work, linked)["status"], "cancelled")

    def test_cancel_works_while_released_or_with_parked_steps_and_drops_the_queue(self):
        parked = self._start()
        self.assertIn("queued", self._write(self.ws / "docs" / "a.md")["message"])
        self.assertTrue(self._parked_path(parked).exists())
        self._prompt("lit cancel", turn="p1")
        self.assertEqual(self._state(parked)["status"], "cancelled")
        self.assertFalse(self._parked_path(parked).exists())

        released = self._start(session="gone")
        self.pkg._release_bounded_session(session_id="gone")
        self.assertEqual(self._state(released)["status"], "paused")
        self._prompt("lit cancel", session="new", turn="r1")
        self.assertEqual(self._state(released)["status"], "cancelled")

    def test_nothing_to_cancel_changes_no_byte(self):
        work_id = self._start()
        state_path = self.ws / ".hermes" / "lithermes" / "work" / work_id / "state.json"
        self.bw.cancel_bounded_work(self.ws, work_id, self._state(work_id)["revision"])
        before = state_path.read_bytes()
        result = self._prompt("lit cancel", session="x", turn="x1")
        self.assertEqual(result["action"], "block")
        self.assertIn("nothing to cancel", result["message"])
        self.assertEqual(state_path.read_bytes(), before)

    def test_a_held_lock_reports_busy_within_seconds(self):
        work_id = self._start()
        before = self._raw_state(work_id)
        lock_path = self.ws / ".hermes" / "lithermes" / "work" / work_id / ".lock"
        with lock_path.open("a+", encoding="utf-8") as holder:
            fcntl.flock(holder.fileno(), fcntl.LOCK_EX)
            started = time.monotonic()
            result = self._prompt("lit cancel", session="b", turn="busy")
            elapsed = time.monotonic() - started
            fcntl.flock(holder.fileno(), fcntl.LOCK_UN)
        self.assertLess(elapsed, 3.5)
        self.assertIn("busy", result["message"])
        self.assertEqual(self._raw_state(work_id), before)

    def test_three_held_runs_answer_inside_the_overall_deadline(self):
        ids = [self._start(session=f"s{index}") for index in range(3)]
        holders = []
        try:
            for work_id in ids:
                handle = (self.ws / ".hermes" / "lithermes" / "work" / work_id / ".lock").open("a+", encoding="utf-8")
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
                holders.append(handle)
            started = time.monotonic()
            result = self._prompt("lit cancel", session="b", turn="deadline")
            elapsed = time.monotonic() - started
        finally:
            for handle in holders:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
                handle.close()
        self.assertLess(elapsed, self.bw.PROMPT_TOKEN_DEADLINE_SECONDS + 1.0)
        self.assertEqual(result["message"].count("busy"), 3)
        for work_id in ids:
            self.assertEqual(self._state(work_id)["status"], "active")

    def test_subagent_and_cron_prompts_cancel_nothing_and_no_litwork_run_is_created(self):
        work_id = self._start()
        runs = self.ws / ".hermes" / "lithermes" / "runs"
        self.assertIsNone(self._prompt("lit cancel", platform="subagent", turn="c1"))
        self.assertFalse(runs.exists())
        self._prompt("lit cancel", turn="c4", session="other")
        self.assertEqual(self._state(work_id)["status"], "cancelled")
        self.assertFalse(runs.exists())

        live = self._start()
        cron = self._prompt("lit cancel", platform="cron", turn="c2")
        self.assertNotEqual((cron or {}).get("action"), "block")
        approve = self._prompt("lit approve", platform="cron", turn="c3")
        self.assertNotEqual((approve or {}).get("action"), "block")
        self.assertEqual(self._state(live)["status"], "active")

    def test_an_exception_fails_closed_without_a_litwork_route(self):
        work_id = self._start()
        with mock.patch.object(self.bw, "cancel_from_prompt", side_effect=RuntimeError("disk gone")):
            result = self._prompt("lit cancel", turn="e1")
        self.assertEqual(result["action"], "block")
        self.assertIn("LIT: lit cancel was not applied", result["message"])
        self.assertEqual(self._state(work_id)["status"], "active")
        self.assertFalse((self.ws / ".hermes" / "lithermes" / "runs").exists())

    def test_slash_cancel_writes_the_notice_and_drops_the_queue(self):
        work_id = self._start()
        self._write(self.ws / "docs" / "a.md")
        revision = self._state(work_id)["revision"]
        self.pkg.core.command_lit_loop(f'cancel {work_id} --revision {revision} --worktree "{self.ws}"')
        state = self._raw_state(work_id)
        self.assertEqual(state["cancel_notice"]["owner_session_id"], "session-a")
        self.assertEqual(state["cancelled_by"], "command")
        self.assertFalse(self._parked_path(work_id).exists())
        with self.assertRaisesRegex(ValueError, "stale"):
            other = self._start(session="z")
            self.bw.cancel_bounded_work(self.ws, other, 1)

    def test_a_cancelled_run_does_not_keep_other_sessions_blocked(self):
        self._start(grants=[{"action": "write", "root": str(self.ws)}, {"action": "execute-test", "root": str(self.ws)}])
        self.bw._SESSION_WORKTREES.setdefault("bystander", set()).add(self.ws)
        self._prompt("lit cancel", turn="t29")
        self.assertIsNone(self._write(self.ws / "src" / "b.py", session="bystander"))
        self.assertIsNone(
            self._tool("terminal", {"command": "npm test", "workdir": str(self.ws)}, session="bystander")
        )

    def test_the_same_turn_twice_cancels_once(self):
        work_id = self._start()
        first = self._prompt("lit cancel", session="b", turn="same")
        second = self._prompt("lit cancel", session="b", turn="same")
        self.assertEqual(first, second)
        self.assertEqual(self._events(work_id).count("work_cancelled"), 1)

    def test_a_pending_receipt_replaces_every_row_and_does_not_outlive_its_turn(self):
        self._start()
        result = self._prompt("lit cancel", turn="r1")
        self.bw._PENDING_TOKEN_REPLY["session-a"] = result["message"]
        with mock.patch.object(self.pkg.litgoal_hook, "not_done_mark", return_value="NOT DONE"), mock.patch.object(
            self.pkg.core._lit_reentry, "take_visible", return_value="GOAL ROW"
        ):
            self.assertEqual(self._reply(), result["message"])
        self.bw._PENDING_TOKEN_REPLY["session-a"] = "stale receipt"
        self._prompt("hello", turn="r2")
        self.assertNotIn("session-a", self.bw._PENDING_TOKEN_REPLY)


class ProtectedPaths(_AutopilotCase):
    def setUp(self):
        super().setUp()
        self.work_id = self._start([{"action": "write", "root": str(self.ws)}])
        self.revision = self._state(self.work_id)["revision"]

    def _assert_protected(self, decision):
        self.assertIsNotNone(decision)
        self.assertEqual(decision["action"], "block")
        self.assertIn("protected", decision["message"])
        self.assertIn("Nothing ran and nothing was queued", decision["message"])

    def _assert_untouched(self):
        self.assertFalse(self._parked_path(self.work_id).exists())
        self.assertEqual(self._raw_state(self.work_id)["revision"], self.revision)

    def test_secret_and_hermes_settings_reads_are_refused(self):
        (self.home / ".aws").mkdir()
        (self.home / ".aws" / "credentials").write_text("k", encoding="utf-8")
        (self.ws / "notes.txt").symlink_to(self.home / ".aws" / "credentials")
        targets = [
            self.ws / ".env",
            self.ws / ".ENV",
            self.home / ".ssh" / "config",
            self.home / ".SSH" / "config",
            self.ws / "notes.txt",
            self.hermes / ".env",
            self.hermes / "auth.json",
            self.hermes / "config.yaml",
            self.hermes / "config.yaml.bak",
            self.hermes / "profiles" / "p" / "auth.json",
            self.hermes / "lithermes" / "litgoal.key",
            self.home / ".npmrc",
            self.ws / "id_ed25519",
            self.ws / "server.pem",
            self.ws / ".env.production.local",
            self.ws / ".envrc",
        ]
        for target in targets:
            with self.subTest(target=str(target)):
                self._assert_protected(self._tool("read_file", {"path": str(target)}))
        self._assert_protected(self._tool("search_files", {"path": str(self.ws / ".env"), "pattern": "KEY"}))
        self._assert_untouched()

    def test_protected_writes_inside_a_granted_root_are_refused(self):
        linked_common = self.base / "common.git"
        linked = self.base / "linked"
        (linked_common / "worktrees" / "linked").mkdir(parents=True)
        linked.mkdir()
        (linked / ".git").write_text(f"gitdir: {linked_common / 'worktrees' / 'linked'}\n", encoding="utf-8")
        (linked_common / "worktrees" / "linked" / "commondir").write_text("../..\n", encoding="utf-8")
        (self.ws / ".git" / "hooks").mkdir(parents=True)
        for target in (
            self.ws / ".env",
            self.ws / ".git" / "config",
            self.ws / ".git" / "hooks" / "pre-commit",
            self.ws / ".hermes" / "lithermes" / "work" / self.work_id / "state.json",
            self.ws / ".hermes" / "lithermes" / "litgoal" / "goals.json",
        ):
            with self.subTest(target=str(target)):
                self._assert_protected(self._write(target))
        self.assertIsNone(self._write(self.ws / ".hermes" / "lithermes" / "litresearch" / "x.md"))
        self.assertIsNone(self._write(self.ws / ".hermes" / "lithermes" / "runs" / "r" / "ledger.jsonl"))
        self.assertIsNone(self._write(self.ws / ".hermes" / "lithermes" / "litgoal" / "evidence" / "C1" / "a.txt"))
        self.assertEqual(
            self.bw._protected_path(linked_common / "config", write=True, worktrees=[linked]), "git-config"
        )
        self.assertIsNone(self.bw._protected_path(linked_common / "config", write=False, worktrees=[linked]))
        self._assert_untouched()

    def test_terminal_path_words_are_checked(self):
        (self.ws / ".git" / "hooks").mkdir(parents=True)
        self._assert_protected(self._tool("terminal", {"command": "ls ~/.ssh", "workdir": str(self.ws)}))
        self.assertIsNone(self._tool("terminal", {"command": "ls .git/hooks", "workdir": str(self.ws)}))
        self._assert_protected(self._tool("terminal", {"command": "git show HEAD:.env", "workdir": str(self.ws)}))
        self.assertIsNone(self._tool("terminal", {"command": "git show HEAD:src/a.py", "workdir": str(self.ws)}))
        observer = self._tool(
            "terminal", {"command": f"grep -r key {self.ws / '.env'}", "workdir": str(self.ws)}, session="watcher"
        )
        self._assert_protected(observer)

    def test_ordinary_lookalikes_and_hermes_session_folders_stay_readable(self):
        for target in (
            self.ws / ".env.example",
            self.ws / ".env.local.example",
            self.ws / "id_map.json",
            self.ws / "deck.key",
            self.ws / "config.yaml",
            self.ws / "README.pem.md",
            self.hermes / "sessions" / "20261111_x.jsonl",
            self.hermes / "cache" / "spillover" / "big.txt",
            self.hermes / "cache" / "terminal-output" / "out-1.log",
            self.hermes / "hook_outputs" / "a.json",
            self.ws / ".hermes" / "lithermes" / "work" / self.work_id / "state.json",
        ):
            with self.subTest(target=str(target)):
                self.assertIsNone(self._tool("read_file", {"path": str(target)}))
        self._assert_untouched()

    def test_symlink_names_are_checked_both_ways(self):
        (self.ws / "README.md").write_text("x", encoding="utf-8")
        (self.ws / ".env").symlink_to(self.ws / "README.md")
        self._assert_protected(self._tool("read_file", {"path": str(self.ws / ".env")}))

    def test_reads_stay_lock_free_while_a_run_lock_is_held(self):
        lock_path = self.ws / ".hermes" / "lithermes" / "work" / self.work_id / ".lock"
        with lock_path.open("a+", encoding="utf-8") as holder:
            fcntl.flock(holder.fileno(), fcntl.LOCK_EX)
            started = time.monotonic()
            plain = self._tool("read_file", {"path": str(self.plan)})
            secret = self._tool("read_file", {"path": str(self.ws / ".env")})
            elapsed = time.monotonic() - started
            fcntl.flock(holder.fileno(), fcntl.LOCK_UN)
        self.assertIsNone(plain)
        self._assert_protected(secret)
        self.assertLess(elapsed, 0.5)


class OutsideRuns(unittest.TestCase):
    def test_no_run_anywhere_changes_nothing(self):
        with tempfile.TemporaryDirectory() as raw:
            home = Path(raw).resolve()
            with mock.patch.dict(os.environ, {"HOME": str(home), "HERMES_HOME": str(home / ".hermes")}):
                pkg = _load_plugin_package()
                pkg.bounded_work._SESSION_WORKTREES.clear()
                self.assertIsNone(
                    pkg._pre_tool_call(
                        tool_name="read_file", args={"path": str(home / ".ssh" / "config")}, session_id="x"
                    )
                )


class ParkedSteps(_AutopilotCase):
    def test_an_uncovered_write_is_parked_and_the_run_stays_active(self):
        work_id = self._start()
        revision = self._state(work_id)["revision"]
        parked = self._write(self.ws / "docs" / "a.md")
        self.assertEqual(parked["action"], "block")
        self.assertIn("queued write", parked["message"])
        self.assertIn(f"still accepts revision {revision}", parked["message"])
        self.assertIn("BLOCKED", parked["message"])
        self.assertEqual(self._state(work_id)["status"], "active")
        self.assertIsNone(self._write(self.ws / "src" / "a.py"))

    def test_repeat_hits_never_move_the_revision(self):
        work_id = self._start()
        revision = self._state(work_id)["revision"]
        self._write(self.ws / "docs" / "a.md")
        self._write(self.ws / "docs" / "b.md")
        self._write(self.ws / "docs" / "a.md")
        third = self._write(self.ws / "docs" / "a.md")
        entries = self._parked(work_id)
        self.assertEqual([Path(entry["root"]).name for entry in entries], ["a.md", "b.md"])
        self.assertEqual(entries[0]["hits"], 3)
        self.assertIn("stop retrying", third["message"])
        self.assertEqual(self._raw_state(work_id)["revision"], revision)
        progress = self.bw.record_bounded_progress(
            self.ws,
            work_id,
            expected_revision=revision,
            replay_id="after-hits",
            session_id="session-a",
            progress=[{"id": "T001", "status": "in_progress"}],
        )
        self.assertEqual(progress["outcome"], "continue")

    def test_the_queue_holds_sixteen(self):
        work_id = self._start()
        for index in range(16):
            self._write(self.ws / "docs" / f"{index}.md")
        full = self._write(self.ws / "docs" / "16.md")
        self.assertIn("already holds 16 parked steps", full["message"])
        self.assertEqual(len(self._parked(work_id)), 16)

    def test_a_progress_boundary_parks_instead_of_pausing(self):
        work_id = self._start()
        result = self.bw.record_bounded_progress(
            self.ws,
            work_id,
            expected_revision=self._state(work_id)["revision"],
            replay_id="needs-test",
            session_id="session-a",
            progress=[{"id": "T001", "status": "blocked"}],
            boundary={"id": "b-test", "action": "execute-test", "root": str(self.ws), "reason": "run tests"},
        )
        self.assertEqual(result["outcome"], "parked")
        self.assertEqual(result["state"]["status"], "active")
        self.assertEqual(self._parked(work_id)[0]["id"], "b-test")
        receipt = self.bw.progress_tool_result(self.ws, work_id, "needs-test")
        self.assertEqual(receipt["outcome"], "parked")
        self.assertEqual(receipt["parked"], 1)
        self.assertNotIn("resume_command", receipt)

    def test_a_continue_session_boundary_is_never_parked(self):
        work_id = self._start()
        result = self.bw.record_bounded_progress(
            self.ws,
            work_id,
            expected_revision=self._state(work_id)["revision"],
            replay_id="self-pause",
            session_id="session-a",
            progress=[{"id": "T001", "status": "blocked"}],
            boundary={"id": "b-cs", "action": "continue-session", "root": str(self.ws), "reason": "stop"},
        )
        self.assertEqual(result["outcome"], "forbidden")
        self.assertEqual(result["action"], "unsupported")
        self.assertEqual(self._state(work_id)["status"], "active")
        self.assertEqual(self._parked(work_id), [])

    def test_lit_approve_turns_every_parked_step_into_a_grant(self):
        work_id = self._start()
        self._write(self.ws / "docs" / "a.md")
        self._tool("terminal", {"command": "npm test", "workdir": str(self.ws)})
        revision = self._state(work_id)["revision"]
        result = self._prompt("lit approve", turn="ap")
        self.assertNotEqual(result.get("action"), "block")
        self.assertIn("approved the parked steps", result["context"])
        self.assertIn(f"Current revision {revision + 1}", result["context"])
        self.assertEqual(self._state(work_id)["revision"], revision + 1)
        self.assertEqual(self._parked(work_id), [])
        self.assertIsNone(self._write(self.ws / "docs" / "a.md"))
        self.assertIsNone(self._tool("terminal", {"command": "npm test", "workdir": str(self.ws)}))
        self.assertIn("parked_approved", self._events(work_id))

    def test_lit_approve_respects_the_grant_cap(self):
        work_id = self._start()
        run_dir = self.ws / ".hermes" / "lithermes" / "work" / work_id
        state = self._raw_state(work_id)
        with self.bw._locked(run_dir):
            current = self.bw._reconcile_locked(run_dir)
            current["authority"] = [
                *current["authority"],
                *[
                    {"id": f"grant-{index}", "action": "write", "root": str(self.ws / "src" / f"g{index}"),
                     "boundary_id": None, "consumed_at": None}
                    for index in range(30)
                ],
            ]
            self.bw._commit(run_dir, current, current["revision"], "test_fill")
        del state
        for name in ("a", "b", "c"):
            self._write(self.ws / "docs" / f"{name}.md")
        result = self._prompt("lit approve", turn="cap")
        self.assertIn("still parked", result["context"])
        self.assertEqual(len(self._state(work_id)["authority"]), 32)
        self.assertEqual(len(self._parked(work_id)), 2)

    def test_lit_deny_refuses_the_steps_for_the_run(self):
        work_id = self._start()
        self._write(self.ws / "docs" / "a.md")
        self._write(self.ws / "docs" / "b.md")
        result = self._prompt("lit deny", turn="dn")
        self.assertIn("denied", result["context"])
        self.assertEqual(len(self._state(work_id)["denied_steps"]), 2)
        retry = self._write(self.ws / "docs" / "a.md")
        self.assertIn("the user denied", retry["message"])
        self.assertEqual(self._parked(work_id), [])

    def test_only_the_bound_session_settles_and_takeover_inherits_the_queue(self):
        work_id = self._start()
        self._write(self.ws / "docs" / "a.md")
        refused = self._prompt("lit approve", session="session-b", turn="nb")
        self.assertEqual(refused["action"], "block")
        self.assertIn("belongs to another session", refused["message"])
        self.assertEqual(len(self._parked(work_id)), 1)

        self.pkg._release_bounded_session(session_id="session-a")
        released = self._prompt("lit approve", session="session-b", turn="nb2")
        self.assertIn("has no session since its last one ended", released["message"])
        state = self._state(work_id)
        resumed = self.pkg.core.command_lit_loop(
            f"resume {work_id} --revision {state['revision']} --boundary {state['boundary']['id']} "
            f"--grant 'continue-session@{self.ws}' --worktree '{self.ws}'"
        )
        self._prompt(resumed["agent_message"], session="session-b", turn="bind")
        self.bw._SESSION_WORKTREES.setdefault("session-a", set()).add(self.ws)
        stranger = self._prompt("lit approve", session="session-a", turn="sa")
        self.assertEqual(stranger["action"], "block")
        settled = self._prompt("lit approve", session="session-b", turn="sb")
        self.assertIn("approved the parked steps", settled["context"])
        self.assertEqual(self._parked(work_id), [])

    def test_lit_approve_composes_like_the_activation_branch(self):
        self._start()
        self._write(self.ws / "docs" / "a.md")
        with mock.patch.object(self.pkg.core, "consume_rules_context", return_value="<post-edit-route/>"), mock.patch.object(
            self.pkg.litgoal_hook, "snapshot_context", return_value="<litgoal-snapshot/>"
        ), mock.patch.object(self.pkg.core, "pre_llm_call") as base:
            result = self._prompt("lit approve", turn="compose")
        base.assert_not_called()
        self.assertIn("<post-edit-route/>", result["context"])
        self.assertIn("<litgoal-snapshot/>", result["context"])
        self.assertIn("approved the parked steps", result["context"])

    def test_nothing_parked_is_a_one_line_refusal(self):
        self._start()
        result = self._prompt("lit deny", turn="np")
        self.assertEqual(result["action"], "block")
        self.assertIn("nothing is parked", result["message"])

    def test_old_paused_states_migrate_on_first_read(self):
        work_id, paused_revision = self._old_paused_state(session="s")
        state = self._state(work_id)
        self.assertEqual(state["status"], "active")
        self.assertIsNone(state["boundary"])
        self.assertEqual(state["active_session_id"], "s")
        entries = self._parked(work_id)
        self.assertEqual([(entry["id"], entry["source"]) for entry in entries], [("b-old", "migrated")])
        self.assertEqual(entries[0]["paused_revision"], paused_revision)
        self.assertEqual(self._events(work_id).count("boundary_parked"), 1)
        self.assertIsNone(self._write(self.ws / "src" / "ok.py", session="s"))
        again = self._state(work_id)
        self.assertEqual(again["revision"], state["revision"])
        with self.assertRaisesRegex(ValueError, "stale"):
            self.bw.resume_bounded_work(
                self.ws, work_id, expected_revision=paused_revision - 1, boundary_id="b-old",
                grant={"action": "execute-test", "root": str(self.ws)},
            )
        resumed = self.bw.resume_bounded_work(
            self.ws, work_id, expected_revision=paused_revision, boundary_id="b-old",
            grant={"action": "execute-test", "root": str(self.ws)},
        )
        self.assertEqual(resumed["state"]["status"], "active")
        self.assertEqual(resumed["grant"]["boundary_id"], "b-old")
        self.assertEqual(self._parked(work_id), [])

    def test_a_ledger_ahead_paused_snapshot_also_migrates(self):
        work_id, paused_revision = self._old_paused_state(session="s")
        run_dir = self.ws / ".hermes" / "lithermes" / "work" / work_id
        state = json.loads((run_dir / "state.json").read_text(encoding="utf-8"))
        state["revision"] -= 1
        state["status"] = "active"
        state["boundary"] = None
        (run_dir / "state.json").write_text(json.dumps(state), encoding="utf-8")
        self.assertEqual(self._state(work_id)["status"], "active")
        self.assertEqual(self._parked(work_id)[0]["paused_revision"], paused_revision)

    def test_a_released_pause_is_not_migrated(self):
        work_id = self._start(session="gone")
        self.pkg._release_bounded_session(session_id="gone")
        state = self._state(work_id)
        self.assertEqual(state["status"], "paused")
        self.assertEqual(state["boundary"]["action"], "continue-session")
        self.assertEqual(self._parked(work_id), [])

    def test_a_tool_hit_dedupes_onto_a_migrated_entry(self):
        work_id, _ = self._old_paused_state(session="s")
        self._state(work_id)
        self._tool("terminal", {"command": "npm test", "workdir": str(self.ws)}, session="s")
        entries = self._parked(work_id)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["hits"], 2)

    def test_hard_stops_are_never_parked_or_granted(self):
        work_id = self._start([{"action": "write", "root": str(self.ws)}, {"action": "execute-test", "root": str(self.ws)}])
        commands = (
            "git commit -m x", "git push", "git tag v1", "npm publish", "npm version patch",
            "git reset --hard", "gh release create v1",
        )

        def check(label):
            for command in commands:
                with self.subTest(state=label, command=command):
                    decision = self._tool("terminal", {"command": command, "workdir": str(self.ws)})
                    self.assertEqual(decision["action"], "block")
                    self.assertNotIn("queued", decision["message"])
            self.assertTrue(all(entry["action"] != "publish" for entry in self._parked(work_id)))

        check("fresh")
        self._write(self.ws.parent / "outside.txt")
        self.bw.record_bounded_progress(
            self.ws, work_id, expected_revision=self._state(work_id)["revision"], replay_id="pub",
            session_id="session-a", progress=[{"id": "T001", "status": "blocked"}],
            boundary={"id": "b-pub", "action": "publish", "root": str(self.ws), "reason": "ship"},
        )
        check("after-progress")
        self._tool("terminal", {"command": "npm run build", "workdir": str(self.ws)})
        check("with-parked")
        self._prompt("lit approve", turn="hs")
        check("approved")
        self.assertTrue(all(grant["action"] in {"write", "execute-test", "execute-build"} for grant in self._state(work_id)["authority"]))
        self._prompt("lit cancel", session="other", turn="hs2")
        check("cancel-window")

    def test_complete_drops_unused_parked_steps(self):
        work_id = self._start(complete=True)
        self._write(self.ws / "docs" / "a.md")
        completed = self.bw.complete_bounded_work(self.ws, work_id, self._state(work_id)["revision"])
        self.assertEqual(completed["status"], "completed")
        self.assertFalse(self._parked_path(work_id).exists())

    def test_the_reply_row_lists_the_queue_once_per_change(self):
        self._start()
        self.assertEqual(self._reply(text="done"), "done")
        for index in range(6):
            self._write(self.ws / "docs" / f"{index}.md")
        row = self._reply(text="done", turn="t2")
        self.assertIn("LIT: 6 steps parked, not run: write docs/0.md", row)
        self.assertIn("(+1 more)", row)
        self.assertIn("lit approve or lit deny", row)
        self.assertEqual(self._reply(text="again", turn="t3"), "again")
        self._write(self.ws / "docs" / "new.md")
        self.assertIn("7 steps parked", self._reply(text="more", turn="t4"))

    def test_status_and_activation_describe_parking(self):
        result = self.pkg.core.command_lit_loop(f'init approved --worktree "{self.ws}" --grant write@src')
        activated = self._prompt(result["agent_message"], turn="act")
        self.assertIn("parked and the run stays active", activated["context"])
        self.assertNotIn("When paused, print its exact resume command", activated["context"])
        self._write(self.ws / "docs" / "a.md")
        status = self.pkg.core.command_lit_loop(f'status {result["work_id"]} --worktree "{self.ws}"')
        self.assertIn("parked: 1", status["display"])
        self.assertIn("write@", status["display"])
        self.assertIn("lit cancel", self.pkg.core.status_report())


class RawReaders(_AutopilotCase):
    def test_reentry_note_names_parked_and_released_runs_correctly(self):
        reentry = self.pkg.core._lit_reentry
        work_id, _ = self._old_paused_state(session="s")
        work = reentry._resumable_work(self.ws)
        note = reentry._resume_note(work, self.ws)
        self.assertNotIn("do not mutate anything", note)
        self.assertIn("parked", note)
        self.bw.cancel_bounded_work(self.ws, work_id, self._state(work_id)["revision"])

        released = self._start(session="gone")
        self.pkg._release_bounded_session(session_id="gone")
        work = reentry._resumable_work(self.ws)
        self.assertEqual(work["id"], released)
        note = reentry._resume_note(work, self.ws)
        self.assertIn("continue-session", note)
        self.assertNotIn("do not mutate anything", note)

    def test_go_still_holds_for_an_unmigrated_parked_run(self):
        work_id, _ = self._old_paused_state(session="s")
        import adhd_stack

        self.assertTrue(adhd_stack._run_still_owned(self.ws, {"workId": work_id}, "s"))


if __name__ == "__main__":
    unittest.main()
