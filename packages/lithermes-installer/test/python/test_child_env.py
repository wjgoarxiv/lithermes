"""N5: every subprocess the plugin process starts gets a scrubbed environment."""

from __future__ import annotations

import ast
import re
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
PLUGIN_ROOT = PACKAGE_ROOT / "assets" / "lithermes-plugin"
CHANNEL_ROOT = PACKAGE_ROOT / "assets" / "npm-channel"
for _path in (PLUGIN_ROOT, CHANNEL_ROOT, PLUGIN_ROOT / "skills" / "browser-drive" / "scripts"):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

import auto_update  # noqa: E402
import capability_probe  # noqa: E402
import child_env  # noqa: E402
import core_contexts  # noqa: E402
import core_review  # noqa: E402
import deliverable_hedge_guard  # noqa: E402
import diagnostics  # noqa: E402

# Canary values are built so no real credential-shaped literal sits in the repo.
CANARY = "canary-" + "value"
SECRET_NAMES = (
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "XAI_API_KEY",
    "OPENROUTER_API_KEY",
    "NOUS_API_KEY",
    "HERMES_OPENAI_KEY",
    "GITHUB_TOKEN",
    "AWS_SECRET_ACCESS_KEY",
    "DB_PASSWORD",
    "SSH_AUTH_SOCK",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "OPENAI_BASE_URL",
    "ANTHROPIC_MODEL",
    "XAI_REGION",
    "Openai_Org",
)
BASE_ENV = {
    "PATH": "/usr/bin:/bin",
    "HOME": "/home/tester",
    "USER": "tester",
    "LANG": "en_US.UTF-8",
    "LC_ALL": "en_US.UTF-8",
    "LC_CTYPE": "UTF-8",
    "TMPDIR": "/tmp",
    "SHELL": "/bin/zsh",
    "TERM": "xterm",
    "HERMES_HOME": "/home/tester/.hermes",
    "XDG_CACHE_HOME": "/home/tester/.cache",
}
SECRET_PATTERN = re.compile(
    r"KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL|^(OPENAI|ANTHROPIC|XAI|OPENROUTER|NOUS)", re.IGNORECASE
)


def hostile_environ() -> dict[str, str]:
    return {**BASE_ENV, **{name: CANARY for name in SECRET_NAMES}, "UNRELATED_FLAG": "1"}


def assert_clean(test: unittest.TestCase, env: object) -> None:
    test.assertIsInstance(env, dict, "subprocess was started without an explicit env")
    leaked = [name for name in env if SECRET_PATTERN.search(name)]
    test.assertEqual(leaked, [])
    test.assertNotIn(CANARY, env.values())
    test.assertEqual(env.get("PATH"), BASE_ENV["PATH"])


class ScrubbedEnvTests(unittest.TestCase):
    def test_strips_every_secret_shaped_name_and_keeps_essentials(self):
        env = child_env.scrubbed_env(source=hostile_environ(), windows=False)
        self.assertEqual(env, BASE_ENV)

    def test_drops_names_that_are_not_on_the_allowlist(self):
        env = child_env.scrubbed_env(source={**BASE_ENV, "UNRELATED_FLAG": "1", "PYTHONPATH": "/x"}, windows=False)
        self.assertNotIn("UNRELATED_FLAG", env)
        self.assertNotIn("PYTHONPATH", env)

    def test_skips_empty_values(self):
        env = child_env.scrubbed_env(source={"PATH": "", "HOME": "/h"}, windows=False)
        self.assertEqual(env, {"HOME": "/h"})

    def test_extras_are_added_and_win_over_inherited_values(self):
        env = child_env.scrubbed_env({"GIT_OPTIONAL_LOCKS": "0", "HOME": "/override"}, source=BASE_ENV, windows=False)
        self.assertEqual(env["GIT_OPTIONAL_LOCKS"], "0")
        self.assertEqual(env["HOME"], "/override")

    def test_secret_shaped_extra_is_refused(self):
        for name in ("OPENAI_API_KEY", "MY_TOKEN", "XAI_REGION", "HERMES_NOUS_KEY"):
            with self.assertRaises(ValueError):
                child_env.scrubbed_env({name: "x"}, source=BASE_ENV, windows=False)

    def test_windows_keys_pass_only_on_windows(self):
        source = {**BASE_ENV, "SYSTEMROOT": "C:\\Windows", "COMSPEC": "cmd.exe", "PATHEXT": ".EXE"}
        self.assertNotIn("SYSTEMROOT", child_env.scrubbed_env(source=source, windows=False))
        env = child_env.scrubbed_env(source=source, windows=True)
        self.assertEqual({k: env[k] for k in ("SYSTEMROOT", "COMSPEC", "PATHEXT")}, {k: source[k] for k in ("SYSTEMROOT", "COMSPEC", "PATHEXT")})

    def test_defaults_to_the_process_environment_without_mutating_it(self):
        with mock.patch.dict("os.environ", hostile_environ(), clear=True):
            env = child_env.scrubbed_env()
            self.assertNotIn("OPENAI_API_KEY", env)
            self.assertEqual(sys.modules["os"].environ["OPENAI_API_KEY"], CANARY)

    def test_auto_update_environment_stays_credential_free_and_has_the_guard(self):
        env = auto_update.sanitized_environment(Path("/home/tester/.hermes"), hostile_environ())
        assert_clean(self, env)
        self.assertEqual(env[auto_update.AUTO_UPDATE_GUARD_ENV], "1")
        self.assertNotIn("UNRELATED_FLAG", env)


