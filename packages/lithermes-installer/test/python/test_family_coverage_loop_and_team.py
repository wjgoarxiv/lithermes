"""Two family cells that a directory scan reports as unmapped, and are not.

A parity matrix that looks for `skills/<name>/` finds nothing for the loop family
or for team mode in this repo, and records two blanks. Both are wrong: this
harness delivers each through a host-native surface under a different name.

  loop family -> `/lit-loop` CLI command + the ("lit-loop", "litwork") routing
                 pair, executing on bounded_work schema 3.
  team mode   -> the `kanban-team` route, which maps coordinated multi-worker
                 work onto Hermes Kanban profile and worker lanes.

These tests pin the destinations so the mapping cannot be silently lost, and pin
the discrimination cases so the tokens cannot start firing on ordinary prose.
The team-mode assertions cover behaviour that ALREADY existed and was untested;
only the bare `lit-team` alias is new.
"""

from __future__ import annotations

import unittest

try:
    from .plugin_register_test_support import _load_plugin_package
except ImportError:
    from plugin_register_test_support import _load_plugin_package


class LoopFamilyHasADestination(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.core = cls.pkg.core

    def route(self, message):
        return self.core.detect_lit_mode(message)

    def test_the_loop_token_routes_to_the_litwork_workflow(self):
        for message in (
            "lit-loop ship the parser fix",
            "lit-loop migrate the auth module with evidence",
        ):
            with self.subTest(message=message):
                result = self.route(message)
                self.assertIsNotNone(result, "the loop family must have a destination")
                self.assertEqual(result.mode, "litwork")

    def test_the_loop_route_carries_the_objective_through(self):
        result = self.route("lit-loop ship the parser fix")
        self.assertIn("parser", result.objective)

    def test_loop_lookalikes_stay_silent(self):
        """The token must not fire on ordinary prose or on paths and identifiers."""
        for message in (
            "explain how the event loop works",
            "the lit_loop variable is undefined",
            "fix /tmp/lit-loop.sock permissions",
            "this loop runs forever",
        ):
            with self.subTest(message=message):
                result = self.route(message)
                if result is not None:
                    self.assertNotEqual(
                        result.mode, "litwork",
                        "a loop lookalike must not reach the workflow route",
                    )

    def test_the_command_surface_is_registered(self):
        """__init__.py registers /lit-loop; diagnostics must agree it exists."""
        self.assertTrue(hasattr(self.core, "command_lit_loop"))

    def test_the_command_rejects_an_empty_task(self):
        with self.assertRaises(ValueError) as ctx:
            self.core.command_lit_loop("")
        self.assertIn("usage:", str(ctx.exception))


class TeamModeHasADestination(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.core = cls.pkg.core

    def route(self, message):
        return self.core.detect_lit_mode(message)

    def test_the_lit_prefixed_phrasings_reach_kanban_team(self):
        """Pre-existing behaviour, previously untested."""
        for message in (
            "lit team mode for the migration",
            "lit team split this across two workers",
        ):
            with self.subTest(message=message):
                result = self.route(message)
                self.assertIsNotNone(result)
                self.assertEqual(result.mode, "kanban-team")

    def test_the_bare_family_name_now_reaches_the_same_destination(self):
        """The alias added here — it must land on the EXISTING mode, not a new one."""
        result = self.route("lit-team for the migration")
        self.assertIsNotNone(result, "bare `lit-team` was a dead token")
        self.assertEqual(result.mode, "kanban-team")

    def test_the_alias_does_not_introduce_a_second_team_surface(self):
        """A duplicate skill body is the failure mode this test exists to prevent."""
        bare = self.route("lit-team for the migration")
        prefixed = self.route("lit team mode for the migration")
        self.assertEqual(bare.mode, prefixed.mode)

    def test_common_english_team_phrases_stay_silent(self):
        """`team` is an ordinary word; only the coined compound may be a token."""
        for message in (
            "team meeting notes for tuesday",
            "the app has a team mode toggle in settings",
            "put together a team for this refactor",
            "which team owns this service",
        ):
            with self.subTest(message=message):
                result = self.route(message)
                if result is not None:
                    self.assertNotEqual(
                        result.mode, "kanban-team",
                        "ordinary team prose must not route",
                    )

    def test_the_route_body_states_the_host_has_no_native_team_mode(self):
        """The honest caveat is load-bearing; parity must not be implied."""
        from importlib import import_module
        contexts = import_module("lithermes_plugin_pkg.core_contexts")
        route = self.route("lit-team for the migration")
        body = contexts.build_natural_mode_context(route)
        self.assertIn("no literal native team mode", body)
        self.assertIn("Kanban", body)

    def test_the_body_refuses_to_fake_a_workflow_start(self):
        route = self.route("lit-team for the migration")
        from importlib import import_module
        contexts = import_module("lithermes_plugin_pkg.core_contexts")
        body = contexts.build_natural_mode_context(route)
        self.assertIn("do not fake a workflow start", body)


if __name__ == "__main__":
    unittest.main()
