import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

_HERE = Path(__file__).resolve().parent
_ASSET_DIR = (_HERE / ".." / ".." / "assets" / "lithermes-plugin").resolve()
if str(_ASSET_DIR) not in sys.path:
    sys.path.insert(0, str(_ASSET_DIR))

import auto_update


class AutoUpdateTests(unittest.TestCase):
    def setUp(self):
        auto_update.reset_attempts()

    def tearDown(self):
        auto_update.reset_attempts()

    def _eligible(self, home: Path, **extra):
        return {
            "platform": "cli",
            "is_first_turn": True,
            "session_id": "first",
            "interactive": True,
            **extra,
        }

    def _state_fixture(self, home):
        state = home / "lithermes"
        state.mkdir()
        (state / "install-manifest.json").write_text(json.dumps({"version": "0.8.41", "distribution": "npm"}), encoding="utf-8")
        (state / "auto-update-receipt.json").write_text(json.dumps({
            "packageName": "@litfamily/lithermes", "status": "updated", "targetVersion": "0.8.42",
            "doctor": "ok", "rollback": {"status": "not-needed"},
        }), encoding="utf-8")
        (home / "config.yaml").write_text("user_setting: keep\n", encoding="utf-8")
        plugin = home / "plugins" / "lithermes"
        plugin.mkdir(parents=True)
        (plugin / "plugin.yaml").write_text("version: 0.8.41\n", encoding="utf-8")
        return state

    def _preserved_files(self, root):
        return {str(file.relative_to(root)): (file.stat().st_ino, file.read_bytes())
                for file in root.rglob("*") if file.is_file() and not file.is_symlink()}

    def test_unsafe_state_parent_refuses_before_version_read_fetch_or_runner(self):
        for kind in ("symlink", "dangling symlink", "file"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                home = Path(tmp)
                state = self._state_fixture(home)
                outside = home / "outside-state"
                state.rename(outside)
                if kind == "file":
                    state.write_text("unrelated user file\n", encoding="utf-8")
                else:
                    state.symlink_to(outside if kind == "symlink" else home / "absent", target_is_directory=True)
                preserved = self._preserved_files(outside)
                config = (home / "config.yaml").read_bytes()
                plugin = (home / "plugins" / "lithermes" / "plugin.yaml").read_bytes()
                identity = state.lstat().st_ino
                with mock.patch.object(auto_update, "installed_version", wraps=auto_update.installed_version) as version, mock.patch.object(
                    auto_update, "fetch_latest_version", return_value="0.8.42"
                ) as fetch:
                    runner = mock.Mock(return_value=SimpleNamespace(returncode=0))
                    result = auto_update.run_auto_update(kwargs=self._eligible(home, hermes_home=str(home), session_id=kind), runner=runner)
                self.assertEqual(result, {"status": "failed", "reason": "automatic-update-unsafe-state"})
                version.assert_not_called()
                fetch.assert_not_called()
                runner.assert_not_called()
                self.assertEqual(self._preserved_files(outside), preserved)
                self.assertEqual(state.lstat().st_ino, identity)
                self.assertEqual((home / "config.yaml").read_bytes(), config)
                self.assertEqual((home / "plugins" / "lithermes" / "plugin.yaml").read_bytes(), plugin)

    def test_state_swap_during_fetch_refuses_before_child(self):
        for replacement in ("symlink", "directory"):
            with self.subTest(replacement=replacement), tempfile.TemporaryDirectory() as tmp:
                home = Path(tmp)
                state = self._state_fixture(home)
                original = self._preserved_files(state)
                def fetch():
                    state.rename(home / "retained-state")
                    if replacement == "symlink":
                        state.symlink_to(home / "retained-state", target_is_directory=True)
                    else:
                        state.mkdir()
                        (state / "unrelated.txt").write_text("user content", encoding="utf-8")
                    return "0.8.42"
                runner = mock.Mock(return_value=SimpleNamespace(returncode=0))
                with mock.patch.object(auto_update, "fetch_latest_version", side_effect=fetch):
                    result = auto_update.run_auto_update(kwargs=self._eligible(home, hermes_home=str(home), session_id=replacement), runner=runner)
                self.assertEqual(result, {"status": "failed", "reason": "automatic-update-unsafe-state"})
                runner.assert_not_called()
                self.assertEqual(self._preserved_files(home / "retained-state"), original)

    def test_state_swap_during_child_refuses_before_receipt_reads(self):
        for replacement in ("symlink", "directory"):
            with self.subTest(replacement=replacement), tempfile.TemporaryDirectory() as tmp:
                home = Path(tmp)
                state = self._state_fixture(home)
                original = self._preserved_files(state)
                def runner(*args, **kwargs):
                    state.rename(home / "retained-state")
                    if replacement == "symlink":
                        state.symlink_to(home / "retained-state", target_is_directory=True)
                    else:
                        state.mkdir()
                        (state / "unrelated.txt").write_text("user content", encoding="utf-8")
                    return SimpleNamespace(returncode=0)
                with mock.patch.object(auto_update, "fetch_latest_version", return_value="0.8.42"), mock.patch.object(
                    auto_update, "_read_install_receipt", wraps=auto_update._read_install_receipt
                ) as receipt:
                    result = auto_update.run_auto_update(kwargs=self._eligible(home, hermes_home=str(home), session_id=replacement), runner=runner)
                self.assertEqual(result["reason"], "automatic-update-unsafe-state")
                self.assertEqual(result["status"], "failed")
                receipt.assert_not_called()
                self.assertEqual(self._preserved_files(home / "retained-state"), original)

    def test_missing_state_is_not_assumed_to_be_an_npm_channel(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            state = self._state_fixture(home)
            state.rename(home / "prior-fixture-state")
            runner = mock.Mock()
            with mock.patch.object(auto_update, "fetch_latest_version") as fetch:
                result = auto_update.run_auto_update(kwargs=self._eligible(home, hermes_home=str(home)), runner=runner)
            self.assertEqual(result, {"status": "skipped", "reason": "catalog-channel"})
            fetch.assert_not_called()
            runner.assert_not_called()
            self.assertFalse(state.exists())

    def test_initially_missing_state_does_not_start_a_fetch(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            state = self._state_fixture(home)
            state.rename(home / "prior-fixture-state")
            runner = mock.Mock()
            with mock.patch.object(auto_update, "fetch_latest_version") as fetch:
                result = auto_update.run_auto_update(kwargs=self._eligible(home, hermes_home=str(home)), runner=runner)
            self.assertEqual(result, {"status": "skipped", "reason": "catalog-channel"})
            fetch.assert_not_called()
            runner.assert_not_called()
            self.assertFalse(state.exists())

    def test_direct_state_readers_refuse_symlinked_parent_without_reading(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            state = self._state_fixture(home)
            state.rename(home / "outside-state")
            state.symlink_to(home / "outside-state", target_is_directory=True)
            with mock.patch.object(Path, "read_text", side_effect=AssertionError("unexpected state read")):
                self.assertIsNone(auto_update.installed_version(home))
                self.assertIsNone(auto_update._read_install_receipt(home))

    def test_direct_state_json_reads_refuse_symlinked_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            state = self._state_fixture(home)
            for name in ("install-manifest.json", "auto-update-receipt.json"):
                file = state / name
                outside = home / name
                file.rename(outside)
                file.symlink_to(outside)
            with mock.patch.object(Path, "read_text", side_effect=AssertionError("unexpected state read")):
                self.assertIsNone(auto_update._read_state_json(home, "install-manifest.json"))
                self.assertIsNone(auto_update._read_install_receipt(home))

    def test_state_swap_during_receipt_read_never_promotes_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            state = self._state_fixture(home)
            original_reader = auto_update._read_install_receipt
            def read_receipt(*args):
                value = original_reader(*args)
                state.rename(home / "retained-state")
                state.mkdir()
                return value
            with mock.patch.object(auto_update, "fetch_latest_version", return_value="0.8.42"), mock.patch.object(
                auto_update, "_read_install_receipt", side_effect=read_receipt
            ):
                result = auto_update.run_auto_update(
                    kwargs=self._eligible(home, hermes_home=str(home)),
                    runner=lambda *args, **kwargs: SimpleNamespace(returncode=0),
                )
            self.assertEqual(result, {"status": "failed", "reason": "automatic-update-unsafe-state", "state": "unknown"})

    def test_state_json_leaf_swap_after_inspection_is_not_read_or_accepted(self):
        replacements = ["symlink", "file"] + (["fifo"] if hasattr(os, "mkfifo") else [])
        for replacement in replacements:
            with self.subTest(replacement=replacement), tempfile.TemporaryDirectory() as tmp:
                home = Path(tmp)
                state = self._state_fixture(home)
                file = state / "install-manifest.json"
                foreign = home / "foreign.json"
                foreign.write_text(json.dumps({"version": "99.88.77", "foreign": True}), encoding="utf-8")
                foreign_identity = foreign.stat().st_ino
                foreign_bytes = foreign.read_bytes()
                real_lstat = Path.lstat
                swapped = False
                def lstat(selected, *args, **kwargs):
                    nonlocal swapped
                    observed = real_lstat(selected, *args, **kwargs)
                    if selected == file and not swapped:
                        swapped = True
                        file.rename(state / "original-manifest.json")
                        if replacement == "symlink":
                            file.symlink_to(foreign)
                        elif replacement == "fifo":
                            os.mkfifo(file)
                        else:
                            file.write_bytes(foreign_bytes)
                    return observed
                with mock.patch.object(Path, "lstat", lstat), mock.patch.object(auto_update.json, "load", wraps=auto_update.json.load) as read:
                    self.assertIsNone(auto_update._read_state_json(home, "install-manifest.json"))
                    read.assert_not_called()
                self.assertTrue(swapped)
                self.assertEqual(foreign.stat().st_ino, foreign_identity)
                self.assertEqual(foreign.read_bytes(), foreign_bytes)
                self.assertEqual(json.loads((state / "original-manifest.json").read_text(encoding="utf-8"))["version"], "0.8.41")

    def test_registry_scope_is_encoded(self):
        self.assertEqual(auto_update.REGISTRY_URL, "https://registry.npmjs.org/%40litfamily%2Flithermes/latest")

    def test_registry_fetch_requires_exact_scoped_identity(self):
        def opener_for(name, version="98.76.54", status=200):
            def opener(request, timeout):
                self.assertEqual(request.full_url, "https://registry.npmjs.org/%40litfamily%2Flithermes/latest")
                self.assertEqual(timeout, 3.0)
                self.assertFalse(request.has_header("Authorization"))
                response = io.BytesIO(json.dumps({"name": name, "version": version}).encode())
                response.status = status
                return response
            return opener
        self.assertEqual(auto_update.fetch_latest_version(opener=opener_for("@litfamily/lithermes")), "98.76.54")
        for name in ("lithermes-ai", "@litfamily/hermes", "@litfamily/other", "@litfamily/lithermes/extra"):
            with self.assertRaisesRegex(ValueError, "package name"):
                auto_update.fetch_latest_version(opener=opener_for(name))
        with self.assertRaisesRegex(ValueError, "stable semver"):
            auto_update.fetch_latest_version(opener=opener_for("@litfamily/lithermes", "98.76.54-beta.1"))
        with self.assertRaisesRegex(ValueError, "status"):
            auto_update.fetch_latest_version(opener=opener_for("@litfamily/lithermes", status=302))

    def test_gate_is_first_interactive_turn_only(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"HERMES_HOME": tmp}, clear=True):
            home = Path(tmp)
            self.assertTrue(auto_update.should_auto_update(kwargs=self._eligible(home), env={}))
            self.assertFalse(auto_update.should_auto_update(kwargs=self._eligible(home, is_first_turn=False), env={}))
            self.assertFalse(auto_update.should_auto_update(kwargs=self._eligible(home, platform="subagent"), env={}))
            self.assertFalse(auto_update.should_auto_update(kwargs=self._eligible(home), env={"LITHERMES_NO_AUTO_UPDATE": "1"}))
            for command in ("help", "uninstall", "hud", "version"):
                self.assertFalse(auto_update.should_auto_update(kwargs=self._eligible(home, command=command), env={}), command)

    def test_sanitized_environment_drops_credentials_and_recursion_options(self):
        home = Path("/tmp/hermes-home").resolve()
        safe = auto_update.sanitized_environment(
            home,
            {
                "PATH": "/safe/bin",
                "HOME": "/safe/home",
                "NPM_TOKEN": "secret",
                "NODE_AUTH_TOKEN": "secret",
                "npm_config_userconfig": "/secret.npmrc",
                "NODE_OPTIONS": "--require=/tmp/hook.py",
                "HTTPS_PROXY": "https://user:pass@example.test",
            },
        )
        self.assertEqual(safe["HERMES_HOME"], str(home))
        self.assertEqual(safe[auto_update.AUTO_UPDATE_GUARD_ENV], "1")
        self.assertNotIn("NPM_TOKEN", safe)
        self.assertNotIn("NODE_OPTIONS", safe)
        self.assertNotIn("HTTPS_PROXY", safe)

    def test_bridge_pins_exact_version_and_safe_npx_arguments(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"HERMES_HOME": tmp}, clear=True):
            home = Path(tmp)
            (home / "lithermes").mkdir()
            (home / "lithermes" / "install-manifest.json").write_text(json.dumps({"version": "0.8.41", "distribution": "npm"}), encoding="utf-8")
            calls = []

            def runner(command, **options):
                calls.append((command, options))
                (home / "lithermes" / "install-manifest.json").write_text(json.dumps({"version": "0.8.42", "distribution": "npm"}), encoding="utf-8")
                (home / "lithermes" / "auto-update-receipt.json").write_text(
                    json.dumps({
                        "packageName": "@litfamily/lithermes",
                        "status": "updated",
                        "targetVersion": "0.8.42",
                        "doctor": "ok",
                        "rollback": {"status": "not-needed"},
                    }),
                    encoding="utf-8",
                )
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            with mock.patch.object(auto_update, "fetch_latest_version", return_value="0.8.42"):
                result = auto_update.run_auto_update(kwargs=self._eligible(home), runner=runner)
            self.assertEqual(result["status"], "updated")
            command, options = calls[0]
            self.assertEqual(command[:7], ["npx", "--yes", "--package", "@litfamily/lithermes@0.8.42", "--", "lithermes", "__auto-update"])
            self.assertIn("--hermes-home", command)
            self.assertNotIn("--home", command)
            self.assertEqual(options["timeout"], 30.0)
            self.assertEqual(options["env"][auto_update.AUTO_UPDATE_GUARD_ENV], "1")
            self.assertNotIn("NPM_TOKEN", options["env"])

    def test_catalog_channel_never_attempts_self_update(self):
        """A catalog/git payload must not bridge back to npm, even with stale state."""
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            state = home / "lithermes"
            state.mkdir()
            (state / "install-manifest.json").write_text(
                json.dumps({"version": "0.8.41", "distribution": "catalog"}),
                encoding="utf-8",
            )
            fetch = mock.Mock(return_value="0.8.42")
            runner = mock.Mock(return_value=SimpleNamespace(returncode=0))
            with mock.patch.object(auto_update, "fetch_latest_version", fetch):
                result = auto_update.run_auto_update(
                    kwargs=self._eligible(home, hermes_home=str(home)),
                    runner=runner,
                )
            self.assertEqual(result, {"status": "skipped", "reason": "catalog-channel"})
            fetch.assert_not_called()
            runner.assert_not_called()

    def test_npm_channel_still_attempts_self_update(self):
        """The installer-owned npm marker preserves the existing updater behavior."""
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            state = home / "lithermes"
            state.mkdir()
            (state / "install-manifest.json").write_text(
                json.dumps({"version": "0.8.41", "distribution": "npm"}),
                encoding="utf-8",
            )
            calls = []

            def runner(command, **options):
                calls.append((command, options))
                (state / "install-manifest.json").write_text(
                    json.dumps({"version": "0.8.42", "distribution": "npm"}),
                    encoding="utf-8",
                )
                (state / "auto-update-receipt.json").write_text(
                    json.dumps({
                        "packageName": "@litfamily/lithermes",
                        "status": "updated",
                        "targetVersion": "0.8.42",
                        "doctor": "ok",
                        "rollback": {"status": "not-needed"},
                    }),
                    encoding="utf-8",
                )
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            with mock.patch.object(auto_update, "fetch_latest_version", return_value="0.8.42"):
                result = auto_update.run_auto_update(
                    kwargs=self._eligible(home, hermes_home=str(home)),
                    runner=runner,
                )
            self.assertEqual(result["status"], "updated")
            self.assertEqual(len(calls), 1)

    def test_zero_exit_without_truthful_receipt_or_version_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"HERMES_HOME": tmp}, clear=True):
            home = Path(tmp)
            (home / "lithermes").mkdir()
            (home / "lithermes" / "install-manifest.json").write_text(json.dumps({"version": "0.8.41", "distribution": "npm"}), encoding="utf-8")

            with mock.patch.object(auto_update, "fetch_latest_version", return_value="0.8.42"):
                no_receipt = auto_update.run_auto_update(
                    kwargs=self._eligible(home),
                    runner=lambda command, **options: SimpleNamespace(returncode=0, stdout="", stderr=""),
                )
            self.assertEqual(no_receipt["status"], "failed")
            self.assertEqual(no_receipt["reason"], "automatic-install-no-truthful-receipt")

            auto_update.reset_attempts()
            (home / "lithermes" / "auto-update-receipt.json").write_text(
                json.dumps({
                    "packageName": "@litfamily/lithermes",
                    "status": "updated",
                    "targetVersion": "0.8.42",
                    "doctor": "ok",
                    "rollback": {"status": "not-needed"},
                }),
                encoding="utf-8",
            )
            with mock.patch.object(auto_update, "fetch_latest_version", return_value="0.8.42"):
                stale_version = auto_update.run_auto_update(
                    kwargs=self._eligible(home),
                    runner=lambda command, **options: SimpleNamespace(returncode=0, stdout="", stderr=""),
                )
            self.assertEqual(stale_version["status"], "failed")
            self.assertEqual(stale_version["reason"], "automatic-install-version-mismatch")

    def test_hook_is_silent_and_does_not_change_route(self):
        with mock.patch.object(auto_update, "should_auto_update", return_value=True), mock.patch.object(
            auto_update, "run_auto_update", return_value={"status": "failed"}
        ) as run:
            self.assertIsNone(auto_update.pre_llm_call(platform="cli", is_first_turn=True, session_id="silent"))
            run.assert_called_once()

    def test_hook_surfaces_unknown_state_after_failed_restore(self):
        with mock.patch.object(auto_update, "should_auto_update", return_value=True), mock.patch.object(
            auto_update,
            "run_auto_update",
            return_value={"status": "failed", "state": "unknown", "reason": "automatic-update-unknown-state"},
        ):
            with self.assertRaises(auto_update.UnknownStateError):
                auto_update.pre_llm_call(platform="cli", is_first_turn=True, session_id="unknown-state")


if __name__ == "__main__":
    unittest.main()
