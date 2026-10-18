"""The session skill index that makes lithermes:* skills selectable.

Hermes keeps plugin skills out of <available_skills>: register_skill only makes
a name loadable through skill_view. A model that is never told the names cannot
choose one, and in a clean profile it loaded no LitHermes skill for any
plain-language request that did not open with a route word. The plugin
therefore registers one session system-prompt section listing every skill.

The section is checked against the host's own limits (one section of at most
4,000 characters, a lowercase id) so the host never skips it at render time.
"""

from __future__ import annotations

import re
import unittest

try:
    from .plugin_register_test_support import _FakeCtx, _load_plugin_package
except ImportError:
    from plugin_register_test_support import _FakeCtx, _load_plugin_package

HOST_SECTION_MAX_CHARS = 4000
HOST_SECTION_ID = re.compile(r"^[a-z0-9._-]{1,128}$")

# Plain-language requests whose skill was never loaded in the clean-profile
# measurement. None opens with a route word, so no deterministic route fires and
# the session index is the only surface that can name the skill.
UNROUTED_REQUESTS = {
    "litwork": (
        "Carry this feature through a worktree, keep evidence for each acceptance condition, "
        "then verify the actual user-facing path.",
        "이 기능을 처음부터 끝까지 만들어줘. 테스트도 붙이고, 끝나면 무엇이 바뀌었는지 짧게 정리해줘.",
    ),
    "review-work": (
        "Inspect this patch for real defects, with file and line evidence, reproduction details, "
        "and security risks.",
        "이 변경을 합쳐도 될지 봐주고, 문제가 있으면 고쳐서 다시 올려줘.",
    ),
    "debugging": (
        "가끔 저장 요청이 멈춰. 증상을 재현해서 원인을 좁히고 최소 수정한 뒤 실제 경로에서 다시 확인해줘.",
        "로그인한 뒤에 가끔 빈 화면이 떠. 원인을 찾아서 고치고, 화면에서 실제로 괜찮은지도 확인해줘.",
    ),
    "litresearch": (
        "Trace prior implementations and references for this approach, verify disputed claims "
        "against primary sources, then synthesize the landscape.",
        "다른 제품들이 이 문제를 어떻게 푸는지 조사해서 우리 쪽에 맞는 방안을 추천해줘.",
    ),
}


class _SectionCtx(_FakeCtx):
    def __init__(self):
        super().__init__()
        self.sections = {}

    def register_system_prompt_section(self, id, content, *, position="after_memory", max_chars=4000):
        if id in self.sections:
            raise ValueError(f"system prompt section {id!r} is already registered")
        self.sections[id] = {"content": content, "position": position, "max_chars": max_chars}


class SkillIndexSection(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.ctx = _SectionCtx()
        cls.pkg.register(cls.ctx)
        cls.section = cls.ctx.sections.get("lithermes-skills")

    def _text(self) -> str:
        self.assertIsNotNone(self.section, "register() added no lithermes-skills prompt section")
        content = self.section["content"]
        return content({}) if callable(content) else content

    def test_section_fits_the_host_limits(self):
        text = self._text()
        self.assertRegex("lithermes-skills", HOST_SECTION_ID)
        self.assertEqual(self.section["position"], "after_memory")
        self.assertLessEqual(self.section["max_chars"], HOST_SECTION_MAX_CHARS)
        self.assertLessEqual(len(text), self.section["max_chars"])

    def test_every_registered_skill_is_listed_once(self):
        listed = re.findall(r"(?m)^- ([a-z0-9-]+): \S", self._text())
        registered = [name for name, _ in self.pkg.PORTED_SKILLS]
        self.assertEqual(sorted(listed), sorted(registered))
        self.assertEqual(sorted(listed), sorted(name for name, _ in self.ctx.skills))

    def test_index_names_the_load_call(self):
        self.assertIn('skill_view("lithermes:<name>")', self._text())

    def test_unrouted_requests_reach_their_skill_through_the_index(self):
        text = self._text()
        for skill, requests in UNROUTED_REQUESTS.items():
            line = re.search(rf"(?m)^- {re.escape(skill)}: (?P<desc>.+)$", text)
            self.assertIsNotNone(line, skill)
            self.assertTrue(line.group("desc").startswith("Use when "), (skill, line.group("desc")))
            for request in requests:
                with self.subTest(skill=skill, request=request[:40]):
                    self.assertIsNone(self.pkg.core.detect_lit_mode(request))

    def test_hosts_without_the_section_api_still_register(self):
        ctx = _FakeCtx()
        self.pkg.register(ctx)
        self.assertIn("pre_llm_call", ctx.hooks)


if __name__ == "__main__":
    unittest.main()
