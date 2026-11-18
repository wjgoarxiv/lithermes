"""Host-injected notices (async delegation results) are not user prompts: they never pick a route.

Live: an ultra-brainstorm run closed under `LIT IGNITED · frontend-ui-ux` because a batch result
that mentioned signs and windows arrived as a user-role message and was routed like a prompt.
"""

from __future__ import annotations

import unittest

try:
    from .natural_routing_test_support import NaturalRoutingCase
except ImportError:
    from natural_routing_test_support import NaturalRoutingCase

NOTICE = (
    "[ASYNC DELEGATION BATCH COMPLETE — deleg_5f687687] A background fan-out unit you dispatched earlier "
    "— 10 subagent(s) — has finished; its consolidated results are below.\n"
    '{"ideas": [{"title": "Still Warm", "how": "build a landing page and a dashboard UI with a hero design"}]}'
)


class HostNoticeTurns(NaturalRoutingCase):
    def test_a_delegation_result_never_routes_or_changes_the_mark(self):
        first = self._hook("ultra-brainstorm names for a bakery", session="notice-1")
        self.assertIn('mode="ultra-brainstorm"', first["context"])
        for notice in (NOTICE, NOTICE.replace("BATCH COMPLETE", "COMPLETE"), "[ASYNC DELEGATION TASK FAILED — d, task 1/3] x"):
            result = self._hook(notice, session="notice-1")
            self.assertFalse((result or {}).get("context"), notice[:40])
        self.assertNotEqual(self.core._PENDING_DISCIPLINE.get("notice-1"), "frontend-ui-ux")

    def test_a_user_prompt_that_quotes_the_prefix_mid_text_still_routes(self):
        result = self._hook("lit build a dashboard UI; the log said [ASYNC DELEGATION COMPLETE] earlier", session="notice-2")
        self.assertIn("frontend-ui-ux", result["context"])


if __name__ == "__main__":
    unittest.main()
