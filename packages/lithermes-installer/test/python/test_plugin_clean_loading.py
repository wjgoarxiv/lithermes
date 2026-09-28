"""Load the package as Hermes does, without the test suite's sys.path shim."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


PLUGIN = Path(__file__).resolve().parents[2] / "assets" / "lithermes-plugin"

PROBE = r'''
import importlib.util
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
assert "redaction" not in sys.modules
assert str(root) not in sys.path
spec = importlib.util.spec_from_file_location(
    "lithermes_native_probe", root / "__init__.py",
    submodule_search_locations=[str(root)],
)
plugin = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = plugin
spec.loader.exec_module(plugin)

class Context:
    def __init__(self):
        self.skills = {}
        self.hooks = {}
        self.commands = {}

    def register_hook(self, name, handler):
        assert callable(handler)
        self.hooks[name] = handler

    def register_tool(self, name, toolset, schema, handler, description="", **kwargs):
        assert callable(handler)

    def register_cli_command(self, name, help, setup_fn, handler_fn=None, description=""):
        assert callable(setup_fn)

    def register_command(self, name, handler, description="", args_hint=""):
        assert callable(handler)
        self.commands[name] = handler

    def register_skill(self, name, path, description=""):
        path = Path(path).resolve()
        assert path.is_relative_to(root / "skills")
        assert path.name == "SKILL.md" and path.is_file()
        body = path.read_text(encoding="utf-8")
        assert body.startswith("---") and len(body.strip()) > 100
        assert description.strip() and name not in self.skills
        self.skills[name] = str(path)

ctx = Context()
plugin.register(ctx)
assert set(ctx.skills) == {name for name, _ in plugin.PORTED_SKILLS}
assert {"litwork", "lit-plan", "litgoal", "lit-handoff"} <= ctx.skills.keys()
assert "pre_llm_call" in ctx.hooks and "lit" in ctx.commands
assert "redaction" not in sys.modules
assert str(root) not in sys.path
print(json.dumps({"skill_count": len(ctx.skills), "skills": ctx.skills}))
'''


class CleanPluginLoadingTests(unittest.TestCase):
    def test_fresh_native_package_load_registers_real_skill_metadata(self):
        with tempfile.TemporaryDirectory(prefix="lithermes-clean-load-") as tmp:
            home = Path(tmp) / "home"
            home.mkdir()
            nested_tmp = home / "tmp"
            nested_tmp.mkdir()
            env = dict(os.environ)
            env.pop("PYTHONPATH", None)
            env.pop("PYTHONHOME", None)
            env.update(
                HOME=str(home), USERPROFILE=str(home), HERMES_HOME=str(home / "hermes"),
                TMPDIR=str(nested_tmp), TMP=str(nested_tmp), TEMP=str(nested_tmp),
                XDG_CONFIG_HOME=str(home / "config"), XDG_CACHE_HOME=str(home / "cache"),
                XDG_DATA_HOME=str(home / "data"), XDG_STATE_HOME=str(home / "state"),
            )
            result = subprocess.run(
                [sys.executable, "-I", "-B", "-c", PROBE, str(PLUGIN)],
                cwd=home, env=env, capture_output=True, text=True, timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertGreater(json.loads(result.stdout)["skill_count"], 0)

    def test_payload_keeps_to_the_python_311_f_string_grammar(self):
        # Hermes runs the plugin on Python 3.11. A newer test interpreter also accepts
        # the PEP 701 forms (a backslash, a comment or the enclosing quote inside a
        # replacement field), and one of them kept the whole plugin from loading.
        import tokenize

        start = getattr(tokenize, "FSTRING_START", None)
        found = []
        for path in sorted(PLUGIN.rglob("*.py")):
            if start is None:
                compile(path.read_text(encoding="utf-8"), str(path), "exec")
                continue
            quotes = []
            with path.open("rb") as handle:
                for tok in tokenize.tokenize(handle.readline):
                    opener = tok.string.lstrip("rRbBuUfF")
                    if tok.type == tokenize.FSTRING_END:
                        quotes.pop()
                        continue
                    if not quotes or tok.type == tokenize.FSTRING_MIDDLE:
                        if tok.type == start:
                            quotes.append(opener)
                        continue
                    if (
                        "\\" in tok.string
                        or tok.type == tokenize.COMMENT
                        or (tok.type in (start, tokenize.STRING) and opener.startswith(quotes[-1]))
                    ):
                        found.append(f"{path.relative_to(PLUGIN)}:{tok.start[0]}")
                    if tok.type == start:
                        quotes.append(opener)
        self.assertEqual(found, [])
