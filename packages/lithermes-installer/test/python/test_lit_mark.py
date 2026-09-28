"""Shared geometry, terminal policy and registered Hermes ignition contracts."""
from __future__ import annotations

import importlib
import hashlib
import io
import json
import re
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

try:
    from .plugin_register_test_support import _load_plugin_package, _FakeCtx
except ImportError:
    from plugin_register_test_support import _load_plugin_package, _FakeCtx


class LitMark(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.mark = importlib.import_module(f"{cls.pkg.__name__}.lit_mark")
        cls.env = {"LANG": "en_US.UTF-8", "TERM": "xterm-256color", "COLORTERM": "truecolor"}
        cls.tty = SimpleNamespace(isatty=lambda: True)

    def test_canonical_sizes_glyphs_and_ignition_cell_bytes(self):
        for name, width, height in (("standard", 22, 10), ("banner", 44, 20), ("micro", 16, 5)):
            rows = getattr(self.mark, name)
            self.assertEqual(len(rows), height)
            self.assertEqual(set(map(len, rows)), {width})
            self.assertLessEqual(set("".join(rows)), set("█▀▄▌▐▖▗▘▝▙▛▜▟▚▞ "))
        data_path = Path(self.mark.__file__).with_name("lit_mark_rows.json")
        self.assertEqual(hashlib.sha256(data_path.read_bytes()).hexdigest(),
                         "e7f3e2be168bedc5c15836d105ffed570f3bfd8745522502293de8718f503aec")
        locked = self.mark.lockup("lithermes")
        self.assertEqual(locked[5][30:], "lithermes")
        self.assertEqual(len(locked), 10)
        with self.assertRaises(ValueError):
            self.mark.lockup("bad\nname")

    def test_exact_cell_colors_and_arbitrary_lockup_labels(self):
        palette = {"#FF6337": ("255;99;55", 203), "#D7F75B": ("215;247;91", 191),
                   "#F2EFDF": ("242;239;223", 230)}
        data = json.loads(Path(self.mark.__file__).with_name("lit_mark_rows.json").read_text())
        strip = lambda row: re.sub(r"\x1b\[[0-9;]*m", "", row)
        for size, cells in data.items():
            rows = getattr(self.mark, size)
            for mode in ("none", "256", "truecolor"):
                output = self.mark.colorize(rows, mode=mode)
                self.assertEqual(list(map(strip, output)), rows)
                for row, painted in zip(cells, output):
                    expected = []
                    for ch, color in zip(row["text"], row["colors"]):
                        if mode == "none" or not color:
                            expected.append(ch)
                        else:
                            code = f"38;5;{palette[color][1]}" if mode == "256" else f"38;2;{palette[color][0]}"
                            expected.append(f"\x1b[{code}m{ch}\x1b[0m")
                    self.assertEqual(painted, "".join(expected))
        for name in ("custom-agent", "Hermes 2.0 · local", "lithermes v2.3.4"):
            locked = self.mark.lockup(name, self.mark.banner)
            self.assertEqual(locked[10][52:], name)
            for mode in ("256", "truecolor"):
                painted = self.mark.colorize(locked, mode=mode)
                self.assertEqual(list(map(strip, painted)), locked)
                self.assertTrue(painted[10].endswith(name))
        self.assertEqual(self.mark.colorize(self.mark.standard, mode="truecolor", shadow="#123456"),
                         self.mark.colorize(self.mark.standard, mode="truecolor"))

    def test_slash_acknowledgement_uses_the_three_stop_truecolor_gradient(self):
        output = self.mark.acknowledgement("litwork", color=True, env=self.env, stream=self.tty)
        strip = lambda value: re.sub(r"\x1b\[[0-9;]*m", "", value)
        rows = [row.rstrip() for row in self.mark.micro]
        width = max(map(len, rows))
        expected = [row.ljust(width) for row in rows]
        expected[len(expected) // 2] += "  🔥 LIT IGNITED · litwork 🔥"

        self.assertEqual([strip(row) for row in output.splitlines()], expected)
        self.assertTrue(output.startswith("\x1b[1m\x1b[38;2;255;99;55m▗\x1b[0m"))
        self.assertTrue(output.splitlines()[len(self.mark.micro) // 2].endswith("\x1b[1m\x1b[38;2;0;229;255mk\x1b[0m 🔥"))
        self.assertNotRegex(output, r"\x1b\[[0-9;]*m🔥")
        self.assertEqual(output.count("\x1b[1m"), output.count("\x1b[0m"))
        self.assertEqual(output.count("\x1b[1m"), sum(char not in {" ", "\n", "🔥"} for char in strip(output)))

    def test_slash_acknowledgement_uses_nearest_256_color_stops(self):
        env = {key: value for key, value in self.env.items() if key != "COLORTERM"}
        output = self.mark.acknowledgement("litwork", color=True, env=env, stream=self.tty)

        self.assertTrue(output.startswith("\x1b[1m\x1b[38;5;203m▗\x1b[0m"))
        self.assertIn("\x1b[1m\x1b[38;5;198mD\x1b[0m", output)
        self.assertTrue(output.splitlines()[len(self.mark.micro) // 2].endswith("\x1b[1m\x1b[38;5;45mk\x1b[0m 🔥"))
        self.assertNotRegex(output, r"\x1b\[[0-9;]*m🔥")
        self.assertEqual(output.count("\x1b[1m"), output.count("\x1b[0m"))

    def test_acknowledgement_plain_policy_and_non_utf8_fallback(self):
        cases = (
            ({**self.env, "NO_COLOR": ""}, self.tty),
            ({**self.env, "CI": "true"}, self.tty),
            (self.env, SimpleNamespace(isatty=lambda: False)),
        )
        for env, stream in cases:
            output = self.mark.acknowledgement("litwork", color=True, env=env, stream=stream)
            self.assertNotIn("\x1b", output)
            self.assertIn("🔥 LIT IGNITED · litwork 🔥", output)
        fallback = self.mark.acknowledgement(
            "litwork", color=True, env={"LANG": "C", "TERM": "xterm-256color"}, stream=self.tty
        )
        self.assertEqual(fallback, "LIT\n🔥 LIT IGNITED · litwork 🔥")

    def test_probe_and_harness_lines_keep_their_exact_rendering(self):
        self.assertEqual(self.mark.probe_line("litwork"), "🔥 **LIT IGNITED · litwork** 🔥")
        self.assertEqual(self.mark.harness_banner("litwork"), "🔥 LIT IGNITED · litwork 🔥")
        contract = self.mark.probe_contract("lit-handoff")
        self.assertIn("`🔥 **LIT IGNITED · lit-handoff** 🔥`\n", contract)
        self.assertIn("on its own first line", contract)
        self.assertNotIn("without markup", contract)

    def test_js_python_rows_color_and_lockup_byte_parity(self):
        module = Path(__file__).parents[2] / "src/lib/litMark.js"
        script = """const m = require(process.argv[1]);
process.stdout.write(JSON.stringify({
  standard: m.standard, banner: m.banner, micro: m.micro,
  lockup: m.lockup('lithermes'), skin: m.skinLogo().join('\\n'),
  colors: ['none', '256', 'truecolor'].map(mode => m.colorize(m.banner, {mode}))
}));"""
        result = subprocess.run(["node", "-e", script, str(module)], capture_output=True, text=True, check=True)
        js = json.loads(result.stdout)
        for size in ("standard", "banner", "micro"):
            self.assertEqual(js[size], getattr(self.mark, size))
        self.assertEqual(js["lockup"], self.mark.lockup("lithermes"))
        self.assertEqual(js["skin"], self.mark.skin_logo(env=self.env, stream=self.tty))
        for mode, expected in zip(("none", "256", "truecolor"), js["colors"]):
            self.assertEqual(expected, self.mark.colorize(self.mark.banner, {"mode": mode}))
        indexed_skin = self.mark.skin_logo(env={"TERM": "xterm-256color"}, stream=self.tty)
        for code in (203, 191, 230):
            self.assertIn(f"[color({code})]", indexed_skin)
        self.assertEqual(re.sub(r"\[[^\]]*\]", "", indexed_skin), "\n".join(self.mark.standard))

    def test_color_policy_and_plain_wordmark_fallback(self):
        self.assertEqual(self.mark.color_mode(env=self.env, stream=self.tty), "truecolor")
        self.assertEqual(self.mark.color_mode(env={"TERM": "xterm-256color"}, stream=self.tty), "256")
        for extra in ({"NO_COLOR": ""}, {"CI": "true"}, {"CI": ""}):
            env = {**self.env, **extra}
            self.assertEqual(self.mark.color_mode(env=env, stream=self.tty), "none")
            self.assertEqual(self.mark.render(self.mark.banner, env=env, stream=self.tty), self.mark.banner)
            self.assertEqual(self.mark.skin_logo(env=env, stream=self.tty), "\n".join(self.mark.standard))
        self.assertEqual(self.mark.color_mode(env=self.env, stream=io.StringIO()), "none")
        self.assertEqual(self.mark.color_mode(env=self.env, stream=self.tty, json=True), "none")
        self.assertEqual(self.mark.colorize(self.mark.standard, mode="none"), self.mark.standard)
        for env in ({"LANG": "C"}, {"LC_ALL": "POSIX", "LANG": "en_US.UTF-8"}, {"TERM": "dumb"}):
            self.assertEqual(self.mark.render(self.mark.banner, env=env, stream=self.tty), ["LIT"])
            self.assertEqual(self.mark.skin_logo(env=env, stream=self.tty), "LIT")
        with self.assertRaises(ValueError):
            self.mark.colorize(self.mark.standard, mode="invalid")

    def test_registered_commands_acknowledge_canonical_discipline_and_require_probe(self):
        ctx = _FakeCtx()
        self.pkg.register(ctx)
        for command in (
            "lit-humanizer",
            "lit-korean",
            "korean-ai-slop-remover",
            "text-naturalization",
            "text-neutralization",
        ):
            result = ctx.command_handlers[command]("문장을 다듬어 주세요.")
            self.assertIn("🔥 LIT IGNITED · lit-humanizer 🔥", re.sub(r"\x1b\[[0-9;]*m", "", result["display"]))
            self.assertNotIn("🔥 **LIT IGNITED ·", result["display"])
            self.assertIn("🔥 **LIT IGNITED · lit-humanizer** 🔥", result["agent_message"])

    def test_natural_aliases_use_current_probe_and_consume_the_mark_once(self):
        for old, new in (("hyperplan", "lit-crucible"), ("init-deep", "lit-init"),
                         ("git-master", "lit-commit"), ("remove-ai-slops", "lit-burnoff"),
                         ("ai-slop-remover", "lit-burnoff-file"),
                         ("lit-korean", "lit-humanizer"),
                         ("text-naturalization", "lit-humanizer"),
                         ("text-neutralization", "lit-humanizer"),
                         ("korean-ai-slop-remover", "lit-humanizer"), ("programming", "lit-code")):
            session = "mark-" + old
            result = self.pkg.core.pre_llm_call(user_message=old + " inspect target", session_id=session, platform="cli")
            probe = self.mark.probe_line(new)
            self.assertIn(probe, result["context"])
            reply = probe + "\nCompleted."
            rendered = self.pkg.core.transform_llm_output(response_text=reply, session_id=session)
            label = "🔥 LIT IGNITED · " + new + " 🔥"
            self.assertIn(label, re.sub(r"\x1b\[[0-9;]*m", "", rendered))
            self.assertTrue(rendered.startswith(reply))
            self.assertNotIn("```", rendered)
            suffix = "\n".join(f"    {row}" for row in self.mark.acknowledgement(new).splitlines())
            self.assertTrue(rendered.endswith("\n\n" + suffix))
            self.assertEqual(re.sub(r"\x1b\[[0-9;]*m", "", rendered).count(label), 1)
            self.assertNotIn("\x1b", rendered)
            self.assertEqual(rendered.count(probe), 1)
            self.assertIsNone(self.pkg.core.transform_llm_output(response_text="next", session_id=session))

    def test_goal_bootstrap_cannot_override_the_public_route_probe(self):
        bootstrap = self.pkg.core.contract_route_block("goal-instruction", surface="goal-bootstrap")
        self.assertNotIn("🔥 **LIT IGNITED ·", bootstrap)
        for route in ("lit-plan", "lit-loop", "litwork"):
            context = self.pkg.core.contract_route_block(route, surface="run-context") + "\n" + bootstrap
            self.assertEqual(context.count("🔥 **LIT IGNITED ·"), 1)
            self.assertIn(f"`🔥 **LIT IGNITED · {route}** 🔥`", context)

    def test_model_probe_instruction_is_inert_to_natural_routing(self):
        for route in ("lit-humanizer", "lit-korean", "lit-recap", "deep-interview", "lit-handoff"):
            self.assertIsNone(self.pkg.core.detect_lit_mode(self.mark.probe_contract(route)))

    def test_native_markdown_keeps_micro_rows_and_model_probe_separate(self):
        try:
            from rich.console import Console
            from rich.markdown import Markdown
        except ImportError:
            self.skipTest("native Hermes rendering needs the host's optional Rich dependency")

        probe = self.mark.probe_line("lit-handoff")
        response = probe + "\n\nReady."
        with patch.dict("os.environ", {"TERM": "xterm-256color", "LC_ALL": "en_US.UTF-8"}):
            rendered = self.mark.acknowledge_reply("lit-handoff", response)
            expected_rows = self.mark.acknowledgement("lit-handoff").splitlines()
        self.assertTrue(rendered.startswith(response))
        self.assertNotIn("```", rendered)
        suffix = "\n".join(f"    {row}" for row in expected_rows)
        self.assertTrue(rendered.endswith("\n\n" + suffix))
        output = io.StringIO()
        Console(file=output, width=100, color_system=None).print(Markdown(rendered))
        visible = output.getvalue()
        for row in expected_rows:
            self.assertIn(row, visible)
        self.assertEqual(visible.count(probe.replace("**", "")), 2)

    def test_acknowledgement_is_an_append_only_indented_suffix(self):
        response = "ready\nplain"
        mark = self.mark.acknowledgement("litwork")
        suffix = "\n".join(f"    {row}" for row in mark.splitlines())
        rendered = self.mark.acknowledge_reply("litwork", response)
        self.assertEqual(rendered, f"{response}\n\n{suffix}")
        self.assertTrue(rendered.startswith(response))
        self.assertNotIn("```", rendered)
        self.assertEqual(rendered.splitlines()[-len(mark.splitlines()):], suffix.splitlines())

        empty = self.mark.acknowledge_reply("litwork", "")
        self.assertEqual(empty, suffix)
        with patch.object(self.mark, "color_mode", return_value="truecolor"):
            colored_environment_reply = self.mark.acknowledge_reply("litwork", response)
        self.assertNotIn("\x1b", colored_environment_reply)

    def test_block_replacement_does_not_append_denial_to_unsafe_body(self):
        session = "append-only-block"
        denial = "Request denied by bounded policy."
        self.pkg.core._PENDING_IGNITE.add(session)
        self.pkg.core._PENDING_BLOCK[session] = denial
        rendered = self.pkg.core.transform_llm_output(
            response_text="unsafe body must never be replayed", session_id=session
        )
        suffix = "\n".join(f"    {row}" for row in self.mark.acknowledgement("litwork").splitlines())
        self.assertNotIn("unsafe body must never be replayed", rendered)
        self.assertIn(denial, rendered)
        self.assertTrue(rendered.endswith(suffix))

    def test_welcome_uses_native_skin_without_printing_an_extra_session_banner(self):
        skin = SimpleNamespace(banner_logo="before")
        engine = SimpleNamespace(get_active_skin=lambda: skin, get_active_skin_name=lambda: "lithermes-orange")
        with patch.dict("sys.modules", {"hermes_cli.skin_engine": engine}), patch.dict("os.environ", {"TERM": "dumb"}):
            self.mark.configure_welcome_skin()
            self.assertEqual(skin.banner_logo, "LIT")
        engine.get_active_skin_name = lambda: "custom-user-skin"
        skin.banner_logo = "user-owned"
        with patch.dict("sys.modules", {"hermes_cli.skin_engine": engine}):
            self.mark.configure_welcome_skin()
        self.assertEqual(skin.banner_logo, "user-owned")