class _Recorder:
    """Stand-in for subprocess.run / Popen that records kwargs and reports a failed child."""

    def __init__(self):
        self.calls: list[tuple[list[str], dict]] = []

    def run(self, args, **kwargs):
        self.calls.append((list(args), kwargs))
        return subprocess.CompletedProcess(args, 1, stdout=b"" if not kwargs.get("text") else "", stderr=b"" if not kwargs.get("text") else "")

    def popen(self, args, **kwargs):
        self.calls.append((list(args), kwargs))
        raise OSError("recorded, not started")


class CallSiteTests(unittest.TestCase):
    def setUp(self):
        self.rec = _Recorder()
        for target, attr in (("subprocess.run", "run"), ("subprocess.Popen", "popen")):
            patcher = mock.patch(target, getattr(self.rec, attr))
            patcher.start()
            self.addCleanup(patcher.stop)
        env = mock.patch.dict("os.environ", hostile_environ(), clear=True)
        env.start()
        self.addCleanup(env.stop)

    def assert_every_call_scrubbed(self, minimum: int = 1):
        self.assertGreaterEqual(len(self.rec.calls), minimum)
        for _argv, kwargs in self.rec.calls:
            assert_clean(self, kwargs.get("env"))

    def test_core_review_git_calls(self):
        core_review._run_git(Path("."), ["status"])
        core_review._run_git_bytes(Path("."), ["status", "-z"])
        self.assert_every_call_scrubbed(2)
        self.assertTrue(all(kwargs.get("timeout") for _argv, kwargs in self.rec.calls))
        self.assertTrue(all(argv[0] == "git" for argv, _kwargs in self.rec.calls))

    def test_diagnostics_doctor_starts_no_process(self):
        # The motion and Office runtime probes left with their skills; doctor now reads files only.
        diagnostics.doctor_report("0.0.0")
        self.assertEqual(self.rec.calls, [])

    def test_hedge_guard_detector(self):
        deliverable_hedge_guard._run_detector("A new sentence.", "report.md")
        self.assert_every_call_scrubbed(1)
        self.assertTrue(all(kwargs.get("timeout") for _argv, kwargs in self.rec.calls))

    def test_hedge_guard_pdf_text_extraction(self):
        with mock.patch("shutil.which", return_value="/usr/bin/pdftotext"):
            with self.assertRaises(ValueError):
                deliverable_hedge_guard._extract_office(b"%PDF-1.4", ".pdf")
        self.assert_every_call_scrubbed(1)
        self.assertEqual(self.rec.calls[0][0][0], "/usr/bin/pdftotext")
        self.assertTrue(self.rec.calls[0][1].get("timeout"))

    def test_browser_driver_probe_from_the_plugin(self):
        with mock.patch("shutil.which", return_value="/usr/bin/agent-browser"):
            core_contexts._probe_browser_driver_report()
        self.assert_every_call_scrubbed(1)
        self.assertEqual(self.rec.calls[0][0][1:], ["--version"])

    def test_auto_update_runner_receives_the_credential_free_env(self):
        seen = {}

        def runner(command, **kwargs):
            seen.update(kwargs)
            return subprocess.CompletedProcess(command, 1, stdout="", stderr="")

        home = Path("/nonexistent/hermes-home")
        with mock.patch.object(auto_update, "resolve_hermes_home", return_value=home):
            try:
                auto_update.run_auto_update(kwargs={}, env=hostile_environ(), runner=runner)
            except Exception:
                pass
        if seen:
            assert_clean(self, seen.get("env"))
            self.assertTrue(seen.get("timeout"))


