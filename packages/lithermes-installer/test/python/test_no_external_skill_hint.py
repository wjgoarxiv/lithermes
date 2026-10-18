"""No external skill-hint service is consulted, and no switch for one is read.

The plugin once asked a remote recommendation API which skill to suggest. That
path is retired. A plain prompt goes through the hooks with the old switches set
and reaches no network and gains no extra line. The retired names are assembled
from pieces so this file does not spell them out.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import re
import socket
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

try:
    from .plugin_register_test_support import _ASSET_DIR, _load_plugin_package
except ImportError:
    from plugin_register_test_support import _ASSET_DIR, _load_plugin_package


PLUGIN = Path(_ASSET_DIR)
PROMPT = "Please make this Korean report draft read naturally without the machine-written tone."
_OLD = "j" + "ev"
OLD_SWITCH = "LITHERMES_" + _OLD.upper()
OLD_KEY = "TYPE" + "SAFE_API_KEY"
OLD_HOST = "type" + "safe.ai"
OLD_MODULE = _OLD + "_hint"
RETIRED = re.compile(
    "|".join(re.escape(token) for token in (OLD_SWITCH, OLD_KEY, OLD_HOST, OLD_MODULE, "skill hint ON")),
    re.IGNORECASE,
)
HINT_TEXT = re.compile(rf"(?i){_OLD}|skill hint|lithermes:lit-humanizer")


class _NoNetwork(Exception):
    pass


def _refuse(*_args, **_kwargs):
    raise _NoNetwork("network call attempted")


class NoExternalSkillHint(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name)
        self._env = patch.dict(os.environ, {
            "HERMES_HOME": str(self.home),
            OLD_SWITCH: "1",
            OLD_KEY: "test-key-not-real-0000",
            "LITHERMES_NO_AUTO_UPDATE": "1",
            "LITHERMES_NO_UPDATE_CHECK": "1",
        })
        self._env.start()
        self._cwd = os.getcwd()
        os.chdir(self.home)

    def tearDown(self):
        os.chdir(self._cwd)
        self._env.stop()
        self._tmp.cleanup()

    def test_payload_carries_no_hint_module_switch_or_endpoint(self):
        self.assertFalse((PLUGIN / f"{OLD_MODULE}.py").exists())
        self.assertFalse(hasattr(self.pkg, OLD_MODULE))
        manifest = json.loads((PLUGIN / "payload-version.json").read_text(encoding="utf-8"))
        self.assertNotIn(_OLD, json.dumps(manifest).lower())
        offenders = []
        for path in PLUGIN.rglob("*"):
            if not path.is_file() or path.suffix not in {".py", ".md", ".json", ".yaml", ".js", ".mjs"}:
                continue
            if RETIRED.search(path.read_text(encoding="utf-8", errors="ignore")):
                offenders.append(str(path.relative_to(PLUGIN)))
        self.assertEqual(offenders, [])

    def test_plain_prompt_with_old_switches_makes_no_call_and_gets_no_hint(self):
        out, err = io.StringIO(), io.StringIO()
        with patch.object(urllib.request, "urlopen", _refuse), \
                patch.object(socket, "create_connection", _refuse), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            result = self.pkg._pre_llm_call(session_id="hint-gone", user_message=PROMPT, platform="cli")
            reply = self.pkg._transform_llm_output(session_id="hint-gone", response_text="model reply")
        context = str((result or {}).get("context") or "") if isinstance(result, dict) else str(result or "")
        for text in (context, str(reply or ""), out.getvalue(), err.getvalue()):
            self.assertNotRegex(text, HINT_TEXT)
        self.assertIn(reply, (None, "model reply"))
        self.assertFalse((self.home / "lithermes").exists() and any((self.home / "lithermes").glob(f"{_OLD}-*")))

    def test_status_and_doctor_say_nothing_about_a_skill_hint(self):
        state = self.home / "lithermes"
        state.mkdir()
        leftovers = [state / f"{_OLD}-trace.jsonl", state / f"{_OLD}-last-0123abcd.json"]
        for path in leftovers:
            path.write_text("{}\n", encoding="utf-8")
        diagnostics = __import__(self.pkg.__name__ + ".diagnostics", fromlist=["x"])
        lines, _ = diagnostics.doctor_report("0.21.3")
        self.assertFalse([line for line in lines if HINT_TEXT.search(line)])
        self.assertNotRegex(diagnostics.status_report("0.21.3"), HINT_TEXT)
        self.assertTrue(all(path.exists() for path in leftovers))


if __name__ == "__main__":
    unittest.main()
