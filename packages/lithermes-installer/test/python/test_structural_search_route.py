"""The structural-search skill: routed, contracted, and honest about the CLI.

This family had no destination here. What existed was worse than a blank cell:
`skills/refactor/SKILL.md` instructed the model to call `ast_grep_search(...)`
and `ast_grep_replace(...)` unconditionally, and neither is a tool on any
surface. `hermes tools list` returns 24 built-in toolsets and none of them is an
AST or structural-search surface; the plugin registers only `goal_*` and
`lithermes_work_progress`. Those calls could only resolve through an external CLI
or a user-configured MCP server that may not exist.

So the load-bearing part of this port is DETECTION, not pattern syntax. These
tests pin the route, the mode contract, the named blocker, and the amendment that
stops the refactor skill asserting a capability it cannot verify.
"""

from __future__ import annotations

import unittest
from pathlib import Path

try:
    from .plugin_register_test_support import _load_plugin_package
except ImportError:
    from plugin_register_test_support import _load_plugin_package


class StructuralSearchIsReachable(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.core = cls.pkg.core
        cls.asset_root = Path(cls.pkg.__file__).resolve().parent

    def route(self, message):
        return self.core.detect_lit_mode(message)

    def test_the_bare_name_routes(self):
        result = self.route("structural-search for every call to render")
        self.assertIsNotNone(result)
        self.assertEqual(result.mode, "structural-search")

    def test_the_lit_prefixed_forms_route(self):
        for message in (
            "lit structural-search for unwrap calls",
            "lit structural find every direct print call",
        ):
            with self.subTest(message=message):
                result = self.route(message)
                self.assertIsNotNone(result)
                self.assertEqual(result.mode, "structural-search")

    def test_ordinary_prose_stays_silent(self):
        """`structural` appears in unrelated engineering talk; it must not fire bare."""
        for message in (
            "the structural engineering report is due",
            "restructure the payment module",
            "search the structure of this JSON blob",
            "what is the structural difference between these two designs",
        ):
            with self.subTest(message=message):
                result = self.route(message)
                if result is not None:
                    self.assertNotEqual(result.mode, "structural-search")

    def test_registration_and_route_and_contract_move_together(self):
        """A registered skill with no route, or a route with no contract, is the defect."""
        registered = {name for name, _ in self.pkg.PORTED_SKILLS}
        self.assertIn("structural-search", registered)
        route = self.route("structural-search something")
        self.assertEqual(route.mode, "structural-search")
        self.assertIn("structural-search", self.core._SKILL_ROUTE_CONTRACTS)

    def test_the_skill_file_exists_and_is_registered_at_its_real_path(self):
        path = self.asset_root / "skills" / "structural-search" / "SKILL.md"
        self.assertTrue(path.is_file())
        registered = dict(self.pkg.PORTED_SKILLS)
        self.assertIn("structural-search", registered)


class TheContractRefusesToDegradeSilently(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.core = cls.pkg.core
        cls.asset_root = Path(cls.pkg.__file__).resolve().parent
        cls.skill = (cls.asset_root / "skills" / "structural-search" / "SKILL.md").read_text(
            encoding="utf-8")

    def body(self):
        from importlib import import_module
        contexts = import_module("lithermes_plugin_pkg.core_contexts")
        return contexts.build_natural_mode_context(
            self.core.detect_lit_mode("structural-search for render calls"))

    def test_the_injected_body_is_the_skill_contract_not_the_generic_fallthrough(self):
        """A mode with no contract entry silently delivers the litwork body instead."""
        body = self.body()
        self.assertIn("structural-search", body)
        self.assertNotIn("🔥 **LIT IGNITED · litwork** 🔥", body)

    def test_the_body_requires_detection_before_use(self):
        body = self.body()
        self.assertIn("DETECT FIRST", body)

    def test_the_body_names_the_blocker_rather_than_falling_back_quietly(self):
        self.assertIn("BLOCKED_STRUCTURAL_ENGINE_UNAVAILABLE", self.body())

    def test_the_body_requires_a_textual_result_to_be_labelled(self):
        self.assertIn("textual", self.body())

    def test_the_skill_verifies_binary_identity_not_just_the_name(self):
        """`sg` is a real unrelated binary; selecting by name can run something else."""
        self.assertIn("--version", self.skill)
        self.assertIn("grep -qi 'ast-grep'", self.skill)

    def test_every_named_blocker_is_defined_in_the_skill(self):
        for code in (
            "BLOCKED_STRUCTURAL_ENGINE_UNAVAILABLE",
            "BLOCKED_STRUCTURAL_LANG_UNSUPPORTED",
            "BLOCKED_STRUCTURAL_REWRITE_UNPREVIEWED",
        ):
            with self.subTest(code=code):
                self.assertIn(code, self.skill)

    def test_the_skill_states_the_host_has_no_structural_toolset(self):
        """The measured fact this whole port rests on."""
        self.assertIn("None of them is an AST or structural-search toolset", self.skill)


class RefactorNoLongerAssertsAnUnverifiedCapability(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        pkg = _load_plugin_package()
        cls.refactor = (Path(pkg.__file__).resolve().parent
                        / "skills" / "refactor" / "SKILL.md").read_text(encoding="utf-8")

    def test_refactor_says_the_ast_tools_are_not_host_tools(self):
        self.assertIn("not Hermes host tools", self.refactor)

    def test_refactor_routes_to_the_detection_contract(self):
        self.assertIn("lithermes:structural-search", self.refactor)

    def test_refactor_names_the_blocker_instead_of_substituting_regex(self):
        self.assertIn("BLOCKED_STRUCTURAL_ENGINE_UNAVAILABLE", self.refactor)


class TheIntentRouteDiscriminates(unittest.TestCase):
    """`structural-search` is a name nobody types. The intent conjunction is how
    the skill is actually reached — and discrimination is the whole risk, because
    "find" is ordinary English."""

    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.core = cls.pkg.core

    def mode(self, message):
        route = self.core.detect_lit_mode(message)
        return route.mode if route else None

    # -- positives ----------------------------------------------------------

    def test_english_structural_requests_route(self):
        for message in (
            "find every call site that passes a callback",
            "rewrite these imports by syntax shape",
            "migrate the import statements",
            "search for declarations of that type",
            # "locate all usages of the legacy helper" was here and MOVED to the
            # who-question negatives: "usages of X" needs X resolved first.
            # "find every reference to the old api" was here and MOVED to the
            # semantic-boundary negatives below. It rode on `references to`,
            # which was removed once the syntax/semantics boundary was drawn:
            # resolving what "the old api" refers to needs a binder, not a
            # pattern. The case is not deleted — it is asserted with the
            # opposite expectation and the reason recorded.
        ):
            with self.subTest(message=message):
                self.assertEqual(self.mode(message), "structural-search")

    def test_korean_structural_requests_route(self):
        for message in (
            "호출부를 전부 찾아줘",
            "임포트를 전부 다시 써줘",
            "선언부를 검색해줘",
            "함수 시그니처를 전부 찾아줘",
            "호출부 전부 치환해줘",
            "임포트를 마이그레이션해줘",
        ):
            with self.subTest(message=message):
                self.assertEqual(self.mode(message), "structural-search")

    # -- discrimination: the actual point -----------------------------------

    def test_ordinary_english_search_requests_stay_silent(self):
        """A verb alone must never route. These all contain a listed verb."""
        for message in (
            "find the login handler",
            "search for TODO comments",
            "grep for the error string",
            "find the bug",
            "find the fastest path",
            "replace the broken image",
            "locate the config file",
        ):
            with self.subTest(message=message):
                self.assertNotEqual(self.mode(message), "structural-search")

    def test_a_shape_noun_alone_stays_silent(self):
        """The other half. These name a syntax shape with no request to act."""
        for message in (
            "the imports are messy",
            "this declaration is confusing",
            "호출부가 복잡해",
            "임포트가 지저분해",
        ):
            with self.subTest(message=message):
                self.assertNotEqual(self.mode(message), "structural-search")

    def test_the_measured_korean_wrong_domain_leaks_stay_silent(self):
        """Each of these fired before the term set was tightened."""
        for message, why in (
            ("호출부서를 찾아줘", "호출부서 is an org-chart word, not a call site"),
            ("시그니처 메뉴를 찾아줘", "시그니처 메뉴 is a restaurant's signature dish"),
            ("카드 사용처를 찾아줘", "사용처 ordinarily means where a card is accepted"),
            ("사용처를 검색해줘", "same term, dropped entirely rather than patched"),
        ):
            with self.subTest(message=message, why=why):
                self.assertNotEqual(self.mode(message), "structural-search", why)

    def test_ordinary_korean_requests_stay_silent(self):
        for message in (
            "로그인 핸들러를 찾아줘",
            "버그를 찾아줘",
            "참조 문서를 찾아줘",
            "파일을 찾아줘",
            "이름을 바꿔줘",
            "에러 문자열을 검색해줘",
            "설정을 바꿔줘",
        ):
            with self.subTest(message=message):
                self.assertNotEqual(self.mode(message), "structural-search")

    # -- both halves load-bearing -------------------------------------------

    def test_both_halves_are_required(self):
        detect = self.core.detect_structural_intent
        self.assertTrue(detect("find every call site"))
        self.assertFalse(detect("find the thing"), "verb alone must not satisfy")
        self.assertFalse(detect("every call site"), "shape alone must not satisfy")

    def test_the_korean_stem_contraction_is_covered(self):
        """바꾸다 contracts to 바꿔; the dictionary stem alone never matches typed text."""
        self.assertTrue(self.core.detect_structural_intent("호출부를 전부 바꿔줘"))

    # -- registers and precedence -------------------------------------------

    def test_every_accepted_korean_risk_is_registered_with_a_reason(self):
        risks = self.core.ACCEPTED_KOREAN_STRUCTURAL_RISKS
        self.assertGreaterEqual(len(risks), 4)
        for name, reason in risks:
            with self.subTest(risk=name):
                self.assertTrue(name.strip())
                self.assertGreater(len(reason), 40, "a risk needs a real reason, not a label")

    def test_no_term_is_maintained_in_two_places(self):
        """A term in both intent sets would make one of them unmaintainable."""
        ui = {t.lower() for t in self.core.UI_INTENT_NOUNS}
        structural = {t.lower() for t in self.core.STRUCTURAL_INTENT_SHAPES}
        self.assertEqual(sorted(ui & structural), [])

    def test_the_ui_route_keeps_precedence_on_a_both_match_sentence(self):
        """Documented ordering: the shipped, tested UI route wins ties."""
        self.assertEqual(
            self.mode("redesign the dashboard and find every call site"),
            "frontend-ui-ux",
        )


class NearSynonymsAndTheLimitsOfAVocabularyPredicate(unittest.TestCase):
    """`find all the callers` and `find every call site` are the same request.

    The instance is closed. The CLASS is not, and the register asserted here
    exists so the next reader extends the noun list knowing what extending it
    will never buy.
    """

    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.core = cls.pkg.core

    def mode(self, message):
        route = self.core.detect_lit_mode(message)
        return route.mode if route else None

    def test_who_questions_do_not_route_here(self):
        """REVERSED, deliberately. These asserted the opposite one revision ago.

        `callers`, `call graph`, `invocations` and `usages of` were added to close
        a reported false negative, on the estimate that they cost nothing. They
        cost the boundary: a call SITE is a syntax node; a CALLER is the enclosing
        function and needs the call target and its scope resolved to identify.
        Asking who calls what is a language-server question. The terms are removed
        rather than tuned, and this test is the pin that stops them returning the
        next time someone reads the silence as a coverage gap.
        """
        for message in (
            "find all the callers",
            "find the callers of this function",
            "locate the call graph",
            "find every invocation of the helper",
            "rewrite all invocations",
            "locate all usages of the legacy helper",
            "find every usage of this method",
        ):
            with self.subTest(message=message):
                self.assertNotEqual(self.mode(message), "structural-search")

    def test_caller_id_stays_silent(self):
        """Once covered by a `caller id` lookahead; now silent because no who-term
        exists at all. Kept because the case is still worth pinning."""
        for message in (
            "search the caller ID logs",
            "find the caller id for this session",
        ):
            with self.subTest(message=message):
                self.assertNotEqual(self.mode(message), "structural-search")

    def test_the_prior_negatives_did_not_regress(self):
        for message in (
            "find the login handler",
            "search for TODO comments",
            "grep for the error string",
            "find the bug",
            "add a declaration for this variable",
            "check the call site of this bug",
            "the imports are messy",
        ):
            with self.subTest(message=message):
                self.assertNotEqual(self.mode(message), "structural-search")

    def test_every_named_limit_carries_a_real_explanation(self):
        limits = self.core.VOCABULARY_PREDICATE_LIMITS
        self.assertGreaterEqual(len(limits), 4)
        for name, reason in limits:
            with self.subTest(limit=name):
                self.assertTrue(name.strip())
                self.assertGreater(len(reason), 80,
                                   "a structural limit needs an explanation, not a label")

    def test_the_paraphrase_gap_is_real_and_still_open(self):
        """The register claims no vocabulary predicate reaches this. Assert it.

        If someone later makes this route, the register entry is stale and this
        test is the thing that says so.
        """
        self.assertIsNone(self.mode("where is this function used from?"))

    def test_the_former_domain_collision_is_now_moot(self):
        """It routed while `callers?` was a shape term. The register says the
        English collision is moot now; assert that rather than leave it stale."""
        self.assertIsNone(self.mode("find out who the callers were"))

    def test_the_accepted_misses_are_real_and_pinned(self):
        """`show` and `list` are not search verbs. Trade named in the register:
        one rephrase costs less than injecting a skill into unrelated work."""
        for message in ("show me the call graph", "list all callers"):
            with self.subTest(message=message):
                self.assertIsNone(self.mode(message))

    def test_the_verb_half_must_stay_narrow(self):
        """Measured: adding `check`/`update` flipped 7 of 7 adversarial prompts.
        Guards the asymmetry — shapes may widen, verbs may not."""
        for message in (
            "check the call site of this bug",
            "update the import list in the README",
            "check if the declaration is correct",
            "update the function signature docs",
            "check the imports",
        ):
            with self.subTest(message=message):
                self.assertIsNone(self.mode(message))


class SyntaxIsNotSemantics(unittest.TestCase):
    """The router must not outrun — or contradict — the skill's own stated scope.

    Two false positives were measured here: `find references to this symbol` is a
    binding-resolution question, and `search for references to the old API in the
    docs` targets prose. Worse than the routing miss, the skill body contained
    ZERO mentions of lsp, semantic, or symbol, so nothing anywhere told the model
    the answer it was about to give was out of scope.
    """

    @classmethod
    def setUpClass(cls):
        cls.pkg = _load_plugin_package()
        cls.core = cls.pkg.core
        cls.skill = (Path(cls.pkg.__file__).resolve().parent
                     / "skills" / "structural-search" / "SKILL.md").read_text(encoding="utf-8")

    def mode(self, message):
        route = self.core.detect_lit_mode(message)
        return route.mode if route else None

    def test_semantic_questions_do_not_route_here(self):
        for message in (
            "find references to this symbol",
            "search for references to the old API in the docs",
            # Reclassified. This was a shipped POSITIVE until the boundary was
            # drawn — proof that the boundary is not free, and that the cost is
            # a request which was routing and now does not.
            "find every reference to the old api",
        ):
            with self.subTest(message=message):
                self.assertNotEqual(self.mode(message), "structural-search")

    def test_removing_references_to_lost_nothing_real(self):
        """The rewrite case it was covering still routes through `call sites`."""
        self.assertEqual(
            self.mode("migrate the call sites to the new signature"), "structural-search")

    def test_syntax_shape_stands_on_its_own(self):
        """It previously rode on `imports`; the donor list carried only `syntax tree`."""
        self.assertTrue(self.core.detect_structural_intent("rewrite this by syntax shape"))

    def test_the_skill_body_states_what_it_is_not_for(self):
        self.assertIn("Syntax is not semantics", self.skill)
        self.assertIn("lithermes:lsp", self.skill)

    def test_the_skill_body_names_lsp_as_the_semantic_destination(self):
        """A boundary with no destination is a complaint, not a route."""
        self.assertIn("lithermes:lsp-setup", self.skill)
        self.assertRegex(self.skill, r"find references to this symbol.*lithermes:lsp")

    def test_the_injected_contract_carries_the_boundary_too(self):
        """The model sees the injected body, not the file on disk."""
        from importlib import import_module
        contexts = import_module("lithermes_plugin_pkg.core_contexts")
        body = contexts.build_natural_mode_context(
            self.core.detect_lit_mode("find every call site"))
        self.assertIn("SCOPE BOUNDARY", body)
        self.assertIn("lithermes:lsp", body)

    def test_the_body_warns_the_match_is_wrong_in_both_directions(self):
        """Over-match on comments/strings AND under-match on aliases and reflection."""
        self.assertIn("comments, strings", self.skill)
        self.assertIn("reflection", self.skill)


if __name__ == "__main__":
    unittest.main()