_SPAWNERS = {"run", "Popen", "call", "check_call", "check_output", "getoutput", "getstatusoutput"}
_OUT_OF_LANE = {"litgoal", "dashboard", "desktop"}


def _spawn_calls(path: Path) -> list[ast.Call]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            owner = node.func.value
            if isinstance(owner, ast.Name) and owner.id == "subprocess" and node.func.attr in _SPAWNERS:
                found.append(node)
            if isinstance(owner, ast.Name) and owner.id == "os" and node.func.attr in {"system", "popen", "execv", "execve", "spawnv"}:
                found.append(node)
    return found


class InventoryGuardTests(unittest.TestCase):
    """A new spawn site must pick an env on purpose or this fails."""

    def _plugin_python_files(self):
        for path in sorted(PLUGIN_ROOT.rglob("*.py")):
            relative = path.relative_to(PLUGIN_ROOT)
            if relative.parts[0] in {"skills", "vendor"}:
                continue
            yield path

    def test_every_plugin_process_spawn_site_passes_env(self):
        files = list(self._plugin_python_files()) + [
            PLUGIN_ROOT / "skills" / "browser-drive" / "scripts" / "capability_probe.py",
            PLUGIN_ROOT / "skills" / "lit-humanizer" / "scripts" / "extract_office_text.py",
            CHANNEL_ROOT / "auto_update.py",
        ]
        offenders = []
        for path in files:
            for call in _spawn_calls(path):
                keywords = {kw.arg for kw in call.keywords}
                if "env" not in keywords:
                    offenders.append(f"{path.relative_to(PACKAGE_ROOT)}:{call.lineno}")
        self.assertEqual(offenders, [])

    def test_no_shell_true_and_no_os_system_in_plugin_code(self):
        offenders = []
        for path in self._plugin_python_files():
            for call in _spawn_calls(path):
                shell = [kw for kw in call.keywords if kw.arg == "shell" and getattr(kw.value, "value", None) is True]
                if shell or (isinstance(call.func, ast.Attribute) and call.func.value.id == "os"):
                    offenders.append(f"{path.relative_to(PACKAGE_ROOT)}:{call.lineno}")
        self.assertEqual(offenders, [])

    def test_only_known_modules_start_processes(self):
        # fingerprint.py runs git for the litgoal run fingerprint with its own four-name
        # allowlist (PATH, HOME, LANG, LC_ALL): it must stay importable by file path in the
        # gateway, where child_env is not reachable, and the allowlist is stricter.
        known = {"core_review.py", "deliverable_hedge_guard.py", "fingerprint.py"}
        actual = {path.name for path in self._plugin_python_files() if _spawn_calls(path)}
        self.assertEqual(actual, known)

    def test_no_permissive_cors_anywhere_in_the_plugin_surface(self):
        pattern = re.compile(r"CORSMiddleware|allow_origins|Access-Control-Allow|access-control-allow|add_middleware", re.IGNORECASE)
        offenders = []
        for path in PLUGIN_ROOT.rglob("*"):
            relative = path.relative_to(PLUGIN_ROOT)
            if not path.is_file() or path.suffix not in {".py", ".js", ".mjs", ".ts", ".tsx", ".yaml", ".yml", ".json"}:
                continue
            if relative.parts[0] in {"vendor"} or "node_modules" in relative.parts:
                continue
            if relative.parts[0] == "skills" and "scripts" not in relative.parts and "bin" not in relative.parts:
                continue
            if pattern.search(path.read_text(encoding="utf-8", errors="ignore")):
                offenders.append(str(relative))
        self.assertEqual(offenders, [])

    def test_plugin_never_binds_a_socket_server(self):
        pattern = re.compile(r"\b(HTTPServer|ThreadingHTTPServer|socketserver|serve_forever|uvicorn\.run|create_server|http\.createServer)\b")
        offenders = []
        for path in self._plugin_python_files():
            if pattern.search(path.read_text(encoding="utf-8")) and path.name != "core.py":
                offenders.append(path.name)
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
