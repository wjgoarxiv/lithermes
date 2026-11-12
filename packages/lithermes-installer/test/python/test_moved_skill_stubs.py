"""The five moved families: every route and command still reaches a same-name stub."""

from __future__ import annotations

from pathlib import Path

from natural_routing_test_support import NaturalRoutingCase, _ASSET_DIR
from plugin_register_test_support import _FakeCtx

MOVED = {
    "lit-pptx": "decks",
    "lit-docx": "documents",
    "lit-diagram-drawer": "figures",
    "lit-schematic": "figures",
    "lit-scientific-visualization": "figures",
    "frontend-ui-ux": "design",
    "visual-qa": "design",
    "lit-typographic-motion": "video-covers",
    "readme-studio": "video-covers",
}
# The old copy line: it merged a new copy into an existing skills/<id>/ folder.
MERGING_COPY = '"${HERMES_HOME:-$HOME/.hermes}/skills/"'
# Instructions that only the old bodies carried. A stub route must not keep any of them.
STALE_BODY_LINES = (
    "thirteen tonalities",
    "six tonalities",
    "Motion CLI:",
    "Subcommands: $M",
    "qa.mjs until QA PASS",
    "Installed schematic entrypoint",
    "source_skill:",
    "figure_export_script",
    "<lithermes-original-skill",
    "Python checks, source-preservation",
    "design_contract_validation",
    "capture_sha256",
    "IMAGE_GENERATION_UNAVAILABLE",
)
SLASH = {
    "lit-pptx": "Quarterly results deck",
    "lit-docx": "Safety study report",
    "lit-diagram-drawer": "Billing request flow",
    "lit-schematic": "Heat exchanger P&ID",
    "lit-scientific-visualization": "Isotherm plot",
    "lit-typographic-motion": "Ten second launch film",
}
BARE = {
    "lit-pptx": "lit make a 10-slide deck for the launch",
    "lit-docx": "lit Write a report on the safety study",
    "lit-diagram-drawer": "lit draw a deployment diagram",
    "lit-schematic": "lit-schematic draw a shell and tube heat exchanger",
    "frontend-ui-ux": "frontend-ui-ux build a pricing page",
    "visual-qa": "visual-qa check the pricing page",
    "lit-typographic-motion": "lit from lyrics.txt make a lyric video",
    "readme-studio": "readme-studio write the README for this repo",
}


def _stub(name: str) -> str:
    return (Path(_ASSET_DIR) / "skills" / name / "SKILL.md").read_text(encoding="utf-8")


