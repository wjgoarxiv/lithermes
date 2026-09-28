"""Intent-shaped activation for frontend-ui-ux: a making verb AND a UI noun.

frontend-ui-ux is the one skill whose own name nobody types, so a name-only route
leaves it reachable only after editing has started — backwards for a skill that
shapes what gets built. No single word is a safe token, so the route requires a
CONJUNCTION.

The negative cases carry the weight here. A route with only positive tests passes
while firing on everything, which is the failure this suite exists to prevent:
`test_the_conjunction_is_load_bearing` proves each half alone is insufficient.
"""

from __future__ import annotations

import os
import shlex
import tempfile
import unittest
from pathlib import Path

try:
    from .plugin_register_test_support import _load_plugin_package, _skill_body
except ImportError:
    from plugin_register_test_support import _load_plugin_package, _skill_body


class UiIntentRoute(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.core = cls.pkg.core

    # -- positives ----------------------------------------------------------

    def test_a_making_verb_plus_a_ui_noun_routes(self):
        for message in [
            "design a new settings page UI",
            "redesign the dashboard",
            "make a landing page",
            "create a component",
            "build the checkout screen",
            "polish the sidebar",
            "restyle the navbar",
            "revamp the layout",
            "implement the modal",
            "lay out the user interface",
            "mock up a stylesheet",
            "style the front-end",
            "create a design system for the app",
            "build a web app",
        ]:
            with self.subTest(message=message):
                self.assertTrue(self.core.detect_ui_intent(message))
                route = self.core.detect_lit_mode(message)
                self.assertIsNotNone(route, f"{message!r} did not route")
                self.assertEqual(route.mode, "frontend-ui-ux")

    def test_the_plan_headline_prompt_now_routes(self):
        """The measured baseline: this named no skill in any product."""
        route = self.core.detect_lit_mode("design a new settings page UI")
        self.assertIsNotNone(route)
        self.assertEqual(route.mode, "frontend-ui-ux")
        context = self.core.build_natural_mode_context(route)
        self.assertIn("lithermes:frontend-ui-ux", context)
        self.assertIn('<lithermes-skill-body name="frontend-ui-ux">', context)
        self.assertIn(_skill_body("frontend-ui-ux"), context)

    def test_ui_route_names_an_installed_probe_command_before_visual_qa(self):
        route = self.core.detect_lit_mode("build a settings page UI lit")
        self.assertIsNotNone(route)
        context = self.core.build_natural_mode_context(route)
        marker = "Installed web UI probe command: "
        self.assertIn(marker, context)
        command = context.split(marker, 1)[1].splitlines()[0]
        argv = shlex.split(command)
        self.assertEqual(argv[0], "node")
        expected = Path(self.pkg.__file__).resolve().parent / "skills/frontend-ui-ux/scripts/probe.mjs"
        self.assertEqual(Path(argv[1]), expected)
        self.assertTrue(expected.is_file(), "probe must exist in the plugin payload")
        self.assertIn("--url", argv)
        self.assertIn("--out", argv)
        self.assertIn("--static", argv)
        self.assertLess(context.index(marker), context.index("lithermes:visual-qa"))
        self.assertIn("Run the measured probe before claiming web UI verification", context)

    def test_ui_build_route_carries_behavioral_acceptance_guidance(self):
        route = self.core.detect_lit_mode(
            "build a finance dashboard with charts and transaction search, filtering, and pagination"
        )
        self.assertIsNotNone(route)
        self.assertEqual(route.mode, "frontend-ui-ux")
        context = self.core.build_natural_mode_context(route)
        self.assertIn("references/operating-lanes.md", context)
        reference = (
            Path(__file__).resolve().parents[2]
            / "assets/lithermes-plugin/skills/frontend-ui-ux/references/operating-lanes.md"
        )
        guidance = reference.read_text(encoding="utf-8")
        for requirement in (
            "## Behavioral acceptance",
            "list each requested behavior separately",
            "accessible name",
            "semantic, operable controls",
            "exercise every requested interaction at the target viewports",
        ):
            with self.subTest(requirement=requirement):
                self.assertIn(requirement, guidance)

    # -- discrimination: the point of the conjunction ------------------------

    def test_a_making_verb_alone_never_routes(self):
        """'build' matches almost every engineering sentence. Alone it must not fire."""
        for message in [
            "build the API client",
            "create a new database migration",
            "make it faster",
            "build the release pipeline",
            "create a changelog entry",
            "design the database schema",
            "implement the retry policy",
            "make the parser stricter",
            "build a CLI subcommand",
            "create an index on the users table",
        ]:
            with self.subTest(message=message):
                self.assertFalse(
                    self.core.detect_ui_intent(message),
                    f"{message!r} has a verb but no UI noun and must stay silent",
                )
                route = self.core.detect_lit_mode(message)
                mode = route.mode if route else None
                self.assertNotEqual(mode, "frontend-ui-ux")

    def test_a_ui_noun_alone_never_routes(self):
        """Mentioning a screen is not asking to design one."""
        for message in [
            "the page is slow",
            "our dashboard has a bug",
            "the sidebar throws on null",
            "css is cached too aggressively",
            "the component tree is deep",
            "what does the layout algorithm do",
        ]:
            with self.subTest(message=message):
                self.assertFalse(
                    self.core.detect_ui_intent(message),
                    f"{message!r} has a noun but no making verb and must stay silent",
                )

    def test_the_conjunction_is_load_bearing(self):
        """Each half alone is insufficient; together they fire. That is the mechanism."""
        verb_only = "build the API client"
        noun_only = "the dashboard is slow"
        both = "build the dashboard"
        self.assertFalse(self.core.detect_ui_intent(verb_only))
        self.assertFalse(self.core.detect_ui_intent(noun_only))
        self.assertTrue(self.core.detect_ui_intent(both))

    def test_ordinary_non_engineering_text_never_routes(self):
        for message in ["", "hello", "thanks!", "what time is it", "run the tests"]:
            with self.subTest(message=message):
                self.assertFalse(self.core.detect_ui_intent(message))

    def test_code_fences_and_spans_are_stripped_before_matching(self):
        for message in [
            "```sh\ndesign a new settings page UI\n```",
            "document `design a new settings page UI` only",
        ]:
            with self.subTest(message=message):
                route = self.core.detect_lit_mode(message)
                mode = route.mode if route else None
                self.assertNotEqual(mode, "frontend-ui-ux")

    # -- position independence ----------------------------------------------

    def test_the_conjunction_matches_anywhere_in_any_order_at_any_distance(self):
        """The start-anchor belongs to `_after_mode_word`, not to the prompt.

        Hermes hands `pre_llm_call` the raw `user_message` string with no
        positional constraint, so an anywhere-matching conjunction is expressible.
        This route uses `re.search` on both terms; the name routes use `re.match`
        with `^`. That difference is a choice, and this test pins it.
        """
        for message in [
            "can you design a new settings page UI for me",       # both mid-sentence
            "the dashboard needs a redesign",                     # noun BEFORE verb
            "I was thinking that later this week we should build the checkout screen",
            "before standup tomorrow, please polish the sidebar and ship it",
            "we need to make the landing page feel less cramped",
        ]:
            with self.subTest(message=message):
                self.assertTrue(self.core.detect_ui_intent(message))
                route = self.core.detect_lit_mode(message)
                self.assertIsNotNone(route, f"{message!r} did not route")
                self.assertEqual(route.mode, "frontend-ui-ux")

    def test_discrimination_holds_at_every_position_too(self):
        """A verb without a noun stays silent no matter where it sits."""
        for message in [
            "can you build the API client for me sometime next week",
            "I need you to fix the parser bug before anything else",
            "later we should create a new database migration",
        ]:
            with self.subTest(message=message):
                self.assertFalse(self.core.detect_ui_intent(message))

    def test_the_name_routes_remain_start_anchored(self):
        """Documenting the contrast: a NAME token must open the message."""
        self.assertEqual(self.core.detect_lit_mode("visual-qa the dashboard").mode, "visual-qa")
        mid = self.core.detect_lit_mode("please visual-qa the dashboard")
        self.assertNotEqual(mid.mode if mid else None, "visual-qa")

    # -- precedence ---------------------------------------------------------

    def test_an_explicit_token_or_skill_name_outranks_the_intent_route(self):
        """Intent is the fuzziest signal and must have the lowest precedence."""
        for message, expected in [
            ("lit-plan design a new settings page UI", "lit-plan"),
            ("review-work design the dashboard", "review-work"),
            ("visual-qa design the dashboard", "visual-qa"),
            ("refactor the dashboard layout", "refactor"),
            ("debugging the page render", "debugging"),
        ]:
            with self.subTest(message=message):
                route = self.core.detect_lit_mode(message)
                self.assertIsNotNone(route)
                self.assertEqual(route.mode, expected)

    def test_bare_lit_ui_objective_reaches_frontend_and_preserves_mode(self):
        for message, mode in (
            ("lit build the dashboard", "build"),
            ("작은 웹앱 만들어줘 lit", "build"),
            ("Polish the settings screen, keep its layout.\n\nlit", "polish"),
            ("Audit the checkout page, don't fix it.\n\nlit", "audit"),
            ("Harden the profile screen against long content.\n\nlit", "harden"),
            ("이 화면 여백만 다듬어줘.\n\nlit", "polish"),
            ("이 페이지 점검만 해줘.\n\nlit", "audit"),
            ("이 화면 좁은 폭에도 튼튼하게 만들어줘.\n\nlit", "harden"),
        ):
            with self.subTest(message=message):
                route = self.core.detect_lit_mode(message)
                self.assertIsNotNone(route)
                self.assertEqual(route.mode, "frontend-ui-ux")
                self.assertIn(f"Frontend mode: {mode}.", self.core.build_natural_mode_context(route))

    def test_explicit_litwork_hands_web_interface_to_frontend_review(self):
        message = "litwork build a small web app with a settings screen"
        self.assertEqual(self.core.detect_lit_mode(message).mode, "litwork")
        with tempfile.TemporaryDirectory() as tmp:
            previous = os.getcwd()
            os.chdir(tmp)
            try:
                result = self.pkg._pre_llm_call(
                    user_message=message, session_id="ui-loop-positive", platform="cli"
                )
            finally:
                os.chdir(previous)
        context = result["context"]
        self.assertIn("<lithermes-litwork-ui-handoff>", context)
        self.assertIn('<lithermes-skill-body name="frontend-ui-ux">', context)
        self.assertIn("scripts/probe.mjs", context)
        self.assertIn("Installed web UI probe command: ", context)
        self.assertIn("HIGH", context)

    def test_explicit_litwork_backend_and_cli_do_not_start_ui_handoff(self):
        for message in ("litwork build a CLI subcommand", "litwork implement an API retry policy"):
            with self.subTest(message=message):
                self.assertEqual(self.core.detect_lit_mode(message).mode, "litwork")
                with tempfile.TemporaryDirectory() as tmp:
                    previous = os.getcwd()
                    os.chdir(tmp)
                    try:
                        result = self.pkg._pre_llm_call(
                            user_message=message, session_id="ui-loop-negative", platform="cli"
                        )
                    finally:
                        os.chdir(previous)
                self.assertNotIn("<lithermes-litwork-ui-handoff>", result["context"])
                self.assertNotIn('<lithermes-skill-body name="frontend-ui-ux">', result["context"])

    def test_ui_mode_near_misses_do_not_take_other_domains(self):
        for message in (
            "polish this prose paragraph", "서버 상태 점검 좀 해줘", "웹앱이 느리네", "이 온보딩 영상 다듬어줘",
            "발표 슬라이드 디자인 다듬어줘", "cut the product demo video",
            "모션이 저사양 기기에서도 안 끊기게 최적화해줘",
        ):
            with self.subTest(message=message):
                self.assertIsNone(self.core.detect_ui_mode(message))
                route = self.core.detect_lit_mode(message)
                self.assertTrue(route is None or route.mode != "frontend-ui-ux")

    # -- delivery -----------------------------------------------------------

    def test_the_route_reaches_the_model_through_pre_llm_call(self):
        with tempfile.TemporaryDirectory() as tmp:
            prev = os.getcwd()
            os.chdir(tmp)
            try:
                out = self.pkg._pre_llm_call(
                    user_message="design a new settings page UI",
                    session_id="ui-intent", platform="cli",
                )
            finally:
                os.chdir(prev)
            self.assertIsInstance(out, dict, "must be delivered by pre_llm_call")
            self.assertIn("lithermes:frontend-ui-ux", out["context"])
            self.assertIn("Installed web UI probe command: ", out["context"])
            self.assertFalse((Path(tmp) / ".hermes" / "lithermes" / "runs").exists())

    def test_a_delegate_child_never_activates_on_intent(self):
        self.assertIsNone(
            self.pkg._pre_llm_call(
                user_message="design a new settings page UI",
                session_id="child", platform="subagent",
            )
        )

    # -- Korean --------------------------------------------------------------

    def test_korean_making_verb_plus_ui_noun_routes(self):
        for message in [
            "설정 페이지 UI를 새로 디자인해줘",
            "디자인 시스템을 만들어줘",
            "대시보드를 다시 디자인해줘",
            "랜딩 페이지 만들어줘",
            "사이드바 좀 다듬어줘",
            "컴포넌트 하나 만들어줘",
            "모달 화면 구현해줘",
            "UI를 개선해줘",
            "레이아웃을 리뉴얼하자",
            "프론트엔드 화면 제작해줘",
            "작은 웹앱 만들어줘",
            "작은 웹 앱 만들어줘",
        ]:
            with self.subTest(message=message):
                self.assertTrue(self.core.detect_ui_intent(message))
                route = self.core.detect_lit_mode(message)
                self.assertIsNotNone(route, f"{message!r} did not route")
                self.assertEqual(route.mode, "frontend-ui-ux")

    def test_korean_discrimination_verb_without_ui_noun(self):
        """만들다 is in almost every Korean build request. Alone it must not fire."""
        for message in [
            "API 클라이언트를 만들어줘",
            "데이터베이스 마이그레이션을 새로 만들어줘",
            "더 빠르게 만들어줘",
            "릴리스 파이프라인 만들어줘",
            "스키마를 설계해줘",
            "재시도 정책 구현해줘",
            "인덱스 하나 만들어줘",
            "웹 서버 만들어줘",
        ]:
            with self.subTest(message=message):
                self.assertFalse(
                    self.core.detect_ui_intent(message),
                    f"{message!r} has a Korean verb but no UI noun and must stay silent",
                )

    def test_korean_discrimination_ui_noun_without_making_verb(self):
        for message in [
            "이 페이지 왜 느려?",
            "대시보드에 버그 있어",
            "사이드바가 널에서 터져",
            "디자인 시스템 문서를 봐줘",
            "테스트 실행해줘",
        ]:
            with self.subTest(message=message):
                self.assertFalse(self.core.detect_ui_intent(message))

    def test_the_korean_verb_noun_collision_is_guarded(self):
        """디자인 is a verb stem AND the head of the noun 디자인 시스템.

        Without the 하다-marker requirement that noun phrase satisfies both halves
        by itself — the same collapse `lay ?out` caused against `layout`.
        """
        # noun phrase alone: noun yes, verb no -> silent
        self.assertFalse(self.core.detect_ui_intent("디자인 시스템 문서를 봐줘"))
        # noun phrase + a real verb -> fires
        self.assertTrue(self.core.detect_ui_intent("디자인 시스템을 만들어줘"))
        # the conjugated verb alone: verb yes, noun no -> silent
        self.assertFalse(self.core.detect_ui_intent("디자인해줘"))

    def test_agglutination_is_matched_by_stem_not_by_inflection_list(self):
        for message in [
            "화면을 디자인해줘", "화면을 디자인하고 있어",
            "디자인할 화면이 많아", "화면을 디자인했다",
        ]:
            with self.subTest(message=message):
                self.assertTrue(self.core.detect_ui_intent(message))

    def test_an_attached_particle_does_not_break_an_ascii_noun(self):
        """`\b` fails on "UI를" because Hangul is a word char. The boundary here does not."""
        self.assertTrue(self.core.detect_ui_intent("UI를 개선해줘"))
        self.assertTrue(self.core.detect_ui_intent("UX를 다듬어줘"))

    def test_the_ascii_boundary_still_rejects_latin_neighbours(self):
        """The relaxed boundary must not turn `ui` into a substring match."""
        from importlib import import_module
        routing = import_module("lithermes_plugin_pkg.core_routing")
        for text in ["guide the user", "GUIDE the user", "UIKit is a framework"]:
            with self.subTest(text=text):
                self.assertIsNone(routing._UI_INTENT_NOUN_KO_RE.search(text))

    def test_mixed_language_prompts_satisfy_the_conjunction(self):
        """Korean prompts routinely carry ASCII terms; either half may be either language."""
        self.assertTrue(self.core.detect_ui_intent("UI를 디자인해줘"))
        self.assertTrue(self.core.detect_ui_intent("dashboard를 개선해줘"))

    def test_english_behaviour_is_unchanged_by_the_korean_addition(self):
        for message, expected in [
            ("design a new settings page UI", True), ("redesign the dashboard", True),
            ("build the API client", False), ("make it faster", False),
            ("what does the layout algorithm do", False), ("the page is slow", False),
        ]:
            with self.subTest(message=message):
                self.assertEqual(self.core.detect_ui_intent(message), expected)

    def test_no_term_is_maintained_in_two_places(self):
        """The `_UIUX_SIGNAL` duplication hazard, in a second language."""
        from importlib import import_module
        routing = import_module("lithermes_plugin_pkg.core_routing")
        contract = import_module("lithermes_plugin_pkg.core_contract")
        english = {n.lower() for n in routing.UI_INTENT_NOUNS}
        korean = {n.lower() for n in routing.UI_INTENT_NOUNS_KO}
        self.assertEqual(
            sorted(english & korean), [],
            "a noun is maintained in BOTH the English and Korean sets",
        )
        # and neither overlaps the unrelated Korean-prose route vocabulary
        prose = {p.lower() for p in contract.KOREAN_PROSE_NATURAL_PHRASES}
        self.assertEqual(sorted(korean & prose), [])
        self.assertEqual(sorted(english & prose), [])

    # -- Korean containment analysis ----------------------------------------
    #
    # Substring matching on Hangul has no word boundary, so containment is a live
    # problem. The false-positive analysis is redone here in Korean rather than
    # inherited from the English set, which had `\b` to lean on.

    def test_the_named_containment_hazards_do_not_leak(self):
        for message in [
            "디자이너를 뽑아줘",           # 디자인 is NOT a substring of 디자이너 (인 != 이)
            "기획자랑 회의 잡아줘",
            "화요일에 배포하자",           # 화면 vs 화요일
            "화물 추적 API 만들어줘",       # 화면 vs 화물
            "면접 일정 잡아줘",
            "만두 가게 API 만들어줘",       # 만들 vs 만두
            "모니터링 대시 붙여줘",         # 대시보드 vs 대시
            "보드게임 점수판 로직 만들어줘",   # 대시보드 vs 보드
            "사이드이펙트 정리해줘",         # 사이드바 vs 사이드
            "네트워크 지연 재현해줘",        # 내비게이션/네비게이션 vs 네트워크
            "스타일가이드 문서 읽어줘",       # 스타일시트 vs 스타일가이드
            "구현체를 바꿔줘", "개선안 정리해줘", "설계도 확인해줘",
            "모달리티 분석해줘",           # 모달 vs 모달리티
            "화면비 계산해줘",             # noun present but no making verb
            "레이아웃 알고리즘 왜 느려?",     # noun present but no making verb
        ]:
            with self.subTest(message=message):
                self.assertFalse(self.core.detect_ui_intent(message))

    def test_broad_making_verbs_against_every_non_ui_object(self):
        """만들다 appears in almost every Korean build request."""
        for message in [
            "테스트를 만들어줘", "테스트를 하나 더 만들어줘", "스크립트 만들어줘",
            "계정 만들어줘", "인덱스 만들어줘", "브랜치 만들어줘", "문서 만들어줘",
            "빌드 스크립트 만들어줘", "모듈 하나 만들어줘",
            "API 클라이언트를 만들어줘", "데이터베이스 마이그레이션을 새로 만들어줘",
        ]:
            with self.subTest(message=message):
                self.assertFalse(
                    self.core.detect_ui_intent(message),
                    f"{message!r}: a making verb with no UI noun must stay silent",
                )

    def test_the_one_wrong_domain_containment_is_excluded(self):
        """버튼 ⊂ 버튼식. A physical push-button lock is not a UI surface.

        Measured before the guard: '버튼식 잠금장치 만들어줘' routed. The term is kept
        because it carries real coverage no other noun provides, and the one
        measured compound is excluded instead.
        """
        self.assertFalse(self.core.detect_ui_intent("버튼식 잠금장치 만들어줘"))
        self.assertFalse(self.core.detect_ui_intent("버튼식 스위치 제작해줘"))
        # and the coverage it exists for still works
        self.assertTrue(self.core.detect_ui_intent("로그인 버튼 다시 디자인해줘"))
        self.assertTrue(self.core.detect_ui_intent("버튼 하나 만들어줘"))

    def test_every_accepted_containment_risk_is_registered_and_still_true(self):
        """The register must describe real behaviour, not an aspiration."""
        from importlib import import_module
        routing = import_module("lithermes_plugin_pkg.core_routing")
        register = routing.ACCEPTED_KOREAN_CONTAINMENT_RISKS
        self.assertGreaterEqual(len(register), 3)
        for entry, reason in register:
            with self.subTest(entry=entry):
                self.assertTrue(entry.strip() and len(reason) > 40,
                                f"{entry}: an accepted risk needs a real reason")
        # the two behavioural claims in the register are asserted, not just described
        self.assertTrue(self.core.detect_ui_intent("홈페이지 만들어줘"))          # wider true positive
        self.assertTrue(self.core.detect_ui_intent("페이지네이션 로직 만들어줘"))   # broader than asked
        self.assertTrue(self.core.detect_ui_intent("컴포넌트 테스트 만들어줘"))     # matches English behaviour
        self.assertTrue(self.core.detect_ui_intent("build the component tests"))  # ...and it does

    def test_a_verb_inside_an_unrelated_word_is_inert_without_a_noun(self):
        """Verb containment is bounded by the conjunction, which is why it is not registered."""
        for message in ["만두 가게 알려줘", "제작진 목록 뽑아줘", "구현체를 바꿔줘"]:
            with self.subTest(message=message):
                self.assertFalse(self.core.detect_ui_intent(message))

    # -- anti-drift ---------------------------------------------------------

    def test_the_shared_noun_core_is_used_by_both_sides(self):
        """Two regexes that must agree and are edited apart will drift."""
        from importlib import import_module
        contract = import_module("lithermes_plugin_pkg.core_contract")
        routing = import_module("lithermes_plugin_pkg.core_routing")
        shared = contract.UI_SURFACE_NOUNS
        self.assertTrue(shared, "the shared core must not be empty")
        for noun in shared:
            with self.subTest(noun=noun):
                # chat side: the noun alone satisfies the noun half
                self.assertTrue(
                    routing._UI_INTENT_NOUN_RE.search(noun),
                    f"chat route dropped shared noun {noun!r}",
                )
                # event side: the same noun is a UI signal in a path/diff
                self.assertTrue(
                    contract._UIUX_SIGNAL.search(noun),
                    f"event regex dropped shared noun {noun!r}",
                )

    def test_the_event_side_regex_still_behaves_as_before(self):
        """Refactoring it into a shared core must not change what it matches."""
        from importlib import import_module
        contract = import_module("lithermes_plugin_pkg.core_contract")
        for text, expected in [
            ("src/theme.css", True), ("README.md", False),
            ("src/components/Card.tsx", True), ("cmd/main.go", False),
            ("the frontend is slow", True), ("terminal output", True),
            ("the css is broken", False), ("plain sentence", False),
        ]:
            with self.subTest(text=text):
                self.assertEqual(bool(contract._UIUX_SIGNAL.search(text)), expected)


if __name__ == "__main__":
    unittest.main()
