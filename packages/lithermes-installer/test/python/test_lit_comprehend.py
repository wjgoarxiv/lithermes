"""lit-comprehend skill enrollment and activation routing.

Covers registration, named-token activation, negative controls for natural
language phrases, skill body injection, execution gate contract, side-effect-
freedom, and the bundled verifier script.
"""

from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

_HERE = os.path.dirname(os.path.abspath(__file__))
_ASSET_DIR = os.path.normpath(os.path.join(_HERE, "..", "..", "assets", "lithermes-plugin"))
if _ASSET_DIR not in sys.path:
    sys.path.insert(0, _ASSET_DIR)

SKILL_DIR = os.path.join(_ASSET_DIR, "skills", "lit-comprehend")
SKILL_MD = os.path.join(SKILL_DIR, "SKILL.md")
VERIFIER = os.path.join(SKILL_DIR, "scripts", "verify-explainer.py")
SCAFFOLD = os.path.join(SKILL_DIR, "assets", "explainer-scaffold.html")
ARTIFACT_TEMPLATE = os.path.join(SKILL_DIR, "references", "artifact-template.md")
MICRO_WORLDS = os.path.join(SKILL_DIR, "references", "micro-worlds.md")


def _load_plugin_package():
    spec = importlib.util.spec_from_file_location(
        "lithermes_litcomprehend_pkg",
        os.path.join(_ASSET_DIR, "__init__.py"),
        submodule_search_locations=[_ASSET_DIR],
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["lithermes_litcomprehend_pkg"] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _load_verifier():
    spec = importlib.util.spec_from_file_location("verify_explainer", VERIFIER)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


class _FakeCtx:
    def __init__(self):
        self.command_handlers = {}
        self.hooks = []
        self.tools = []
        self.cli_commands = []
        self.skills = []

    def register_hook(self, name, cb):
        self.hooks.append((name, cb))

    def register_tool(self, name, toolset, schema, handler, description="", **kw):
        self.tools.append(name)

    def register_cli_command(self, name, help, setup_fn, handler_fn=None, description=""):
        self.cli_commands.append(name)

    def register_command(self, name, handler, description="", args_hint=""):
        self.command_handlers[name] = handler

    def register_skill(self, name, path, description=""):
        self.skills.append(name)


class LitComprehendRegistration(unittest.TestCase):
    """The lit-comprehend skill is registered in PORTED_SKILLS."""

    def test_lit_comprehend_registered_as_skill(self):
        pkg = _load_plugin_package()
        ctx = _FakeCtx()
        pkg.register(ctx)
        self.assertIn("lit-comprehend", ctx.skills)

    def test_lit_comprehend_in_ported_skills(self):
        pkg = _load_plugin_package()
        names = [name for name, _ in pkg.PORTED_SKILLS]
        self.assertIn("lit-comprehend", names)


class LitComprehendSkillContent(unittest.TestCase):
    """SKILL.md contains required contract headings and domain terms."""

    def test_skill_md_exists(self):
        self.assertTrue(os.path.isfile(SKILL_MD))

    def test_skill_md_has_contract_headings(self):
        content = Path(SKILL_MD).read_text(encoding="utf-8")
        for heading in (
            "#contract.activation",
            "#contract.inputs",
            "#contract.mode_matrix",
            "#contract.execution_gate",
            "#contract.procedure",
            "#contract.outputs",
            "#contract.evidence",
            "#contract.hard_stops",
            "#contract.anti_patterns",
        ):
            self.assertIn(heading, content, f"Missing contract heading: {heading}")

    def test_skill_md_has_canonical_sections(self):
        content = Path(SKILL_MD).read_text(encoding="utf-8")
        for section in ("한눈에", "이미 알고 있던 것", "직관", "바뀐 것", "직접 만져보기",
                        "퀴즈", "다음"):
            self.assertIn(section, content, f"Missing canonical section: {section}")

    def test_reader_facing_artifact_uses_natural_prose_not_audit_sections(self):
        content = Path(SKILL_MD).read_text(encoding="utf-8")
        self.assertIn("reader-facing", content.lower())
        self.assertIn("evidence table", content.lower())
        self.assertIn("citations", content.lower())
        self.assertIn("internal", content.lower())
        self.assertIn("artifact_genre: client_deliverable", content)
        self.assertIn("limitations_channel: reply", content)
        verifier = _load_verifier()
        self.assertEqual(
            verifier.CANONICAL_SECTIONS,
            ("한눈에", "이미 알고 있던 것", "직관", "바뀐 것", "직접 만져보기", "퀴즈", "다음"),
        )

    def test_skill_md_has_domain_terms(self):
        content = Path(SKILL_MD).read_text(encoding="utf-8")
        for term in ("delta anchor", "conceptual order", "micro-world",
                      "verify-explainer", "data-src", "citations", "--en", "--md"):
            self.assertIn(term, content, f"Missing domain term: {term}")

    def test_skill_md_mentions_lit_recap_distinction(self):
        content = Path(SKILL_MD).read_text(encoding="utf-8")
        self.assertIn("lit-recap", content)

    def test_skill_md_mentions_output_path(self):
        content = Path(SKILL_MD).read_text(encoding="utf-8")
        self.assertIn("~/.lithermes/lit-comprehend/", content)


class LitComprehendBundledAssets(unittest.TestCase):
    """Scaffold, references, and verifier exist and are well-formed."""

    def test_scaffold_exists(self):
        self.assertTrue(os.path.isfile(SCAFFOLD))

    def test_scaffold_is_self_contained(self):
        content = Path(SCAFFOLD).read_text(encoding="utf-8")
        self.assertNotRegex(content, r'<script[^>]+src\s*=\s*["\']https?://')
        self.assertNotRegex(content, r'<link[^>]+href\s*=\s*["\']https?://')

    def test_scaffold_has_quiz_markup(self):
        content = Path(SCAFFOLD).read_text(encoding="utf-8")
        self.assertIn("quiz-q", content)
        self.assertIn("dataset.answer", content)

    def test_scaffold_has_pre_wrap(self):
        content = Path(SCAFFOLD).read_text(encoding="utf-8")
        self.assertIn("white-space", content)
        self.assertIn("pre-wrap", content)

    def test_artifact_template_exists(self):
        self.assertTrue(os.path.isfile(ARTIFACT_TEMPLATE))

    def test_micro_worlds_exists(self):
        self.assertTrue(os.path.isfile(MICRO_WORLDS))

    def test_verifier_exists(self):
        self.assertTrue(os.path.isfile(VERIFIER))


class LitComprehendRouting(unittest.TestCase):
    """Named-token routing: bare lit-comprehend, bare comprehend, and lit comprehend activate."""

    def _hook(self, message, session="test-lit-comprehend"):
        try:
            from core_routing import detect_lit_mode
        except ImportError:
            from core_routing import detect_lit_mode
        return detect_lit_mode(message)

    def test_bare_lit_comprehend_routes(self):
        route = self._hook("lit-comprehend")
        self.assertIsNotNone(route)
        self.assertEqual(route.mode, "lit-comprehend")

    def test_bare_lit_comprehend_with_args_routes(self):
        route = self._hook("lit-comprehend HEAD~5..HEAD")
        self.assertIsNotNone(route)
        self.assertEqual(route.mode, "lit-comprehend")

    def test_bare_comprehend_alias_routes(self):
        route = self._hook("comprehend")
        self.assertIsNotNone(route)
        self.assertEqual(route.mode, "lit-comprehend")

    def test_bare_comprehend_alias_with_args_routes(self):
        route = self._hook("comprehend HEAD~5..HEAD")
        self.assertIsNotNone(route)
        self.assertEqual(route.mode, "lit-comprehend")

    def test_lit_comprehend_routes(self):
        route = self._hook("lit comprehend")
        self.assertIsNotNone(route)
        self.assertEqual(route.mode, "lit-comprehend")

    def test_lit_comprehend_with_args_routes(self):
        route = self._hook("lit comprehend src/lib/")
        self.assertIsNotNone(route)
        self.assertEqual(route.mode, "lit-comprehend")

    def test_lit_lit_comprehend_routes(self):
        route = self._hook("lit lit-comprehend")
        self.assertIsNotNone(route)
        self.assertEqual(route.mode, "lit-comprehend")


class LitComprehendNegativeControls(unittest.TestCase):
    """Common natural-language phrases must NOT activate lit-comprehend."""

    def _hook(self, message):
        try:
            from core_routing import detect_lit_mode
        except ImportError:
            from core_routing import detect_lit_mode
        return detect_lit_mode(message)

    def test_explain_does_not_activate(self):
        route = self._hook("explain this function to me")
        if route is not None:
            self.assertNotEqual(route.mode, "lit-comprehend")

    def test_korean_explain_does_not_activate(self):
        route = self._hook("설명해줘")
        self.assertIsNone(route)

    def test_korean_dont_understand_does_not_activate(self):
        route = self._hook("이해가 안 돼")
        self.assertIsNone(route)

    def test_what_did_you_do_does_not_activate(self):
        route = self._hook("what did you do in this session?")
        self.assertIsNone(route)

    def test_comprehension_does_not_activate(self):
        route = self._hook("comprehension test for the parser")
        self.assertIsNone(route)

    def test_incomprehensible_does_not_activate(self):
        route = self._hook("incomprehensible error message")
        self.assertIsNone(route)

    def test_code_span_does_not_activate(self):
        route = self._hook("document `comprehend` only")
        self.assertIsNone(route)

    def test_fenced_code_does_not_activate(self):
        route = self._hook("```text\ncomprehend this\n```")
        self.assertIsNone(route)

    def test_slash_command_does_not_activate(self):
        route = self._hook("/comprehend build summary")
        self.assertIsNone(route)

    def test_substring_comprehending_does_not_activate(self):
        route = self._hook("I'm comprehending the architecture")
        self.assertIsNone(route)


class LitComprehendExecutionGate(unittest.TestCase):
    """Execution gate contract is present in SKILL.md and route context."""

    def test_skill_md_has_execution_gate_section(self):
        content = Path(SKILL_MD).read_text(encoding="utf-8")
        self.assertIn("#contract.execution_gate", content)

    def test_skill_md_gate_describes_confirm_first(self):
        content = Path(SKILL_MD).read_text(encoding="utf-8")
        for term in ("대상", "제외", "예상"):
            self.assertIn(term, content, f"Gate confirmation step missing term: {term}")

    def test_skill_md_gate_describes_execute_immediately(self):
        content = Path(SKILL_MD).read_text(encoding="utf-8")
        self.assertIn("Execute immediately", content)
        self.assertIn("Confirm first", content)

    def test_route_contract_mentions_gate(self):
        try:
            from core_contexts import _SKILL_ROUTE_CONTRACTS
        except ImportError:
            from core_contexts import _SKILL_ROUTE_CONTRACTS
        contract = _SKILL_ROUTE_CONTRACTS.get("lit-comprehend", ())
        contract_text = " ".join(contract)
        self.assertIn("scope confirmation", contract_text.lower(),
                      "Route contract must mention scope confirmation for the execution gate")


class LitComprehendSideEffects(unittest.TestCase):
    """Lit-comprehend activation must not write run state or bind goals."""

    def test_activation_does_not_write_run_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            prev = os.getcwd()
            os.chdir(tmp)
            try:
                try:
                    from core_routing import detect_lit_mode
                except ImportError:
                    from core_routing import detect_lit_mode
                route = detect_lit_mode("lit-comprehend")
                self.assertIsNotNone(route)
                self.assertFalse(
                    (Path(tmp) / ".hermes" / "lithermes" / "runs").exists(),
                    "lit-comprehend activation created run state",
                )
            finally:
                os.chdir(prev)


class LitComprehendVerifier(unittest.TestCase):
    """The bundled Python verifier correctly passes and fails artifacts."""

    def setUp(self):
        self.verifier = _load_verifier()
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _good_artifact(self) -> str:
        """Create a minimal conforming artifact."""
        path = os.path.join(self.tmp, "2026-08-01-test-skill.html")
        content = textwrap.dedent("""\
        <!DOCTYPE html>
        <html lang="ko"><head><meta charset="utf-8"><title>Test</title>
        <style>pre { white-space: pre-wrap; }</style></head><body>
        <h2>한눈에</h2><p>테스트 설명입니다.</p>
        <h2>이미 알고 있던 것</h2><p>목표와 배경.</p>
        <h2>직관</h2><p>핵심 개념.</p>
        <h2>바뀐 것</h2><p>변경 사항 설명.</p>
        <pre data-src="src/example.py:1-3">def hello():
            return 42</pre>
        <h2>직접 만져보기</h2><div class="world"><p>위젯.</p></div>
        <div class="quiz-q" data-answer="1">
        <p>Q1</p>
        <button class="opt" data-i="0">A</button>
        <button class="opt" data-i="1">B</button>
        <button class="opt" data-i="2">C</button>
        <div class="fb" data-i="0">wrong</div>
        <div class="fb" data-i="1">correct</div>
        <div class="fb" data-i="2">wrong</div>
        </div>
        <div class="quiz-q" data-answer="0">
        <p>Q2</p>
        <button class="opt" data-i="0">A</button>
        <button class="opt" data-i="1">B</button>
        <button class="opt" data-i="2">C</button>
        <div class="fb" data-i="0">correct</div>
        <div class="fb" data-i="1">wrong</div>
        <div class="fb" data-i="2">wrong</div>
        </div>
        <div class="quiz-q" data-answer="2">
        <p>Q3</p>
        <button class="opt" data-i="0">A</button>
        <button class="opt" data-i="1">B</button>
        <button class="opt" data-i="2">C</button>
        <div class="fb" data-i="0">wrong</div>
        <div class="fb" data-i="1">wrong</div>
        <div class="fb" data-i="2">correct</div>
        </div>
        <h2>퀴즈</h2>
        <h2>다음</h2><ol><li>다음 단계 1</li></ol>
        </body></html>
        """)
        Path(path).write_text(content, encoding="utf-8")
        return path

    def test_green_baseline(self):
        path = self._good_artifact()
        findings = self.verifier.verify(path)
        fails = [f for f in findings if not f.warn]
        self.assertEqual(len(fails), 0, f"Unexpected failures: {[f.message for f in fails]}")

    def test_green_reader_artifact_without_audit_sections(self):
        path = self._good_artifact()
        content = Path(path).read_text(encoding="utf-8")
        self.assertNotIn("<h2>확인 안 된 것</h2>", content)
        self.assertNotIn("<h2>증거</h2>", content)
        findings = self.verifier.verify(path)
        fails = [f for f in findings if not f.warn]
        self.assertEqual(
            len(fails), 0,
            f"Reader prose should not require audit sections: {[f.message for f in fails]}",
        )

    def test_green_reader_artifact_can_cite_a_relevant_source_naturally(self):
        path = self._good_artifact()
        content = Path(path).read_text(encoding="utf-8")
        content = content.replace(
            "<h2>한눈에</h2><p>테스트 설명입니다.</p>",
            '<h2>한눈에</h2><p>테스트 설명입니다. '
            '<a href="https://example.org/spec">명세서</a>에서 입력 형식을 확인했습니다.</p>',
        )
        Path(path).write_text(content, encoding="utf-8")
        findings = self.verifier.verify(path)
        fails = [f for f in findings if not f.warn]
        self.assertEqual(len(fails), 0, f"Citation should remain allowed: {[f.message for f in fails]}")

    def test_red_missing_section(self):
        path = os.path.join(self.tmp, "2026-08-01-missing.html")
        content = "<html><body><h2>한눈에</h2><p>test</p></body></html>"
        Path(path).write_text(content, encoding="utf-8")
        findings = self.verifier.verify(path)
        checks = {f.check for f in findings if not f.warn}
        self.assertIn("sections", checks)

    def test_red_external_resource(self):
        path = os.path.join(self.tmp, "2026-08-01-external.html")
        content = textwrap.dedent("""\
        <!DOCTYPE html><html><body>
        <script src="https://cdn.example.com/lib.js"></script>
        <h2>한눈에</h2><h2>이미 알고 있던 것</h2><h2>직관</h2>
        <h2>바뀐 것</h2><h2>직접 만져보기</h2><h2>확인 안 된 것</h2>
        <p>읽기만 함: core.py의 pre_llm_call 함수를 이 세션에서 실행하지 않음, 미완료: 성능 테스트는 아직 수행되지 않았으며 향후 검증 필요</p>
        <h2>증거</h2><h2>퀴즈</h2>
        <div class="quiz-q" data-answer="0"><p>Q1</p>
        <button class="opt" data-i="0">A</button><button class="opt" data-i="1">B</button><button class="opt" data-i="2">C</button>
        <div class="fb" data-i="0">ok</div><div class="fb" data-i="1">no</div><div class="fb" data-i="2">no</div></div>
        <div class="quiz-q" data-answer="1"><p>Q2</p>
        <button class="opt" data-i="0">A</button><button class="opt" data-i="1">B</button><button class="opt" data-i="2">C</button>
        <div class="fb" data-i="0">no</div><div class="fb" data-i="1">ok</div><div class="fb" data-i="2">no</div></div>
        <div class="quiz-q" data-answer="2"><p>Q3</p>
        <button class="opt" data-i="0">A</button><button class="opt" data-i="1">B</button><button class="opt" data-i="2">C</button>
        <div class="fb" data-i="0">no</div><div class="fb" data-i="1">no</div><div class="fb" data-i="2">ok</div></div>
        <h2>다음</h2></body></html>
        """)
        Path(path).write_text(content, encoding="utf-8")
        findings = self.verifier.verify(path)
        checks = {f.check for f in findings if not f.warn}
        self.assertIn("self-contained", checks)

    def test_red_inside_repo(self):
        with tempfile.TemporaryDirectory() as repo:
            path = os.path.join(repo, "2026-08-01-inside.html")
            Path(path).write_text("<html><body>test</body></html>", encoding="utf-8")
            findings = self.verifier.verify(path, repo_dir=repo)
            checks = {f.check for f in findings if not f.warn}
            self.assertIn("outside-repo", checks)

    def test_red_undated_filename(self):
        path = os.path.join(self.tmp, "my-explainer.html")
        Path(path).write_text("<html><body>test</body></html>", encoding="utf-8")
        findings = self.verifier.verify(path)
        checks = {f.check for f in findings if not f.warn}
        self.assertIn("filename-dated", checks)

    def test_red_phantom_quote(self):
        with tempfile.TemporaryDirectory() as repo:
            src = Path(repo) / "real.py"
            src.write_text("def hello():\n    return 42\n", encoding="utf-8")
            path = os.path.join(self.tmp, "2026-08-01-phantom.html")
            all_sections = self._sections_html()
            content = textwrap.dedent(f"""\
            <!DOCTYPE html><html><body>
            {all_sections}
            <pre data-src="real.py">
            this line does not exist in the file at all
            another fabricated line that is completely wrong
            yet another phantom line with no match in the source
            a fourth phantom line to ensure ratio is well below 60 percent
            a fifth phantom line for good measure in the test artifact
            </pre>
            </body></html>
            """)
            Path(path).write_text(content, encoding="utf-8")
            findings = self.verifier.verify(path, repo_dir=repo)
            checks = {f.check for f in findings if not f.warn}
            self.assertIn("quotes-real", checks)

    def test_red_nonexistent_quoted_file(self):
        with tempfile.TemporaryDirectory() as repo:
            path = os.path.join(self.tmp, "2026-08-01-nofile.html")
            all_sections = self._sections_html()
            content = textwrap.dedent(f"""\
            <!DOCTYPE html><html><body>
            {all_sections}
            <pre data-src="does_not_exist.py">
            some code here
            </pre>
            </body></html>
            """)
            Path(path).write_text(content, encoding="utf-8")
            findings = self.verifier.verify(path, repo_dir=repo)
            checks = {f.check for f in findings if not f.warn}
            self.assertIn("quotes-real", checks)

    def test_red_positional_tell(self):
        path = os.path.join(self.tmp, "2026-08-01-positional.html")
        all_sections = self._sections_html()
        quiz = ""
        for i in range(5):
            quiz += textwrap.dedent(f"""\
            <div class="quiz-q" data-answer="1">
            <p>Q{i+1}</p>
            <button class="opt" data-i="0">A</button>
            <button class="opt" data-i="1">B</button>
            <button class="opt" data-i="2">C</button>
            <div class="fb" data-i="0">no</div>
            <div class="fb" data-i="1">yes</div>
            <div class="fb" data-i="2">no</div>
            </div>
            """)
        content = f"<!DOCTYPE html><html><body>{all_sections}{quiz}</body></html>"
        Path(path).write_text(content, encoding="utf-8")
        findings = self.verifier.verify(path)
        checks = {f.check for f in findings if not f.warn}
        self.assertIn("quiz", checks)

    def test_red_missing_feedback(self):
        path = os.path.join(self.tmp, "2026-08-01-nofeedback.html")
        all_sections = self._sections_html()
        quiz = textwrap.dedent("""\
        <div class="quiz-q" data-answer="0">
        <p>Q1</p>
        <button class="opt" data-i="0">A</button>
        <button class="opt" data-i="1">B</button>
        <button class="opt" data-i="2">C</button>
        <div class="fb" data-i="0">correct</div>
        </div>
        <div class="quiz-q" data-answer="1">
        <p>Q2</p>
        <button class="opt" data-i="0">A</button>
        <button class="opt" data-i="1">B</button>
        <button class="opt" data-i="2">C</button>
        <div class="fb" data-i="0">no</div>
        <div class="fb" data-i="1">yes</div>
        <div class="fb" data-i="2">no</div>
        </div>
        <div class="quiz-q" data-answer="2">
        <p>Q3</p>
        <button class="opt" data-i="0">A</button>
        <button class="opt" data-i="1">B</button>
        <button class="opt" data-i="2">C</button>
        <div class="fb" data-i="0">no</div>
        <div class="fb" data-i="1">no</div>
        <div class="fb" data-i="2">yes</div>
        </div>
        """)
        content = f"<!DOCTYPE html><html><body>{all_sections}{quiz}</body></html>"
        Path(path).write_text(content, encoding="utf-8")
        findings = self.verifier.verify(path)
        checks = {f.check for f in findings if not f.warn}
        self.assertIn("quiz", checks)

    def test_red_ascii_art(self):
        path = os.path.join(self.tmp, "2026-08-01-ascii.html")
        all_sections = self._sections_html()
        content = f"<!DOCTYPE html><html><body>{all_sections}\n<p>┌──────┐</p></body></html>"
        Path(path).write_text(content, encoding="utf-8")
        findings = self.verifier.verify(path)
        checks = {f.check for f in findings if not f.warn}
        self.assertIn("no-ascii-art", checks)

    def test_red_collapsed_code(self):
        path = os.path.join(self.tmp, "2026-08-01-collapsed.html")
        all_sections = self._sections_html()
        content = f"<!DOCTYPE html><html><body>{all_sections}\n<details><summary>Code</summary><pre>x = 1</pre></details></body></html>"
        Path(path).write_text(content, encoding="utf-8")
        findings = self.verifier.verify(path)
        checks = {f.check for f in findings if not f.warn}
        self.assertIn("no-collapsed-code", checks)

    def test_red_unattributed_code(self):
        path = os.path.join(self.tmp, "2026-08-01-noattr.html")
        all_sections = self._sections_html()
        content = f"<!DOCTYPE html><html><body>{all_sections}\n<pre>def hello():\n    return 42</pre></body></html>"
        Path(path).write_text(content, encoding="utf-8")
        findings = self.verifier.verify(path)
        checks = {f.check for f in findings if not f.warn}
        self.assertIn("code-attribution", checks)

    def test_red_partially_unattributed_code(self):
        path = os.path.join(self.tmp, "2026-08-01-partial-attribution.html")
        all_sections = self._sections_html()
        content = (
            f"<!DOCTYPE html><html><body>{all_sections}"
            '<pre data-src="src/one.py">first()</pre><pre>second()</pre>'
            "</body></html>"
        )
        Path(path).write_text(content, encoding="utf-8")
        findings = self.verifier.verify(path)
        checks = {f.check for f in findings if not f.warn}
        self.assertIn("code-attribution", checks)

    def _sections_html(self) -> str:
        return textwrap.dedent("""\
        <h2>한눈에</h2><p>개요.</p>
        <h2>이미 알고 있던 것</h2><p>배경.</p>
        <h2>직관</h2><p>핵심.</p>
        <h2>바뀐 것</h2><p>변경.</p>
        <h2>직접 만져보기</h2><div class="world"><p>위젯.</p></div>
        <h2>퀴즈</h2>
        <div class="quiz-q" data-answer="0"><p>Q1</p>
        <button class="opt" data-i="0">A</button><button class="opt" data-i="1">B</button><button class="opt" data-i="2">C</button>
        <div class="fb" data-i="0">ok</div><div class="fb" data-i="1">no</div><div class="fb" data-i="2">no</div></div>
        <div class="quiz-q" data-answer="1"><p>Q2</p>
        <button class="opt" data-i="0">A</button><button class="opt" data-i="1">B</button><button class="opt" data-i="2">C</button>
        <div class="fb" data-i="0">no</div><div class="fb" data-i="1">ok</div><div class="fb" data-i="2">no</div></div>
        <div class="quiz-q" data-answer="2"><p>Q3</p>
        <button class="opt" data-i="0">A</button><button class="opt" data-i="1">B</button><button class="opt" data-i="2">C</button>
        <div class="fb" data-i="0">no</div><div class="fb" data-i="1">no</div><div class="fb" data-i="2">ok</div></div>
        <h2>다음</h2><ol><li>다음 1</li></ol>
        """)


if __name__ == "__main__":
    unittest.main()
