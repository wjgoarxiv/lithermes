"""S-SEC cases of the autopilot port contract, run through the Hermes guard and both approvals.

Each case goes through ``pre_tool_call`` (``autopilot.guard``), then ``lit approve``,
then ``lit approve x``, and asserts nothing outside the expected set ran.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_HERE = os.path.dirname(os.path.abspath(__file__))
_ASSET_DIR = os.path.normpath(os.path.join(_HERE, "..", "..", "assets", "lithermes-plugin"))
if _ASSET_DIR not in sys.path:
    sys.path.insert(0, _ASSET_DIR)

import autopilot  # noqa: E402
import autopilot_shell as sh  # noqa: E402
import core  # noqa: E402

PLAN = "\n".join(
    [
        "# Plan", "", "## Todos", "- [x] 1. first row", "- [ ] 2. second row", "  BLOCKED: waiting on the user", "",
        "## Final verification wave", "- [x] F1. verify", "",
    ]
)


class SecurityCases(unittest.TestCase):
    sid = "owner"

    def setUp(self):
        autopilot.forget_all()
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(os.path.realpath(self._tmp.name))
        self.home = base / "home"
        self.ws = base / "ws"
        self.out = base / "outside"
        for folder in (self.home / ".ssh", self.home / ".aws", self.home / ".claude", self.home / "Desktop", self.ws / "plans", self.ws / "src", self.ws / ".git" / "hooks", self.out):
            folder.mkdir(parents=True, exist_ok=True)
        (self.home / ".aws" / "credentials").write_text("secret\n", encoding="utf-8")
        (self.ws / "src" / "a.mjs").write_text("1;\n", encoding="utf-8")
        (self.ws / "ok.mjs").write_text("1;\n", encoding="utf-8")
        (self.ws / ".git" / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
        (self.ws / "plans" / "p.md").write_text(PLAN, encoding="utf-8")
        self._env = patch.dict(os.environ, {"HOME": str(self.home), "HERMES_HOME": str(base / "hermes-home")})
        self._env.start()
        self._cwd = os.getcwd()
        os.chdir(self.ws)
        result = core.command_start_work(f"p --worktree {self.ws}")
        autopilot.prompt_turn(self.sid, result["agent_message"])

    def tearDown(self):
        os.chdir(self._cwd)
        self._env.stop()
        autopilot.forget_all()
        self._tmp.cleanup()

    def verdict(self, command, cwd=None):
        return sh.classify(command, Path(cwd or self.ws), self.ws, extra_protected=())

    def kind(self, command, cwd=None):
        return self.verdict(command, cwd).kind

    def guard(self, command):
        return autopilot.guard("terminal", {"command": command}, self.sid)

    def approve_both(self):
        autopilot.turn_end(self.sid)
        autopilot.prompt_turn(self.sid, "lit approve")
        autopilot.turn_end(self.sid)
        autopilot.prompt_turn(self.sid, "lit approve x")
        autopilot.turn_end(self.sid)

    def test_sec_01_03_dangling_links_are_x_and_write_nothing_outside(self):
        os.symlink(self.out / "target", self.ws / "notes.txt")
        os.symlink(self.out / "touched", self.ws / "dangling.txt")
        os.symlink(self.out / "nowhere", self.ws / "dlink")
        for command in ("cp src/a.mjs notes.txt", "touch dangling.txt", "mkdir -p dlink/x"):
            self.assertEqual(self.kind(command), "X", command)
            self.guard(command)
        autopilot.turn_end(self.sid)
        autopilot.prompt_turn(self.sid, "lit approve")
        self.assertEqual(sorted(p.name for p in self.out.iterdir()), [])

    def test_sec_04_06_git_internals_never_b(self):
        os.symlink(self.ws / ".git", self.ws / "gitlink")
        for command in (
            "touch .GIT/hooks/pre-commit", "cp src/a.mjs .Git/hooks/pre-commit", "cp src/a.mjs gitlink/hooks/pre-commit",
            "mkdir -p gitlink/x", "cd src && mv a.mjs ../.git/HEAD", "cp -r src .git", "touch .git/x",
        ):
            self.assertIn(self.kind(command), {"X", "refused"}, command)
        self.assertEqual(self.kind("touch .GIT/hooks/pre-commit"), "refused")

    def test_sec_07_09_outside_and_overwrite_are_x(self):
        os.symlink(self.out, self.ws / "outlink")
        for command in ("touch outlink/probe.txt", f"touch {self.out}/f2.txt", "cp src/a.mjs ../x", "mv src/a.mjs ok.mjs", "cp src/a.mjs ok.mjs"):
            self.assertEqual(self.kind(command), "X", command)

    def test_sec_10_17_unfollowable_forms_are_held_and_never_replayed(self):
        held = [
            "time pushd .. && touch s4b-time.txt", "A=1 cd .. && touch s4b-assign.txt", "! touch x", "nice cd .. && touch x",
            "nohup touch x", "timeout 5 touch x", "stdbuf -o0 touch x", "ionice touch x", "chroot / touch x", "doas touch x",
            "pushd .. && touch x", "popd", "builtin cd .. && touch x", "command touch x", "exec touch x", "eval 'touch x'",
            "source x.sh", ". x.sh", "env X=1 touch x", "sudo touch x", "xargs touch", "alias", "set", "shopt", "trap", "enable",
            "touch glob*.txt", "touch {a,b}.txt", "touch x > other.txt", "touch a\\ b", "echo dG91Y2g= | base64 -d | sh",
            "xxd -r dump", "openssl enc -d -in x", "sh -c 'x'", "bash -lc x", "echo $HOME", "echo `id`", 'echo "unclosed',
            "touch a &&  && touch b", "cd -",
        ]
        for command in held:
            self.assertEqual(self.kind(command), "held", command)
        for command in held[:6]:
            self.guard(command)
        self.approve_both()
        self.assertFalse(any((self.ws.parent / name).exists() for name in ("s4b-time.txt", "s4b-assign.txt")))
        self.assertFalse((self.ws / "x").exists())
        self.assertEqual(len(autopilot.load(autopilot.run_for_session(self.sid))["steps"]), 6)

    def test_sec_14_named_secret_is_refused_not_held(self):
        self.assertEqual(self.kind(f"cat {self.home}/.ssh/config"), "refused")
        self.assertEqual(self.kind("cat ~/.ssh/config"), "refused")

    def test_sec_17_cd_tracking(self):
        self.assertEqual(self.kind("cd"), "refused")
        self.assertEqual(self.kind("cd .. && cd .. && touch x"), "X")

    def test_sec_18_23_runners_and_package_scripts_are_x(self):
        (self.ws / "package.json").write_text(json.dumps({"scripts": {"clean": f"touch {self.out}/marker"}}), encoding="utf-8")
        for command in (
            "node ok.mjs --write x", "python3 x.py", "bash run.sh", "sh run.sh", "./run.sh", "perl x.pl", "deno run x.ts",
            "npm run clean", "npm run build --watch", "npm test -- --update", "npm start", "npx x", "pnpm run build", "yarn build", "bun run x",
            "make all", "gh pr merge 12", "npm unpublish x", "npm deprecate x old", "curl -X POST https://example.invalid/a",
            "ssh host ls", "scp a host:b", "docker push x", "rm -rf build", "git push origin b", "git tag v1", "npm publish",
            "git reset --hard", "git clean -fd", "git config x y", "npm version patch", "git pu", "git frobnicate", "make ship",
            "pnpm exec x", "yarn dlx x", "bun x y", "npm run-script x",
        ):
            self.assertEqual(self.kind(command), "X", command)
        self.guard("npm run clean")
        autopilot.turn_end(self.sid)
        autopilot.prompt_turn(self.sid, "lit approve")
        autopilot.turn_end(self.sid)
        autopilot.prompt_turn(self.sid, "lit approve")
        self.assertFalse((self.out / "marker").exists())

    def test_sec_22_24_outward_steps_keep_a_finished_run_open(self):
        for command in ("git pu", "make ship", "npm run clean", "rm -rf ../dist-old", "find .. -delete", "unlink /x"):
            self.assertTrue(sh.outward(command, self.ws), command)
        self.assertFalse(sh.outward("touch later.txt", self.ws))
        self.assertFalse(sh.outward("node ok.mjs > out.txt", self.ws))

    def test_sec_25_28_secrets_and_homes_refused_and_never_parked(self):
        refused = [
            f"cd {self.home} && cat .aws/credentials", f'cat {self.home}/.cl""aude/settings.json',
            f"cat {self.home}/.c'l'aude/settings.json", f"cd {self.home}/Desktop && cd .. && cat .ssh/config",
            "cd ~someone && ls", "cat .env", f"cat {self.home}/.npmrc", f"cat {self.home}/.zshrc", "cat key.pem",
            "cat .envrc", "cat .mcp.json", f"ls {os.environ['HERMES_HOME']}",
        ]
        for command in refused:
            self.assertEqual(self.kind(command), "refused", command)
            self.assertIn("refused", self.guard(command)["message"], command)
        self.assertEqual(autopilot.load(autopilot.run_for_session(self.sid))["steps"], [])
        self.assertEqual(self.kind("cat .env.example"), "allow")

    def test_sec_28_readers_that_write_or_execute_are_never_allowed(self):
        writers = [
            f"sed -n 'w {self.home}/.zshrc' ok.mjs", "sed 'W ../x' ok.mjs", "sed 'e id' ok.mjs", "sed 'r ../x' ok.mjs",
            "sed 's/1/2/w ../x' ok.mjs", "sed 's/1/2/e' ok.mjs", "sed -f script.sed ok.mjs", "sed -e '1p' -e 'w ../x' ok.mjs",
            "sed '1{w ../x' ok.mjs", "sed --expression='w ../x' ok.mjs",
            "git branch -D main", "git branch -f main HEAD~5", "git branch newname", "git branch -m old new",
            "sort --output=../x ok.mjs", "sort -o ../x ok.mjs", "sort -o../x ok.mjs", "uniq ok.mjs ../x",
            "tree -o ../x", "git diff --output=../x", "git log --output ../x", "git diff --ext-diff",
            "find . -fprint0 ../x", "rg --pre=sh pat", "rg --pre sh pat", "file -C -m x",
            "cat ok.mjs | sed 'w ../x'", "cat ok.mjs | uniq - ../x",
        ]
        for command in writers:
            with self.subTest(command=command):
                self.assertNotEqual(self.kind(command), "allow", command)
                self.assertIsNotNone(self.guard(command), command)
        self.assertFalse((self.home / ".zshrc").exists())
        self.assertFalse((self.out.parent / "x").exists())

    def test_sec_28_readers_that_run_code_or_print_env_are_held(self):
        for command in (
            "less +!id ok.mjs", "more +!id ok.mjs", "less ok.mjs", "jq env ok.json", "jq -n env", "jq '.a | env' ok.json",
            "jq '$ENV' ok.json", "jq input_filename ok.json", "jq -n 'env.HOME'", "rg --hostname-bin=id pat",
            "rg --hostname-bin id pat", "cat ok.mjs | jq env", "cat ok.mjs | rg --hostname-bin=id x",
        ):
            with self.subTest(command=command):
                self.assertNotEqual(self.kind(command), "allow", command)
                self.assertIsNotNone(self.guard(command), command)
        for command in ("jq .a ok.json", "jq -r '.items[] | .name' ok.json", "jq .environment ok.json", "rg --hidden pat"):
            with self.subTest(command=command):
                self.assertEqual(self.kind(command), "allow", command)

    def test_fail_closed_when_the_run_state_cannot_be_read(self):
        run_dir = autopilot.run_for_session(self.sid)
        for broken in ("{not json", json.dumps({"schema": "other"}), "x" * (autopilot.MAX_STATE_BYTES + 1)):
            autopilot.state_file(run_dir).write_text(broken, encoding="utf-8")
            with self.subTest(broken=broken[:20]):
                for tool, args in (
                    ("terminal", {"command": "npm publish"}), ("terminal", {"command": "cat ok.mjs"}),
                    ("write_file", {"path": str(self.ws / "a.txt"), "content": "x"}), ("read_file", {"path": str(self.ws / "ok.mjs")}),
                ):
                    blocked = autopilot.guard(tool, args, self.sid)
                    self.assertIsNotNone(blocked, tool)
                    self.assertEqual(blocked["action"], "block")
                    blocked = autopilot.guard(tool, args, "delegate-child")
                    self.assertIsNotNone(blocked, f"child {tool}")

    def test_lit_cancel_still_ends_a_run_whose_state_cannot_be_read(self):
        run_dir = autopilot.run_for_session(self.sid)
        autopilot.state_file(run_dir).write_text("{not json", encoding="utf-8")
        handled, context = autopilot.prompt_turn(self.sid, "lit cancel")
        self.assertTrue(handled)
        self.assertIn("ended", context)
        self.assertIsNone(autopilot.run_for_session(self.sid))
        self.assertIsNone(autopilot.guard("terminal", {"command": "cat ok.mjs"}, self.sid))

    def test_plugin_wrapper_fails_closed_for_every_session_the_run_guards(self):
        import plugin_register_test_support as support

        pkg = support._load_plugin_package()
        run_dir = autopilot.run_for_session(self.sid)
        with patch.object(pkg.autopilot, "guard", side_effect=OSError("disk full")), patch.object(
            pkg.autopilot, "_run_for_tool", return_value=Path(run_dir)
        ):
            for sid in (self.sid, "delegate-child"):
                blocked = pkg._autopilot_guard({"tool_name": "terminal", "args": {"command": "npm publish"}, "session_id": sid})
                self.assertEqual(blocked["action"], "block", sid)
        with patch.object(pkg.autopilot, "guard", side_effect=OSError("x")), patch.object(pkg.autopilot, "_run_for_tool", return_value=None):
            self.assertIsNone(pkg._autopilot_guard({"tool_name": "terminal", "args": {"command": "ls"}, "session_id": "no-run"}))

    def test_an_oversized_command_is_refused_and_never_stored(self):
        run_dir = autopilot.run_for_session(self.sid)
        before = autopilot.state_file(run_dir).read_bytes()
        for command in ("npm publish " + "a" * autopilot.MAX_COMMAND_BYTES, "cat ok.mjs " + "b" * autopilot.MAX_COMMAND_BYTES):
            blocked = self.guard(command)
            self.assertEqual(blocked["action"], "block")
            self.assertIn("refused", blocked["message"])
            self.assertNotIn("a" * 200, blocked["message"])
        self.assertEqual(autopilot.state_file(run_dir).read_bytes(), before)
        self.assertLessEqual(autopilot.MAX_COMMAND_BYTES, 4096)

    def test_r5_abbreviated_and_clustered_writing_flags_are_no_readers(self):
        for command in (
            "sort -uo ../x ok.mjs", "sort -o../x ok.mjs", "sort --out=../x ok.mjs", "sort --outp ../x ok.mjs",
            "sort --compress-prog=sh ok.mjs", "sort --comp=sh ok.mjs", "file --comp ok.mjs", "file -bC ok.mjs",
            "tree -ao ../x", "git diff --out=../x", "git log --outp=../x", "rg --pre-g=x --pr=sh pat",
        ):
            with self.subTest(command=command):
                self.assertNotEqual(self.kind(command), "allow", command)
                self.assertIsNotNone(self.guard(command), command)
        for command in ("sort -u ok.mjs", "sort -rn ok.mjs", "sort --reverse ok.mjs", "file -b ok.mjs", "tree -a src"):
            with self.subTest(command=command):
                self.assertEqual(self.kind(command), "allow", command)

    def test_r5_protected_check_follows_cd_across_segments_and_on_replay(self):
        (self.home / ".config" / "gh").mkdir(parents=True, exist_ok=True)
        (self.home / ".config" / "gh" / "hosts.yml").write_text("token\n", encoding="utf-8")
        for command in ("cd ~/.config && cat gh/hosts.yml", f"cd {self.home} && cat .aws/credentials", "cd ~ && cd .ssh && ls"):
            with self.subTest(command=command):
                self.assertEqual(self.kind(command), "refused", command)
                self.assertIn("refused", self.guard(command)["message"], command)

    def test_r5_writes_into_any_git_internal_are_refused(self):
        for command in (
            "cp ok.mjs .git/HEAD", "echo x > .git/HEAD", "touch .git/index", "rm .git/packed-refs",
            "mv ok.mjs .git/refs/heads/main", "rm -rf .git", "cp ok.mjs .GIT/ORIG_HEAD", "tee .git/refs/x < ok.mjs",
        ):
            with self.subTest(command=command):
                self.assertIn("refused", self.guard(command)["message"], command)
        self.assertEqual((self.ws / ".git" / "HEAD").read_text(encoding="utf-8"), "ref: refs/heads/main\n")
        self.assertIsNone(self.guard("git status"))

    def test_r5_recursive_readers_on_a_protected_ancestor_are_refused(self):
        for command in (
            "grep -r x ~", "grep -R secret ~/", f"grep -rn x {self.home}", "find ~ -name 'id_*'", f"find {self.home} -type f",
            "rg secret ~", "ls -R ~", "ls -laR ~", "tree ~", "grep -r x /", "find / -name credentials", f"cd {self.home} && grep -r x .",
            f"cd {self.home} && find .",
        ):
            with self.subTest(command=command):
                self.assertEqual(self.kind(command), "refused", command)
        for command in ("grep -r x src", "find . -name '*.mjs'", "rg x src", "ls ~", "ls -R src", "tree src"):
            with self.subTest(command=command):
                self.assertNotEqual(self.kind(command), "refused", command)

    def test_rf_more_recursive_forms_over_a_home_are_refused(self):
        for command in (
            "diff -r ~ src", "diff -R ~ src", "diff --recursive ~ src", "grep -d recurse x ~", "grep --directories=recurse x ~",
            "grep -drecurse x ~", "find -L ~ -name 'id_*'", "find -H ~", f"find -P {self.home} -type f", "find -L -O2 ~",
            "rg --files ~", "jq -L~/.ssh -n 1",
        ):
            with self.subTest(command=command):
                self.assertEqual(self.kind(command), "refused", command)
        for command in ("diff -r src src", "diff ok.mjs src/a.mjs", "find -L src -name '*.mjs'", "grep -d skip x ok.mjs", "rg --files src"):
            with self.subTest(command=command):
                self.assertNotEqual(self.kind(command), "refused", command)

    def test_rf_git_stage_paths_and_rg_pretty(self):
        for command in ("git show :.env", "git show :0:.env", "git show HEAD:src/.env"):
            with self.subTest(command=command):
                self.assertEqual(self.kind(command), "refused", command)
        self.assertEqual(self.kind("rg --pretty pat src"), "allow")
        self.assertEqual(self.kind("rg --pre-glob '*.gz' pat src"), "allow")
        self.assertNotEqual(self.kind("rg --pre sh pat src"), "allow")
        self.assertNotEqual(self.kind("rg --pre=sh pat src"), "allow")

    def test_rf_a_bound_session_whose_state_file_is_gone_is_denied_until_cancel(self):
        run_dir = autopilot.run_for_session(self.sid)
        autopilot.state_file(run_dir).unlink()
        blocked = self.guard("touch fine.txt")
        self.assertIsNotNone(blocked)
        self.assertEqual(blocked.get("action"), "block")
        self.assertIsNotNone(autopilot.guard("write_file", {"path": str(self.ws / "x.txt"), "content": "x"}, self.sid))
        handled, _ = autopilot.prompt_turn(self.sid, "lit cancel")
        self.assertTrue(handled)
        self.assertIsNone(autopilot.run_for_session(self.sid))
        self.assertIsNone(self.guard("touch fine.txt"))

    def test_r5_corrupt_state_fails_closed_and_keeps_denied_commands_refused(self):
        self.guard("git push origin main")
        autopilot.turn_end(self.sid)
        autopilot.prompt_turn(self.sid, "lit deny")
        autopilot.turn_end(self.sid)
        self.assertIn("refused", self.guard("git push origin main")["message"])
        run_dir = autopilot.run_for_session(self.sid)
        path = autopilot.state_file(run_dir)
        good = json.loads(path.read_text(encoding="utf-8"))
        for broken in (
            "{\"schema\": ",
            json.dumps({**good, "denied": "x"}),
            json.dumps({**good, "steps": {}}),
            json.dumps({**good, "status": 5}),
            json.dumps({**good, "worktree": None}),
        ):
            with self.subTest(broken=broken[:40]):
                path.write_text(broken, encoding="utf-8")
                blocked = self.guard("git push origin main")
                self.assertIsNotNone(blocked)
                self.assertEqual(blocked.get("action"), "block")
                self.assertIsNotNone(self.guard("touch fine.txt"))
        path.write_text("{\"schema\": ", encoding="utf-8")
        with self.assertRaises(ValueError) as caught:
            core.command_start_work(f"p --worktree {self.ws} --resume")
        self.assertIn("BLOCKED", str(caught.exception))
        self.assertEqual(path.read_text(encoding="utf-8"), "{\"schema\": ", "a re-arm never overwrites an unreadable state")

    def test_final_digest_fallback_only_after_a_restart(self):
        self.guard("npm run deploy")
        autopilot.turn_end(self.sid)
        run_dir = autopilot.run_for_session(self.sid)
        state = autopilot.load(run_dir)
        forged = {"id": "list-forged", "steps": [dict(state["snapshot"]["steps"][0], command="touch forged.txt")], "boundaries": []}
        state["steps"][0]["command"] = "touch forged.txt"
        state["snapshot"] = forged
        state["snapshot_digest"] = autopilot.snapshot_digest(forged)
        autopilot.state_file(run_dir).write_text(json.dumps(state), encoding="utf-8")
        handled, context = autopilot.prompt_turn(self.sid, "lit approve x")
        self.assertTrue(handled)
        self.assertIn("changed since it was shown", context)
        self.assertFalse((self.ws / "forged.txt").exists())

    def test_final_moving_or_removing_an_ancestor_of_the_run_folder_is_refused(self):
        run_dir = autopilot.run_for_session(self.sid)
        for command in (
            "mv .hermes moved", "rm -rf .hermes", "rm -rf .hermes/lithermes", "cp -r src .hermes", "mv .hermes/lithermes x",
            "rmdir .hermes", "ln -sfn /tmp .hermes", "chmod -R 000 .hermes", "rm -rf .", f"cd {self.ws} && mv .hermes moved",
        ):
            with self.subTest(command=command):
                self.assertIn("refused", self.guard(command)["message"], command)
        self.assertTrue(Path(run_dir).is_dir())
        for command in ("touch fine.txt", "mv src/a.mjs src/b.mjs"):
            self.assertNotIn("refused", (self.guard(command) or {}).get("message", ""), command)

    def test_final_hermes_session_files_need_lexical_and_real_path_inside(self):
        hermes = Path(os.environ["HERMES_HOME"])
        (hermes / "sessions").mkdir(parents=True, exist_ok=True)
        (hermes / "config.yaml").write_text("k: v\n", encoding="utf-8")
        os.symlink(hermes / "config.yaml", hermes / "sessions" / "link.jsonl")
        os.symlink(hermes / "sessions", self.ws / "sess")
        self.assertFalse(sh.hermes_session_file(hermes / "sessions" / "link.jsonl"))
        self.assertIsNotNone(autopilot.guard("read_file", {"path": str(hermes / "sessions" / "link.jsonl")}, self.sid))
        (hermes / "sessions" / "real.jsonl").write_text("x", encoding="utf-8")
        self.assertFalse(sh.hermes_session_file(self.ws / "sess" / "real.jsonl"), "lexical path is outside the Hermes home")
        self.assertTrue(sh.hermes_session_file(hermes / "sessions" / "real.jsonl"))

    def test_final_more_readers_that_run_or_leak(self):
        (self.out / "patterns.txt").write_text("a\n", encoding="utf-8")
        (self.ws / "patterns.txt").write_text("a\n", encoding="utf-8")
        for command in (
            "sort --compress-program=sh ok.mjs", "sort --compress-program sh ok.mjs", f"grep -f {self.out}/patterns.txt ok.mjs",
            f"grep --file={self.out}/patterns.txt ok.mjs", f"rg -f {self.out}/patterns.txt", "git show HEAD:.env",
            "git show HEAD:src/.env.local", "git cat-file -p HEAD:id_ed25519", f"cat ~/.aws/credentials", "cat ~/.ssh/config",
        ):
            with self.subTest(command=command):
                self.assertNotEqual(self.kind(command), "allow", command)
                self.assertIsNotNone(self.guard(command), command)
        self.assertEqual(self.kind("cat ~/.aws/credentials"), "refused")
        self.assertEqual(self.kind("git show HEAD:.env"), "refused")
        self.assertEqual(self.kind("grep -f patterns.txt ok.mjs"), "allow")
        self.assertEqual(self.kind("git show HEAD:src/a.mjs"), "allow")

    def test_final_edit_tools_are_case_folded_on_the_state_folder(self):
        if not sh.CASE_FOLD:
            self.skipTest("case-sensitive file system")
        run_dir = Path(autopilot.run_for_session(self.sid))
        upper = Path(str(run_dir).replace("/.hermes/", "/.HERMES/").replace("/lithermes/", "/LitHermes/"))
        self.assertNotEqual(upper, run_dir)
        for tool in ("write_file", "patch"):
            blocked = autopilot.guard(tool, {"path": str(upper / "autopilot.json"), "content": "{}"}, self.sid)
            self.assertIsNotNone(blocked, tool)
        self.assertIn("refused", self.guard(f"cp ok.mjs {upper}/autopilot.json")["message"])

    def test_sec_28_plain_readers_still_run(self):
        for command in (
            "sed -n '1,5p' ok.mjs", "sed 's/1/2/g' ok.mjs", "sed -n -e '1p' -e '2p' ok.mjs", "sed '/x/d' ok.mjs",
            "sed -E 's#a#b#2' ok.mjs", "sed 3q ok.mjs", "git branch", "git branch --list", "git branch --show-current",
            "git branch -a -v", "uniq ok.mjs", "sort -r ok.mjs", "rg pat", "grep -o pat ok.mjs", "find . -name x",
            "git diff --stat", "cat ok.mjs | uniq",
        ):
            with self.subTest(command=command):
                self.assertEqual(self.kind(command), "allow", command)

    def test_sec_28_execute_code_is_refused_while_a_run_is_live(self):
        blocked = autopilot.guard("execute_code", {"code": "open('x','w').write('1')"}, self.sid)
        self.assertEqual(blocked["action"], "block")
        self.assertIn("terminal", blocked["message"])
        self.assertEqual(autopilot.load(autopilot.run_for_session(self.sid))["steps"], [])

    def test_s_a2_10_own_hermes_session_folders_stay_readable(self):
        hermes = Path(os.environ["HERMES_HOME"])
        for target in (
            hermes / "sessions" / "s.jsonl", hermes / "cache" / "spillover" / "big.txt",
            hermes / "cache" / "terminal-output" / "out-1.log", hermes / "hook_outputs" / "a.json",
            hermes / "profiles" / "work" / "sessions" / "s.jsonl",
        ):
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("x", encoding="utf-8")
            with self.subTest(target=str(target)):
                self.assertIsNone(autopilot.guard("read_file", {"path": str(target)}, self.sid))
                self.assertEqual(self.kind(f"cat {target}"), "allow")
        for target in (hermes / "config.yaml", hermes / "auth.json", hermes / ".env", hermes / "plugins" / "x.py"):
            with self.subTest(target=str(target)):
                self.assertIsNotNone(autopilot.guard("read_file", {"path": str(target)}, self.sid))
                self.assertEqual(self.kind(f"cat {target}"), "refused")
        self.assertEqual(self.kind(f"touch {hermes}/sessions/new.jsonl"), "refused")

    def test_c1_unknown_verbs_park_by_default(self):
        for command in (
            "dd if=ok.mjs of=copy.mjs", "tar -C .. -xf a.tar", "ln -s ok.mjs l.mjs", "chmod +x ok.mjs", "truncate -s 0 ok.mjs",
            "install ok.mjs ../x", "patch -p1 < fix.diff", "go run .", "cargo run", "uv run x.py", "awk '{print}' ok.mjs",
            "git grep -O pat", "make", "rm ok.mjs",
        ):
            with self.subTest(command=command):
                self.assertIn(self.kind(command), {"X", "held", "refused"}, command)
                self.assertIsNotNone(self.guard(command), command)

    def test_c1_repo_test_commands_run_without_parking(self):
        self.assertNotEqual(self.kind("npm test"), "allow", "no package.json here yet")
        (self.ws / "package.json").write_text('{"scripts": {"test": "node --test"}}\n', encoding="utf-8")
        for command in ("npm test", "npm run test", "npm run check", "npm run lint", "npm run build", "npm run typecheck"):
            with self.subTest(command=command):
                self.assertEqual(self.kind(command), "allow", command)
        for command in ("npm run deploy", "npm test -- --x", "npm run test --prefix ..", "npm publish"):
            with self.subTest(command=command):
                self.assertNotEqual(self.kind(command), "allow", command)

    def test_c1_c3_name_value_operands_are_checked_as_paths(self):
        for command in (
            f"dd if={self.home}/.aws/credentials of=out", f"dd if=ok.mjs of={self.home}/.zshrc",
            f"cat --file={self.home}/.ssh/id_ed25519", f"x=1 y={self.home}/.ssh/config",
        ):
            with self.subTest(command=command):
                self.assertEqual(self.kind(command), "refused", command)

    def test_c4_writes_naming_run_state_or_git_hooks_config_are_refused(self):
        run_dir = autopilot.run_for_session(self.sid)
        for command in (
            f"echo x > {run_dir}/autopilot.json", f"cp ok.mjs {run_dir}/state.json", f"tee {run_dir}/x.json < ok.mjs",
            f"dd if=ok.mjs of={run_dir}/autopilot.json", "echo x >> .git/config", "cp ok.mjs .git/hooks/pre-push",
            "ln -s ../ok.mjs .git/hooks/pre-commit", "sed -i s/a/b/ .git/config", "chmod +x .git/hooks/pre-commit",
        ):
            with self.subTest(command=command):
                self.assertIn("refused", self.guard(command)["message"], command)
        self.assertEqual(autopilot.load(run_dir)["steps"], [])
        state_path = Path(run_dir) / "autopilot.json"
        for tool in ("write_file", "patch"):
            blocked = autopilot.guard(tool, {"path": str(Path(run_dir) / "other.json"), "content": "{}"}, self.sid)
            self.assertIsNotNone(blocked, tool)
        self.assertIsNone(autopilot.guard("read_file", {"path": str(state_path)}, self.sid))
        self.assertEqual(self.kind(f"cat {run_dir}/state.json"), "allow")

    def test_c4_replay_refuses_a_snapshot_whose_digest_changed(self):
        self.guard("npm run deploy")
        listed = autopilot.turn_end(self.sid) or ""
        self.assertRegex(listed, r"digest `[0-9a-f]{12}`")
        run_dir = autopilot.run_for_session(self.sid)
        state = autopilot.load(run_dir)
        state["snapshot"]["steps"][0]["command"] = "touch tampered.txt"
        autopilot.state_file(run_dir).write_text(json.dumps(state), encoding="utf-8")
        handled, context = autopilot.prompt_turn(self.sid, "lit approve x")
        self.assertTrue(handled)
        self.assertIn("changed since it was shown", context)
        self.assertFalse((self.ws / "tampered.txt").exists())

    def test_c5_link_chains_and_loops_resolve_fully(self):
        os.symlink(self.home / ".ssh" / "new_key", self.ws / "hop2")
        os.symlink(self.ws / "hop2", self.ws / "hop1")
        os.symlink(self.ws / "loop_b", self.ws / "loop_a")
        os.symlink(self.ws / "loop_a", self.ws / "loop_b")
        for command in ("touch hop1", "cp ok.mjs hop1", "cat hop1", "touch loop_a", "cat loop_a"):
            with self.subTest(command=command):
                self.assertEqual(self.kind(command), "refused", command)
        for path in ("hop1", "loop_a"):
            self.assertIsNotNone(autopilot.guard("write_file", {"path": str(self.ws / path), "content": "x"}, self.sid))
            self.assertIsNotNone(autopilot.guard("read_file", {"path": str(self.ws / path)}, self.sid))
        self.assertFalse((self.home / ".ssh" / "new_key").exists())

    def test_every_hidden_home_folder_is_a_host_home_by_shape(self):
        for command in (
            f"cat {self.home}/.someagent/auth.json", f"ls {self.home}/.config/anyhost",
            f"cd {self.home} && cat .otherhost/config.toml", f"touch {self.home}/.newtool/settings.json",
        ):
            self.assertEqual(self.kind(command), "refused", command)
        self.assertNotEqual(self.kind(f"ls {self.home}/Desktop"), "refused")

    def test_sec_29_30_replay_rechecks_tier_and_folder(self):
        run_dir = autopilot.run_for_session(self.sid)
        self.guard("touch fine.txt")
        (self.ws / "sub").mkdir()
        autopilot.guard("terminal", {"command": "touch in-sub.txt", "workdir": str(self.ws / "sub")}, self.sid)
        autopilot.turn_end(self.sid)
        state = autopilot.load(run_dir)
        state["steps"][0]["command"] = f"touch {os.environ['HERMES_HOME']}/probe.txt"
        autopilot._save(run_dir, state)
        os.rmdir(self.ws / "sub")
        autopilot.prompt_turn(self.sid, "lit approve")
        state = autopilot.load(run_dir)
        self.assertFalse(Path(os.environ["HERMES_HOME"], "probe.txt").exists())
        self.assertFalse((self.ws / "in-sub.txt").exists())
        self.assertEqual(len(state["steps"]), 2)
        by_cwd = {step["cwd"]: step for step in state["steps"]}
        self.assertTrue(by_cwd[str(self.ws / "sub")].get("held"), state["steps"])
        self.assertFalse(by_cwd[str(self.ws)].get("held"), "an edited step no longer matches the shown list and is skipped")

    def test_sec_31_replay_is_bound_to_the_shown_list(self):
        (self.ws / "m1.mjs").write_text("import fs from 'node:fs'; fs.writeFileSync('m1.txt', '1');\n", encoding="utf-8")
        self.guard("node m1.mjs --write x")
        autopilot.turn_end(self.sid)
        self.guard("curl -X DELETE https://example.invalid/r")
        with patch.object(autopilot, "_run_x_shell", wraps=autopilot._run_x_shell) as runner:
            autopilot.prompt_turn(self.sid, "lit approve x")
        self.assertEqual([call.args[0] for call in runner.call_args_list], ["node m1.mjs --write x"])
        listed = autopilot.turn_end(self.sid)
        self.assertIn("curl -X DELETE https://example.invalid/r", listed)

    def test_sec_34_trailing_space_or_case_runs_nothing(self):
        (self.ws / "m1.mjs").write_text("import fs from 'node:fs'; fs.writeFileSync('m1.txt', '1');\n", encoding="utf-8")
        self.guard("node m1.mjs --write x")
        autopilot.turn_end(self.sid)
        for text in ("lit approve x ", "Lit approve x"):
            autopilot.prompt_turn(self.sid, text)
        self.assertFalse((self.ws / "m1.txt").exists())
        autopilot.prompt_turn(self.sid, "lit approve x")
        self.assertTrue((self.ws / "m1.txt").exists())

    def test_sec_35_boundaries_parked_after_the_list_are_granted(self):
        target = self.out / "report.md"
        verdict = autopilot.guard("write_file", {"path": str(target)}, self.sid)
        self.assertIn("[path]", verdict["message"])
        autopilot.prompt_turn(self.sid, "lit approve")
        self.assertIsNone(autopilot.guard("write_file", {"path": str(target)}, self.sid))

    def test_sec_36_check_is_read_from_the_current_plan_but_allowlisted(self):
        run_dir = autopilot.run_for_session(self.sid)
        state = autopilot.load(run_dir)
        self.assertEqual(autopilot.run_check(f"node {self.ws}/ok.mjs", self.ws)["status"], "pass")
        self.assertEqual(autopilot.run_check("npm run clean", self.ws)["status"], "not-allowlisted")
        self.assertEqual(autopilot.run_check(f"node {self.out}/x.mjs", self.ws)["status"], "not-allowlisted")
        self.assertEqual(state["status"], "active")


if __name__ == "__main__":
    unittest.main()