class MovedSkillStubs(NaturalRoutingCase):
    def _contract(self):
        """The plugin's core_contract submodule, where the install lines live."""
        import importlib

        return importlib.import_module(f"{self.pkg.__name__}.core_contract")

    def _assert_stub_context(self, name: str, context: str) -> None:
        self.assertIn(f"variants/lithermes/{name}", context)
        self.assertIn(self._contract().extension_command_line(name), context)
        self.assertIn(f'the five under "Install for Hermes" in skill_view("lithermes:{name}")', context)
        self.assertNotIn(MERGING_COPY, context)
        self.assertNotIn(f"plugins/{MOVED[name]}/", context)
        for stale in STALE_BODY_LINES:
            self.assertNotIn(stale, context)

    def test_each_stub_names_the_repository_path_and_the_hermes_copy_line(self):
        for name, family in MOVED.items():
            with self.subTest(skill=name):
                text = _stub(name)
                self.assertIn(f"name: {name}\n", text)
                self.assertIn("wjgoarxiv-skills", text)
                self.assertIn(f"variants/lithermes/{name}", text)
                self.assertIn(self._contract().extension_command_line(name), text)
                for line in self._contract().extension_install_lines(name):
                    self.assertIn(line, text)
                self.assertIn(self._contract().EXTENSION_REMOVE_LINE, text)
                self.assertNotIn(MERGING_COPY, text)
                self.assertNotIn(f"plugins/{family}", text)
                self.assertNotIn("Claude", text)
                self.assertNotIn("Use one form or the other", text)
                self.assertIn("extension-backups/", text)
                self.assertIn(f'skill_view("{name}")', text)
                self.assertNotIn("/Users/", text)
                self.assertNotIn("/home/", text)
        self.assertIn(
            "variants/lithermes/lit-scientific-visualization/vendor/scientific-visualization",
            _stub("lit-scientific-visualization"),
        )

    def test_slash_commands_stay_registered_and_inject_the_stub(self):
        ctx = _FakeCtx()
        self.pkg.register(ctx)
        registered = [value for value, _ in ctx.skills]
        for name in MOVED:
            with self.subTest(skill=name):
                self.assertIn(name, registered)
        for name, brief in SLASH.items():
            with self.subTest(command=name):
                self.assertIn(name, ctx.commands)
                message = ctx.command_handlers[name](brief)
                self._assert_stub_context(name, message["agent_message"])
                self.assertIn("LitFamily extension", message["display"])

    def test_natural_routes_still_route_to_the_stub_without_old_body_lines(self):
        for name, prompt in BARE.items():
            with self.subTest(skill=name):
                result = self._hook(prompt, session=f"moved-{name}")
                context = result["context"]
                self.assertIn(f'mode="{name}"', context)
                self._assert_stub_context(name, context)

    def test_exact_scientific_visualization_route_no_longer_inlines_the_source(self):
        for prompt in ("lit-scientific-visualization", "lit scientific visualization"):
            with self.subTest(prompt=prompt):
                context = self.pkg.scientific_visualization.pre_llm_call(
                    user_message=prompt, session_id="sv", platform="cli"
                )["context"]
                self._assert_stub_context("lit-scientific-visualization", context)

    def test_skill_index_keeps_every_moved_id_and_calls_it_an_extension(self):
        section = self.pkg.skill_index_section()
        for name in MOVED:
            with self.subTest(skill=name):
                line = next(row for row in section.splitlines() if row.startswith(f"- {name}:"))
                self.assertIn("LitFamily extension", line)
        self.assertLessEqual(len(section), self.pkg.SKILL_INDEX_MAX_CHARS)

    def test_runtimes_only_the_moved_skills_used_are_gone(self):
        root = Path(_ASSET_DIR)
        for gone in ("motion_receipts.py", "uiux_runtime_common.py", "vendor/scientific-visualization"):
            with self.subTest(path=gone):
                self.assertFalse((root / gone).exists())
        for name in MOVED:
            kept = sorted(
                str(path.relative_to(root / "skills" / name))
                for path in (root / "skills" / name).rglob("*")
                if path.is_file() and "__pycache__" not in path.parts
            )
            with self.subTest(skill=name):
                expected = ["SKILL.md"]
                if name == "frontend-ui-ux":
                    expected = sorted(
                        [
                            "SKILL.md",
                            "references/craft-floor.md",
                            "references/slop-register.md",
                            "scripts/hostexec.mjs",
                            "scripts/probe-page.js",
                            "scripts/probe-rules.json",
                            "scripts/probe.mjs",
                        ]
                    )
                self.assertEqual(kept, expected)

    def test_doctor_keeps_the_entrypoint_lines_and_drops_the_runtime_lines(self):
        lines, _code = self.pkg.core.doctor_report()
        report = "\n".join(lines)
        for name in ("lit-diagram-drawer", "lit-schematic", "lit-pptx", "lit-docx", "lit-typographic-motion"):
            with self.subTest(skill=name):
                self.assertIn(f"[OK] {name} entrypoint present", report)
        for gone in ("Office runtime", "motion Chrome", "motion pre-warm", "scientific visualization: "):
            with self.subTest(line=gone):
                self.assertNotIn(gone, report)


if __name__ == "__main__":
    import unittest

    unittest.main()
