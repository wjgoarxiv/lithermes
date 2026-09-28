"""Plugin registration wiring and CLI surfaces."""

from __future__ import annotations

import contextlib
import io
import os
import unittest

import yaml

try:
    from .plugin_register_test_support import _ASSET_DIR, _FakeCtx, _load_plugin_package
except ImportError:
    from plugin_register_test_support import _ASSET_DIR, _FakeCtx, _load_plugin_package

class RegisterWiring(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.ctx = _FakeCtx()
        cls.pkg.register(cls.ctx)

    def test_pre_llm_call_hook_registered(self):
        self.assertIn("pre_llm_call", self.ctx.hooks)

    def test_subagent_stop_hook_registered(self):
        self.assertIn("subagent_stop", self.ctx.hooks)

    def test_plugin_yaml_hooks_match_registered_hooks(self):
        with open(os.path.join(_ASSET_DIR, "plugin.yaml"), encoding="utf-8") as handle:
            yaml_text = handle.read()
        declared = []
        in_hooks = False
        for line in yaml_text.splitlines():
            if line.strip() == "hooks:":
                in_hooks = True
                continue
            if in_hooks:
                stripped = line.strip()
                if stripped.startswith("- "):
                    declared.append(stripped[2:].strip())
                elif stripped and not line.startswith(" "):
                    break
        valid_hooks = {
            "pre_tool_call", "post_tool_call", "transform_terminal_output",
            "transform_tool_result", "transform_llm_output", "pre_llm_call",
            "pre_command",
            "post_llm_call", "pre_api_request", "post_api_request",
            "on_session_start", "on_session_end", "on_session_finalize",
            "on_session_reset", "subagent_stop", "pre_gateway_dispatch",
            "pre_approval_request", "post_approval_response",
        }
        expected = [
            "on_session_start",
            "pre_llm_call",
            "pre_tool_call",
            "pre_command",
            "post_tool_call",
            "post_api_request",
            "subagent_stop",
            "transform_llm_output",
            "on_session_finalize",
            "on_session_reset",
        ]
        self.assertEqual(declared, expected, "plugin.yaml hooks must match the exact public hook surface")
        self.assertEqual(
            self.ctx.hooks,
            [hook for hook in expected if hook != "pre_command"],
            "legacy contexts must omit the optional native command hook",
        )
        self.assertEqual(tuple(expected), self.pkg.core.HOOKS, "status HOOKS must stay in sync")
        self.assertTrue(set(declared) <= valid_hooks, f"declared hooks not all valid: {set(declared) - valid_hooks}")

    def test_plugin_yaml_capabilities_match_native_registration(self):
        """The catalog-facing declarations must track the real native context surface."""
        with open(os.path.join(_ASSET_DIR, "plugin.yaml"), encoding="utf-8") as handle:
            manifest = yaml.safe_load(handle)
        native = _NativeCtx()
        self.pkg.register(native)
        self.assertEqual(
            manifest.get("provides_tools"),
            [tool["name"] for tool in native.tools],
            "plugin.yaml provides_tools must match every tool registered by register(ctx)",
        )
        self.assertEqual(
            manifest.get("provides_hooks"),
            native.hooks,
            "plugin.yaml provides_hooks must match every hook registered by register(ctx)",
        )

    def test_goal_tools_registered(self):
        names = {t["name"] for t in self.ctx.tools}
        for required in ["goal_status", "goal_set", "goal_evidence", "goal_complete"]:
            self.assertIn(required, names)
        self.assertIn("lithermes_work_progress", names)
        self.assertIn("lithermes_knowledge_capture", names)
        self.assertTrue(
            all(
                t["toolset"] in {"lithermes-goal", "lithermes-work", "lithermes-knowledge"}
                for t in self.ctx.tools
            )
        )

    def test_cli_and_slash_commands_registered(self):
        self.assertIn("lithermes", self.ctx.cli_commands)
        for cmd in [
            "lit-plan",
            "lit",
            "lit-loop",
            "litgoal",
            "review-work",
            "start-work",
            "deep-interview",
            "lit-humanizer",
            "lit-korean",
            "text-naturalization",
            "text-neutralization",
            "korean-ai-slop-remover",
            "lit-handoff",
            "lit-scientific-visualization",
        ]:
            self.assertIn(cmd, self.ctx.commands)
            self.assertEqual(self.ctx.commands.count(cmd), 1)

    def test_all_skills_registered(self):
        names = {n for n, _ in self.ctx.skills}
        for skill in [
            "review-work",
            "litgoal",
            "litwork",
            "lit-code",
            "debugging",
            "deep-interview",
            "lit-commit",
            "lit-crucible",
            "lit-init",
            "visual-qa",
            "lsp-setup",
            "litresearch",
            "lit-humanizer",
            "lit-handoff",
            "lit-scientific-visualization",
        ]:
            self.assertIn(skill, names)
        for _, path in self.ctx.skills:
            self.assertTrue(os.path.exists(path), f"missing SKILL.md: {path}")
        self.assertNotIn("lit-korean", names, "the legacy skill id must not be registered")

    def test_status_lists_canonical_humanizer_command_and_skill(self):
        report = self.pkg.core.status_report()
        for token in (
            "/lit-humanizer",
            "/lit-korean",
            "/text-naturalization",
            "/text-neutralization",
            "/korean-ai-slop-remover",
            "lit-humanizer",
        ):
            self.assertIn(token, report)
        skill_line = next(line for line in report.splitlines() if line.startswith("skills ("))
        self.assertIn("lit-humanizer", skill_line)
        self.assertNotIn("lit-korean", skill_line)

    def test_humanizer_command_help_covers_korean_and_english(self):
        spec = self.ctx.command_specs["lit-humanizer"]
        self.assertIn("Korean or English", spec["description"])
        self.assertEqual("[Korean or English text]", spec["args_hint"])

    def test_uiux_and_visualqa_registration_characterization(self):
        """Current Hermes registration exposes both qualified skill entrypoints."""
        registered = {name: path for name, path in self.ctx.skills}
        expected = {
            "frontend-ui-ux": os.path.join(
                _ASSET_DIR, "skills", "frontend-ui-ux", "SKILL.md"
            ),
            "visual-qa": os.path.join(
                _ASSET_DIR, "skills", "visual-qa", "SKILL.md"
            ),
        }
        for name, path in expected.items():
            with self.subTest(skill=f"lithermes:{name}"):
                self.assertIn(name, registered)
                self.assertEqual(os.path.realpath(registered[name]), os.path.realpath(path))
                self.assertTrue(os.path.isfile(path))

    def test_composed_pre_llm_call_merges_litwork_directive(self):
        out = self.pkg._pre_llm_call(user_message="please lit build the thing", session_id="s", platform="cli")
        self.assertIsInstance(out, dict)
        self.assertIn("litwork", out["context"].lower())

    def test_subagent_turns_never_reactivate_lithermes_context(self):
        message = "lit-crucible read-only lane: inspect this repo, then lit review"
        self.assertIsNone(
            self.pkg._pre_llm_call(user_message=message, session_id="child", platform="subagent")
        )
        self.assertIsNone(
            self.pkg.core.pre_llm_call(user_message=message, session_id="child", platform="subagent")
        )


class _NativeCtx(_FakeCtx):
    def __init__(self, inject_result=True):
        super().__init__()
        self.hook_handlers = {}
        self.inject_result = inject_result
        self.injected = []

    def register_hook(self, name, cb):
        super().register_hook(name, cb)
        self.hook_handlers[name] = cb

    def inject_message(self, content, *, role="user", session_key=None):
        self.injected.append(
            {"content": content, "role": role, "session_key": session_key}
        )
        return self.inject_result


class NativeCommandDispatch(unittest.TestCase):
    def _registered(self, inject_result=True):
        pkg = _load_plugin_package()
        original = pkg.core.command_lit_plan
        self.addCleanup(setattr, pkg.core, "command_lit_plan", original)
        pkg.core.command_lit_plan = lambda raw: {
            "display": "plan display",
            "agent_message": f"plan body: {raw}",
        }
        ctx = _NativeCtx(inject_result=inject_result)
        pkg.register(ctx)
        return pkg, ctx

    def _prime(self, ctx, *, surface, session_key):
        self.assertIn("pre_command", ctx.hook_handlers)
        ctx.hook_handlers["pre_command"](
            surface=surface,
            command="lit-plan",
            alias_used="lit-plan",
            args_raw="small plan",
            session_key=session_key,
        )

    def test_cli_command_uses_native_injection_and_returns_display(self):
        _, ctx = self._registered()
        self._prime(ctx, surface="cli", session_key="cli-session")

        result = ctx.command_handlers["lit-plan"]("small plan")

        self.assertIsInstance(result, str)
        self.assertIn("plan display", result)
        self.assertNotIn("agent_message", result)
        self.assertNotIn("{", result)
        self.assertEqual(len(ctx.injected), 1)
        self.assertEqual(ctx.injected[0]["role"], "user")
        self.assertEqual(ctx.injected[0]["session_key"], "cli-session")
        self.assertIn("plan body: small plan", ctx.injected[0]["content"])

    def test_gateway_denial_is_human_readable_and_precise(self):
        _, ctx = self._registered(inject_result=False)
        self._prime(ctx, surface="gateway", session_key="gateway-session")

        result = ctx.command_handlers["lit-plan"]("small plan")

        self.assertIsInstance(result, str)
        self.assertIn("plan display", result)
        self.assertIn("allow_gateway_injection", result)
        self.assertIn("does not enable that setting", result)
        self.assertNotIn("agent_message", result)
        self.assertNotIn("{", result)

    def test_gateway_native_injection_returns_display_without_dict_repr(self):
        _, ctx = self._registered(inject_result=True)
        self._prime(ctx, surface="gateway", session_key="gateway-session")

        result = ctx.command_handlers["lit-plan"]("small plan")

        self.assertEqual(len(ctx.injected), 1)
        self.assertEqual(ctx.injected[0]["session_key"], "gateway-session")
        self.assertEqual(result.count("plan display"), 1)
        self.assertNotIn("{", result)

    def test_legacy_context_keeps_structured_payload_for_source_patch(self):
        pkg = _load_plugin_package()
        original = pkg.core.command_lit_plan
        self.addCleanup(setattr, pkg.core, "command_lit_plan", original)
        pkg.core.command_lit_plan = lambda raw: {
            "display": "plan display",
            "agent_message": f"plan body: {raw}",
        }
        ctx = _FakeCtx()
        pkg.register(ctx)

        result = ctx.command_handlers["lit-plan"]("small plan")

        self.assertIsInstance(result, dict)
        self.assertIn("agent_message", result)
        self.assertNotIn("pre_command", ctx.hooks)


class SessionStartNudge(unittest.TestCase):
    """ADR-001: helper-agent visibility points at the host-native /agents surface."""

    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()

    def _run_session_start(self, isatty: bool, platform: str = "cli") -> str:
        class _Stream(io.StringIO):
            def isatty(self) -> bool:  # noqa: D102 - test double
                return isatty

        stream = _Stream()
        with contextlib.redirect_stdout(stream):
            self.pkg.core.on_session_start(session_id="nudge-session", platform=platform)
        return stream.getvalue()

    def test_cli_tty_session_start_prints_the_agents_hint(self):
        self.assertIn("helper agents: type /agents", self._run_session_start(True))

    def test_non_tty_session_start_stays_silent(self):
        self.assertEqual(self._run_session_start(False), "")

    def test_non_cli_platforms_stay_silent_even_on_a_tty(self):
        for platform in ("", "tui", "gateway", "telegram", "subagent"):
            self.assertEqual(self._run_session_start(True, platform), "", platform)


class CliSurface(unittest.TestCase):
    """`hermes lithermes` must expose version / status / doctor, not just goal."""

    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.core = cls.pkg.core

    def test_plugin_version_reads_yaml(self):
        self.assertRegex(self.core.plugin_version(), r"^\d+\.\d+\.\d+")

    def test_version_line(self):
        line = self.core.version_line()
        self.assertIn("lithermes", line)
        self.assertIn(self.core.plugin_version(), line)

    def test_status_report_shows_versions_and_surfaces(self):
        r = self.core.status_report()
        self.assertIn(self.core.plugin_version(), r)
        self.assertIn("Hermes", r)  # host runtime line
        self.assertIn("provider cache metrics: CAPABLE", r)
        self.assertIn("live cache hit: UNPROVEN", r)
        for h in (
            "on_session_start",
            "pre_llm_call",
            "pre_tool_call",
            "post_tool_call",
            "post_api_request",
            "subagent_stop",
            "transform_llm_output",
            "on_session_finalize",
            "on_session_reset",
        ):
            self.assertIn(h, r)
        self.assertIn("skills (36)", r)  # motion skill is enrolled
        for k in ("red", "green", "scenario", "cleanup", "note"):
            self.assertIn(k, r)  # evidence-kind discovery (#6)

    def test_doctor_passes_on_healthy_tree(self):
        lines, code = self.core.doctor_report()
        self.assertEqual(code, 0, "\n".join(lines))
        self.assertTrue(any("plugin.yaml" in l for l in lines))
        self.assertIn("[OK] lit-diagram-drawer entrypoint present", lines)

    def test_cli_setup_registers_version_status_doctor(self):
        import argparse
        p = argparse.ArgumentParser(prog="lithermes")
        self.pkg._setup_lithermes_cli(p)
        for sub in ("version", "status", "doctor"):
            self.assertEqual(getattr(p.parse_args([sub]), "lh_cmd"), sub)
        self.assertEqual(getattr(p.parse_args(["goal", "status"]), "lh_cmd"), "goal")
        self.assertTrue(getattr(p.parse_args(["--version"]), "version"))
        help_text = p.format_help()
        for command in (
            "/lit-humanizer",
            "/lit-korean",
            "/text-naturalization",
            "/text-neutralization",
            "/korean-ai-slop-remover",
        ):
            self.assertIn(command, help_text)

    def test_handle_version_and_status_and_doctor(self):
        import argparse, io, contextlib
        for ns, needle in [
            (argparse.Namespace(version=True, lh_cmd=None), "lithermes"),
            (argparse.Namespace(version=False, lh_cmd="version"), self.core.plugin_version()),
            (argparse.Namespace(version=False, lh_cmd="status"), "Hermes"),
            (argparse.Namespace(version=False, lh_cmd="doctor"), "plugin.yaml"),
        ]:
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = self.pkg._handle_lithermes_cli(ns)
            self.assertEqual(rc, 0, buf.getvalue())
            self.assertIn(needle, buf.getvalue())

    def test_evidence_kinds_in_sync_with_litgoal(self):
        # status lists kinds; they must match the runtime's EVIDENCE_KINDS source
        from importlib import import_module
        model = import_module("lithermes_plugin_pkg.litgoal.model")
        r = self.core.status_report()
        for k in model.EVIDENCE_KINDS:
            self.assertIn(k, r)


if __name__ == "__main__":
    unittest.main()
