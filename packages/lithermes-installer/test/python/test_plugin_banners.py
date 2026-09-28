"""LitHermes visible banner and transform-hook behavior."""

from __future__ import annotations

import os
import re
import unittest

try:
    from .plugin_register_test_support import _ASSET_DIR, _FakeCtx, _load_plugin_package
except ImportError:
    from plugin_register_test_support import _ASSET_DIR, _FakeCtx, _load_plugin_package

class LitMarkActivation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.ctx = _FakeCtx()
        cls.pkg.register(cls.ctx)

    def test_banner_constant_present(self):
        self.assertIn("🔥 **LIT IGNITED · litwork** 🔥", self.pkg.core.LIT_PROBE_LINE)

    def test_named_harness_banners_use_plain_ignition_text(self):
        self.assertEqual(self.pkg.handoff.HANDOFF_BANNER, "🔥 LIT IGNITED · lit-handoff 🔥")
        self.assertEqual(
            self.pkg.scientific_visualization.SCIENCE_BANNER,
            "🔥 LIT IGNITED · lit-scientific-visualization 🔥",
        )

    def test_ignite_helper_prepends_banner(self):
        ignite = self.pkg.core.ignite
        self.assertIn("🔥 LIT IGNITED · litwork 🔥", re.sub(r"\x1b\[[0-9;]*m", "", ignite({"display": "hi", "agent_message": "x"})["display"]))
        self.assertIn("🔥 LIT IGNITED · litwork 🔥", re.sub(r"\x1b\[[0-9;]*m", "", ignite("plain string result")))
        # empty/None displays are left untouched (nothing to ignite)
        self.assertNotIn("display", ignite({"agent_message": "x"}))
        self.assertIn("🔥 **LIT IGNITED · litwork** 🔥", ignite({"agent_message": "x"})["agent_message"])

    def test_sideeffect_free_commands_display_ignites(self):
        # Deterministic user-visible channel: every registered display carries the banner.
        samples = {
            "litgoal": "ship it",
            "review-work": "--base HEAD~1",
            "start-work": "nope --dry-run",
            "deep-interview": "a vague idea",
        }
        for name, args in samples.items():
            handler = self.ctx.command_handlers.get(name)
            self.assertIsNotNone(handler, f"{name} not registered")
            result = handler(args)
            display = result.get("display") if isinstance(result, dict) else str(result)
            plain = re.sub(r"\x1b\[[0-9;]*m", "", display)
            self.assertIn(f"🔥 LIT IGNITED · {name} 🔥", plain, f"/{name} display missing mark")

    def test_run_commands_are_banner_wrapped(self):
        # lit / lit-loop / lit-plan mutate state (run-state / plan file); just
        # confirm the registered handler is the banner wrapper, not the raw fn.
        for name, fn in (("lit", "command_lit"), ("lit-loop", "command_lit_loop"), ("lit-plan", "command_lit_plan")):
            self.assertIsNot(self.ctx.command_handlers[name], getattr(self.pkg.core, fn),
                             f"/{name} is not banner-wrapped")

    def test_keyword_context_instructs_banner(self):
        # Best-effort: the injected litwork directive tells the model to emit the
        # banner for the bare-`lit` keyword path (no deterministic print there).
        self.assertIn("🔥 **LIT IGNITED · litwork** 🔥", self.pkg.core.LIT_CONTEXT)

class IgniteTransform(unittest.TestCase):
    """Natural routes render a mark at reply arrival and preserve the model probe."""

    def setUp(self):
        self.pkg = _load_plugin_package()
        self.core = self.pkg.core
        self.core._PENDING_IGNITE.discard("kw")
        self.core._PENDING_IGNITE.discard("plain")

    def test_transform_hook_registered_and_declared(self):
        ctx = _FakeCtx()
        self.pkg.register(ctx)
        self.assertIn("transform_llm_output", ctx.hooks)
        with open(os.path.join(_ASSET_DIR, "plugin.yaml"), encoding="utf-8") as handle:
            yaml_text = handle.read()
        self.assertIn("transform_llm_output", yaml_text)

    def test_keyword_lit_draws_mark_without_forging_model_probe(self):
        # pre_llm_call on a bare-`lit` keyword message flags the turn...
        out = self.core.pre_llm_call(user_message="recheck the gateway lit", session_id="kw", platform="cli")
        self.assertIsInstance(out, dict)  # keyword path injected the directive
        # ...and transform_llm_output appends the banner after that turn's response.
        result = self.core.transform_llm_output(response_text="On it, checking now.", session_id="kw")
        self.assertIn("🔥 LIT IGNITED · litwork 🔥", re.sub(r"\x1b\[[0-9;]*m", "", result))
        self.assertNotIn("\x1b", result)
        self.assertNotIn(self.core.LIT_PROBE_LINE, result)
        self.assertIn("On it, checking now.", result)

    def test_non_lit_turn_is_untouched(self):
        result = self.core.transform_llm_output(response_text="just a normal answer", session_id="plain")
        self.assertIsNone(result)  # None => Hermes leaves the text unchanged

    def test_no_double_banner_when_model_already_emitted(self):
        self.core.pre_llm_call(user_message="do it lit", session_id="kw", platform="cli")
        already = f"{self.core.LIT_PROBE_LINE}\n\nalready ignited by the model"
        result = self.core.transform_llm_output(response_text=already, session_id="kw")
        # either returns None (unchanged) or the same single-bannered text — never doubled
        text = result if isinstance(result, str) else already
        self.assertEqual(text.count("🔥 **LIT IGNITED · litwork** 🔥"), 1)

    def test_flag_is_consumed_once(self):
        self.core.pre_llm_call(user_message="go lit", session_id="kw", platform="cli")
        self.core.transform_llm_output(response_text="first", session_id="kw")
        # second turn (no new keyword) must not re-fire the banner
        second = self.core.transform_llm_output(response_text="second turn", session_id="kw")
        self.assertIsNone(second)

    def test_interrupted_lit_turn_does_not_leak_to_next_turn(self):
        # turn A: keyword-lit fires but transform never runs (turn interrupted)
        self.core.pre_llm_call(user_message="do it lit", session_id="kw", platform="cli")
        # turn B: an ordinary non-lit message in the same session
        self.core.pre_llm_call(user_message="what time is it", session_id="kw", platform="cli")
        # turn B's response must NOT be bannered (the stale flag was from turn A)
        leaked = self.core.transform_llm_output(response_text="It is noon.", session_id="kw")
        self.assertIsNone(leaked)


if __name__ == "__main__":
    unittest.main()
