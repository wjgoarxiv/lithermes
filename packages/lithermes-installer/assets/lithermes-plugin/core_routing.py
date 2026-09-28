from __future__ import annotations

import re
from dataclasses import dataclass

try:
    from .core_contract import KOREAN_PROSE_NATURAL_PHRASES, UI_SURFACE_NOUNS
    from .core_runtime import _clamp_task
except (ImportError, ModuleNotFoundError):
    from core_contract import KOREAN_PROSE_NATURAL_PHRASES, UI_SURFACE_NOUNS
    from core_runtime import _clamp_task

# Fire on a standalone `lit`/`litwork` token delimited by whitespace, string
# edge, or punctuation — but NOT inside a larger word ("split", "literally"),
# NOT as a hyphen/underscore compound ("lit-review", "lit_loop"), and NOT when
# the token is path/slash-command embedded (`/lit`, `/tmp/lit.sock`). Path-like
# slash tokens elsewhere in the prompt do not suppress a valid standalone token.
LIT_PATTERN = re.compile(r"(?<![\w/-])(?:litwork|lit)(?![\w/-])", re.IGNORECASE)
DIRECT_LIT_PATTERN = re.compile(r"^\s*(?:lit|litwork)(?![\w-])\s+(?P<task>.+?)\s*$", re.IGNORECASE | re.DOTALL)

@dataclass(frozen=True)
class NaturalLitRoute:
    mode: str
    objective: str = ""
    visible_message: str = ""
    blocked: bool = False
    block_message: str = ""
    deprecation_note: str = ""


# One-release compatibility only; remove these aliases in the next minor.
SKILL_RENAME_ALIASES = {
    "hyperplan": "lit-crucible",
    "init-deep": "lit-init",
    "git-master": "lit-commit",
    "remove-ai-slops": "lit-burnoff",
    "ai-slop-remover": "lit-burnoff-file",
    "lit-korean": "lit-humanizer",
    "text-naturalization": "lit-humanizer",
    "text-neutralization": "lit-humanizer",
    "korean-ai-slop-remover": "lit-humanizer",
    "programming": "lit-code",
}
_RENAMED_ROUTE_ALIASES = {**SKILL_RENAME_ALIASES, "teammode": "lit-team"}
_RENAMED_ROUTE_WORDS = {
    **{name: name for name in _RENAMED_ROUTE_ALIASES.values()},
    **_RENAMED_ROUTE_ALIASES,
}


def skill_rename_note(old: str) -> str:
    new = _RENAMED_ROUTE_ALIASES[old]
    return f"Note: `{old}` was renamed to `{new}`; the old name is removed in the next minor."


def _renamed_skill_route(text: str, visible: str, source: str, offset: int = 0) -> NaturalLitRoute | None:
    for word, name in _RENAMED_ROUTE_WORDS.items():
        match = re.match(rf"^\s*{re.escape(word)}(?![\w-])(?P<rest>.*)$", text, re.IGNORECASE | re.DOTALL)
        if match is not None:
            rest = match.group("rest").strip()
            if name == "lit-humanizer":
                # Only the trigger is parsed as instructions. Retain code spans
                # and fences in the original prose for the escaped content path.
                rest = source[offset + match.start("rest"):].strip()
            return NaturalLitRoute(
                mode=(
                    "korean-prose-cleanup" if name == "lit-humanizer" and word in SKILL_RENAME_ALIASES
                    else "kanban-team" if name == "lit-team"
                    else name
                ),
                objective=_clamp_task(rest),
                visible_message=visible,
                deprecation_note=skill_rename_note(word) if word in _RENAMED_ROUTE_ALIASES else "",
            )
    return None

# Intent-shaped skill routes.
#
# A skill whose description is a statement of intent ("refactor", "MUST USE
# whenever a task needs a commit") has no event that can fire it, so the only
# honest route is the user naming it. These match at message start only —
# `_after_mode_word` anchors on `^` — so "can you refactor this" does not
# activate and "refactoring" does not either (`(?![\w-])` rejects the suffix).
_BARE_SKILL_PREFIXES = (
    ("autoconference", "autoconference"),
    ("autoresearch", "autoresearch"),
    ("wikify", "wikify"),
    ("litresearch", "litresearch"),
    ("lit-comprehend", "lit-comprehend"),
    ("humanizer", "lit-humanizer"),
    ("lit-humanizer", "lit-humanizer"),
    ("comprehend", "lit-comprehend"),
    ("comment-checker", "comment-checker"),
    ("lsp-setup", "lsp-setup"),
    ("lsp", "lsp"),
    ("refactor", "refactor"),
    ("debugging", "debugging"),
    ("rules", "rules"),
    # Design work needs its guidance at the moment the user SAYS they are designing,
    # not after the first .css edit — the event route in core_contract.py covers the
    # after case and stays. Both ids are hyphenated compounds, so neither can be
    # reached by an ordinary English sentence; see the token-shape note below.
    ("frontend-ui-ux", "frontend-ui-ux"),
    ("lit-diagram-drawer", "lit-diagram-drawer"),
    ("lit-pptx", "lit-pptx"),
    ("lit-docx", "lit-docx"),
    ("lit-typographic-motion", "lit-typographic-motion"),
    ("readme-studio", "readme-studio"),
    ("visual-qa", "visual-qa"),
    ("structural-search", "structural-search"),
    # Name-only, deliberately. A message that merely mentions a browser, a URL, or
    # the web is not a request to drive one, and over-firing is a recorded defect
    # shape in this family. The hyphenated compound cannot open an ordinary sentence.
    ("browser-drive", "browser-drive"),
    # Name-only for the same reason as browser-drive: "observe", "review", and
    # "the skill fell short" are ordinary English about ordinary work.
)

# TOKEN SHAPE — why these two get a bare route and `design` / `ui` / `visual` do not.
#
# `_after_mode_word` anchors at message start and rejects a `[\w-]` continuation, so a
# bare token fires only when the message OPENS with it as a whole word. That makes a
# hyphenated compound id ("frontend-ui-ux", "visual-qa") safe: no ordinary sentence
# begins with one, and "frontend-ui-ux-team" / "visual-qa-runner" are rejected by the
# hyphen guard. Common words can open ordinary sentences, so `design`, `ui`, `ux`,
# and `visual` are NOT bare routes here; `design` is reachable only after an
# explicit `lit`, where intent is declared.

# The same skills after an explicit `lit` token, plus the natural single words a
# user reaches for there ("lit debug the parser"). Order is irrelevant to
# correctness — `_after_mode_word` requires a full-token match — but the
# hyphenated ids stay first so the intent reads in the same order as above.
_LIT_SKILL_SUFFIXES = (
    ("autoconference", "autoconference"),
    ("autoresearch", "autoresearch"),
    ("wikify", "wikify"),
    ("lit-comprehend", "lit-comprehend"),
    ("comprehend", "lit-comprehend"),
    ("comment-checker", "comment-checker"),
    ("lsp-setup", "lsp-setup"),
    ("lsp", "lsp"),
    ("refactor", "refactor"),
    ("debugging", "debugging"),
    ("debug", "debugging"),
    ("git", "lit-commit"),
    ("comments", "comment-checker"),
    ("slop", "lit-burnoff"),
    ("rules", "rules"),
    ("frontend-ui-ux", "frontend-ui-ux"),
    ("lit-diagram-drawer", "lit-diagram-drawer"),
    ("lit-pptx", "lit-pptx"),
    ("lit-docx", "lit-docx"),
    ("lit-typographic-motion", "lit-typographic-motion"),
    ("readme-studio", "readme-studio"),
    ("visual-qa", "visual-qa"),
    # `design` is safe HERE and only here: the user already typed `lit`, so intent is
    # declared. It is deliberately not a bare route.
    ("design", "frontend-ui-ux"),
    ("structural-search", "structural-search"),
    ("structural", "structural-search"),
    # No bare `browser` alias here: unlike `design`, it names a Hermes toolset that
    # already exists, so the short form would steal work from the host's own surface.
    ("browser-drive", "browser-drive"),
    # Name-only for the same reason as browser-drive: "observe", "review", and
    # "the skill fell short" are ordinary English about ordinary work.
)
_SEMANTIC_FAMILY_MODES = frozenset({"autoresearch", "autoconference", "wikify"})

# INTENT-SHAPED route for frontend-ui-ux.
#
# frontend-ui-ux is the one skill whose own name nobody types. Left name-only it is
# reachable only after editing has started, which is backwards for a skill that
# shapes what gets built. But no single word is a safe token: "design", "build" and
# "page" each fire on far too much.
#
# The conjunction is what makes it safe — a MAKING VERB and a USER-INTERFACE NOUN
# must BOTH appear. "build" alone would match everything; "build" plus a UI noun
# does not match "build the API client". Ported from the sibling product's routing
# module, which reached the same diagnosis independently.
# NOTE the mandatory whitespace in the two-word verbs. Written `lay ?out`, the
# verb also matches the NOUN "layout" — one word would then satisfy both halves
# by itself and the conjunction would collapse to a single common term. A negative
# test caught exactly that ("what does the layout algorithm do" fired).
UI_INTENT_VERBS = (
    "design", "redesign", "restyle", "revamp", "polish", r"lay\s+out", r"mock\s+up",
    "build", "create", "make", "implement", "style",
)
# The shared core comes from core_contract.UI_SURFACE_NOUNS so the chat route and
# the event-side regex cannot drift. These are the prose-only additions: they read
# as UI surfaces in a sentence but are not path/diff signals.
UI_INTENT_PROSE_NOUNS = (
    "user interface", "screen", "page", "layout", "modal", "navbar", "sidebar",
    "stylesheet", "css", "design system", "landing page", "theme", "styling", "web app",
)
UI_INTENT_NOUNS = tuple(UI_SURFACE_NOUNS) + UI_INTENT_PROSE_NOUNS

# ---- Korean ---------------------------------------------------------------
#
# The user writes Korean, so the capability has to be reachable in Korean. Same
# conjunction, same discrimination bar; only the matching rules differ, because
# the English sets lean on two properties Hangul does not have.
#
# 1. BOUNDARY. `\b` sits between a word char and a non-word char, and Hangul IS a
#    word char, so `\bUI\b` does not match "UI를" and `\b페이지\b` does not match
#    "페이지를" — a particle attaches directly to the stem. The boundary used here
#    is instead "not adjacent to a LATIN letter, digit, or underscore":
#        (?<![A-Za-z0-9_]) TERM (?![A-Za-z0-9_])
#    For an ASCII term this keeps real protection — "UI" matches "UI를" and "the UI
#    is fine" but NOT "guide", "GUIDE" or "UIKit". For a Hangul term the guard is
#    a no-op and the match is effectively a SUBSTRING.
#
#    ACCEPTED RISK, stated rather than left implicit: a Hangul noun can match
#    inside a longer compound — 페이지 matches inside 홈페이지, 화면 inside 화면비.
#    Every such compound seen so far is still a UI surface, so the failure mode is
#    a slightly wider true positive rather than a false one. It is a real risk and
#    the discrimination corpus below is what holds it down.
#
# 2. AGGLUTINATION. 디자인해줘 / 디자인하고 / 디자인할 / 디자인했다 are one verb. The
#    verb entries therefore match a STEM plus a conjugation marker rather than
#    enumerating inflections.
#
# 3. THE COLLISION, same shape as `lay ?out` vs the noun `layout`. 디자인 is both a
#    verb stem and the head of the noun phrase 디자인 시스템. A bare 디자인 verb would
#    let that noun phrase satisfy BOTH halves by itself and collapse the
#    conjunction — "디자인 시스템 문서를 봐줘" would fire. So the colliding stem
#    REQUIRES its 하다 marker: 디자인[하해할했함].
UI_INTENT_VERBS_KO = (
    r"디자인[하해할했함]",   # collides with the noun 디자인 시스템 — marker required
    r"리디자인", r"재디자인",
    r"설계[하해할했함]",
    r"만들", r"만드",        # 만들다: 만들어줘 / 만드는
    r"제작[하해할했함]",
    r"구현[하해할했함]",
    r"개선[하해할했함]",
    r"다듬",
    r"꾸미",
    r"리뉴얼",
)
# Hangul UI surfaces, plus the two ASCII terms that must survive an attached
# particle ("UI를"). These live here and NOT in UI_INTENT_NOUNS so no term is
# maintained in two places; test_no_term_is_maintained_in_two_places pins that.
UI_INTENT_NOUNS_KO = (
    # NOTE: UI / UX deliberately absent — they live in UI_INTENT_NOUNS and the
    # shared boundary below already matches them next to a Korean particle.
    # Duplicating them here is the drift hazard this module already fought once.
    "화면", "페이지", "레이아웃", "대시보드", "사이드바", "모달", "컴포넌트", "웹앱", r"웹\s+앱",
    "프론트엔드", "스타일시트", "내비게이션", "네비게이션",
    # 버튼 is the only component-level noun here and the only one with a MEASURED
    # containment leak: "버튼식 잠금장치 만들어줘" (a physical push-button lock) fired.
    # It still earns its place — "로그인 버튼 다시 디자인해줘" and "제출 버튼 색을
    # 바꿔줘" carry no other UI noun — so the one measured compound is excluded
    # rather than the term dropped. See ACCEPTED_KOREAN_CONTAINMENT_RISKS below for
    # what remains unguarded and why.
    r"버튼(?!식)",
    r"디자인\s*시스템",
)

# Substring matching on Hangul has no word boundary to lean on, so a noun can match
# inside a longer compound. These are the cases measured and DELIBERATELY ACCEPTED.
# Each is a wider TRUE positive or a harmless one, never a wrong-domain match; the
# one wrong-domain case found (버튼식) is excluded above.
#
# Verb containment is a much smaller risk than noun containment and is not listed:
# a verb match alone never routes, so a verb inside an unrelated word is inert
# unless a UI noun is also present.
ACCEPTED_KOREAN_CONTAINMENT_RISKS = (
    ("페이지 ⊂ 홈페이지", "홈페이지 IS a UI surface — a true positive, not a leak."),
    ("페이지 ⊂ 페이지네이션",
     "'페이지네이션 로직 만들어줘' routes. Pagination is a UI pattern, so design "
     "guidance is not wrong here, only broader than asked."),
    ("컴포넌트 in a test request",
     "'컴포넌트 테스트 만들어줘' routes. English behaves identically for 'build the "
     "component tests', so this is a property of the noun set, not of Korean."),
    ("unmeasured Hangul compounds",
     "The corpus below is finite. A compound nobody thought of can still contain a "
     "noun stem. The conjunction is what bounds the damage: a containment only "
     "matters when a making verb is also present."),
)

# ONE boundary for every term in both languages: "not adjacent to a Latin letter,
# digit, or underscore".
#
# For pure-ASCII text this is IDENTICAL to `\b` — "pages" still fails on `page`,
# "UIKit" still fails on `UI`. It differs only next to a NON-Latin character, and
# that difference is the whole point: `\b` treats Hangul as a word character, so
# `\bdashboard\b` does not match "dashboard를" and `\bUI\b` does not match "UI를".
# A Korean prompt carrying an English noun is the normal case, not an edge case.
_TERM_BOUNDARY = r"(?<![A-Za-z0-9_]){0}(?![A-Za-z0-9_])"


def _term_alternation(terms):
    return "|".join(
        _TERM_BOUNDARY.format(term.replace(" ", r"\s+")) for term in terms
    )


_UI_INTENT_VERB_RE = re.compile(_term_alternation(UI_INTENT_VERBS), re.IGNORECASE)
_UI_INTENT_NOUN_RE = re.compile(_term_alternation(UI_INTENT_NOUNS), re.IGNORECASE)
_UI_INTENT_VERB_KO_RE = re.compile(_term_alternation(UI_INTENT_VERBS_KO))
_UI_INTENT_NOUN_KO_RE = re.compile(_term_alternation(UI_INTENT_NOUNS_KO), re.IGNORECASE)


# ---------------------------------------------------------------------------
# Structural-search intent. Same shape as the UI conjunction above and for the
# same reason: `structural-search` is a name nobody types, so a name-only route
# is a route nobody reaches.
#
# THE DISCRIMINATOR IS THE OBJECT, NOT THE VERB. "find" is ordinary English; what
# separates a structural request from an ordinary one is whether the thing being
# found is a SYNTAX CONSTRUCT or a string. "find every call site" is structural.
# "find the login handler" is not, because a handler is not a syntax shape.
#
# ADAPTATIONS made to the shape list rather than copying it verbatim:
#   - `grep` is deliberately NOT a verb. It names a textual tool, and a request
#     phrased with it is asking for text search on purpose.
#   - `refactor` is deliberately NOT a verb. It is already a bare skill token
#     routing to lithermes:refactor; adding it here would put two routes in
#     contention for the same word.
#   - The nouns that are ordinary English on their own are kept as PHRASES:
#     `usages of`, `references to`. A bare "reference" or "usage" fires on
#     ordinary prose ("find the reference documentation").
#   - `ast` stays a bare term because _TERM_BOUNDARY protects it: "fast", "last"
#     and "past" cannot match.
STRUCTURAL_INTENT_VERBS = (
    "find", "locate", "search", "rewrite", "replace", "migrate", "codemod",
)
STRUCTURAL_INTENT_SHAPES = (
    r"call\s+sites?",
    r"declarations?", r"imports?", r"import\s+statements?",
    r"function\s+signatures?",
    r"syntax\s+tree", r"syntax\s+shape", "ast",
)
# WHO-TERMS DELIBERATELY ABSENT: callers, call graph, invocations, usages of,
# every/all usages, references to.
#
# Ask the language server WHO and WHAT; ask a structural engine WHAT SHAPE. A
# call SITE is a syntax node — it can be matched without knowing what it resolves
# to. A CALLER is the enclosing function, and identifying it requires resolving
# the call target and the scope containing it. Same for "usages of X" and
# "references to X": both need X bound before the question even means anything.
#
# These were briefly present and are REMOVED rather than tuned, because keeping
# them would contradict the boundary this skill's own body now states in five
# places. A router must not outrun its skill's declared scope.
#
# THE HALVES ARE NOT SYMMETRIC. The shape half can be widened fairly freely
# because the verb half does the rejecting. The verb half cannot: adding `check`
# and `update` to the verbs turned 7 of 7 adversarial prompts in this repo's set
# into false positives ("check the imports", "update the function signature
# docs"). Widen shapes when a real miss is reported; leave the verbs alone.
# REMOVED: `references? to`. "find references to this symbol" is a SEMANTIC
# question — it needs a resolver that knows what the symbol binds to, which is
# lithermes:lsp, not a syntax matcher. "search for references to the old API in
# the docs" is worse still: prose, not source. Nothing real is lost, because
# "migrate the call sites to the new signature" still routes through `call
# sites`. The skill body now states this boundary explicitly; a router that
# silently outruns its own skill's declared scope is the defect this closes.

# What a vocabulary conjunction STRUCTURALLY cannot catch. Recorded because the
# fix for any single instance is trivial and the class is not — the next reader
# should extend the list knowing what extending it will never buy.
VOCABULARY_PREDICATE_LIMITS = (
    ("near-synonym split",
     "A finite noun list separates requests by WORD CHOICE, not by intent. "
     "'find all the callers' vs 'find every call site' was one instance, now "
     "closed; 'consumers', 'dependents', 'who calls this' are the same miss "
     "with different words. Every addition closes one instance and none of the "
     "class."),
    ("paraphrase carrying no shape term",
     "'where is this function used from?' is unambiguously structural and names "
     "no term in any list. No vocabulary predicate reaches it, because there is "
     "no noun to match. This is the largest silent gap and it is not fixable by "
     "adding terms."),
    ("domain collision on a shared word",
     "The same token is a syntax shape in one domain and an ordinary noun in "
     "another. `caller` was the English case — 'find the caller\'s phone number' "
     "routed — and it is now moot because who-terms were removed for a stronger "
     "reason. Korean hit this harder and still stands: see "
     "ACCEPTED_KOREAN_STRUCTURAL_RISKS, where 사용처 had to be dropped outright "
     "because it ordinarily means card-merchant locations."),
    ("accepted misses, with the trade named",
     "'show me the call graph' and 'list all callers' stay silent because `show` "
     "and `list` are not search verbs, and because who-terms are out of scope "
     "entirely. Accepted deliberately: A MISSED STRUCTURAL REQUEST COSTS THE USER "
     "ONE REPHRASE; A FALSE POSITIVE INJECTS A SKILL INTO UNRELATED WORK. The "
     "asymmetry of those two costs is why the verb half stays narrow."),
    ("discussing a construct vs wanting to match one",
     "Interface nouns name an ARTIFACT the request is about (page, button, "
     "dashboard). Compiler vocabulary names a CONCEPT the user may merely be "
     "discussing. 'rewrite the declaration in this file' routes although it is a "
     "single-file edit rather than a structural query. The verb half narrows "
     "this but cannot resolve it, because the difference is in intent, not "
     "words."),
)

# Korean. The conjunction survives translation, but the term set had to be
# rebuilt rather than translated — see ACCEPTED_KOREAN_STRUCTURAL_RISKS.
STRUCTURAL_INTENT_VERBS_KO = (
    r"찾",
    r"검색",
    # 바꾸다 contracts to 바꿔 (바꾸 + 어), so the dictionary stem alone never
    # matches the form people actually type. Both are required.
    r"바꾸", r"바꿔",
    r"다시\s*[써쓰]", r"재작성", r"치환", r"마이그레이션",
)
STRUCTURAL_INTENT_SHAPES_KO = (
    r"호출부(?!서)",          # 호출부서 = "calling department" — wrong domain
    r"임포트",
    r"선언부",
    r"함수\s*시그니처",       # bare 시그니처 is common marketing Korean
    r"구문\s*트리",
)

ACCEPTED_KOREAN_STRUCTURAL_RISKS = (
    ("호출부 ⊂ 호출부서", "Excluded with a negative lookahead. 호출부서 is an ordinary "
     "org-chart word ('calling department') and shares no meaning with a call site."),
    ("시그니처 requires the 함수 qualifier", "Bare 시그니처 is common consumer Korean — "
     "시그니처 메뉴 is a restaurant's signature dish. Requiring 함수 loses bare "
     "'시그니처를 찾아줘' in a code context and is the right trade: the false "
     "positive is everyday speech, the loss is a phrasing with an easy alternative."),
    ("사용처 dropped entirely", "It looks like the exact counterpart of 'usages of', but "
     "in ordinary Korean 사용처 means 'place where something is used' — 카드 사용처 is "
     "the list of shops that take your card. No lookahead rescues it, so the term is "
     "absent and Korean coverage relies on 호출부 instead."),
    ("임포트 ⊂ 임포트하기", "Accepted. The containment stays inside the same domain, so "
     "'임포트하기' routing is a true positive rather than a leak."),
)

_STRUCTURAL_VERB_RE = re.compile(_term_alternation(STRUCTURAL_INTENT_VERBS), re.IGNORECASE)
_STRUCTURAL_SHAPE_RE = re.compile(_term_alternation(STRUCTURAL_INTENT_SHAPES), re.IGNORECASE)
_STRUCTURAL_VERB_KO_RE = re.compile("|".join(STRUCTURAL_INTENT_VERBS_KO))
_STRUCTURAL_SHAPE_KO_RE = re.compile("|".join(STRUCTURAL_INTENT_SHAPES_KO))


def detect_structural_intent(text: str) -> bool:
    """True only when a search/rewrite verb AND a syntax-shape noun both appear.

    ONE conjunction, both halves load-bearing, either half satisfiable in either
    language — Korean prompts routinely carry ASCII technical nouns.
    """
    value = str(text or "")
    has_verb = bool(_STRUCTURAL_VERB_RE.search(value)) or bool(_STRUCTURAL_VERB_KO_RE.search(value))
    has_shape = bool(_STRUCTURAL_SHAPE_RE.search(value)) or bool(_STRUCTURAL_SHAPE_KO_RE.search(value))
    return has_verb and has_shape


def detect_ui_intent(text: str) -> bool:
    """True only when a making verb AND a user-interface noun both appear.

    ONE conjunction, not two mechanisms. Either half may be satisfied in either
    language, because Korean prompts routinely mix in ASCII terms — "UI를
    디자인해줘" is an English noun with a Korean verb and must route.
    """
    value = str(text or "")
    has_verb = bool(_UI_INTENT_VERB_RE.search(value)) or bool(_UI_INTENT_VERB_KO_RE.search(value))
    has_noun = bool(_UI_INTENT_NOUN_RE.search(value)) or bool(_UI_INTENT_NOUN_KO_RE.search(value))
    return has_verb and has_noun


def detect_ui_mode(text: str) -> str | None:
    """Classify a UI request by its requested action; None means another domain."""
    value = str(text or "")
    has_ui = bool(_UI_INTENT_NOUN_RE.search(value)) or bool(_UI_INTENT_NOUN_KO_RE.search(value))
    if not has_ui:
        return None
    if re.search(r"(?:^|\W)(?:slides?|deck|pptx?|presentation|video)(?:\W|$)|발표|슬라이드|영상", value, re.IGNORECASE):
        return None
    if re.search(r"\b(?:audit|review(?: this page)? read.only|just check|don't fix)\b|점검|검토만|수정.{0,8}하지", value, re.IGNORECASE):
        if not re.search(r"(?<!don't )\bfix\b|고쳐|수정해", value, re.IGNORECASE):
            return "audit"
    if re.search(r"\b(?:harden|stress.test|hold up under|robust to)\b|튼튼하게|견고하게", value, re.IGNORECASE):
        return "harden"
    if re.search(r"\b(?:polish|clean up the styling|tighten up)\b|다듬", value, re.IGNORECASE):
        if not re.search(r"\b(?:redesign|brand.new|add a|create|build|implement)\b|새로|추가해|다시 짜", value, re.IGNORECASE):
            return "polish"
    return "build" if detect_ui_intent(value) else None


# MO-C-18..20: the motion trigger is a creation verb plus a compound
# motion-video noun, or plus a bare video noun, with none of five exclusions.
# The verb half reuses this product's office/UI creation verbs and adds a small
# motion-specific set they lack (제작, 뽑-, 렌더, render, produce, animate).
# Bare 모션/motion and 인트로/intro are never nouns here; they count only
# inside a compound or next to a video noun. Exclusions route to the skill
# that owns the request instead of silently falling to litwork.
MOTION_MODE = "lit-typographic-motion"
_MOTION_VERB = re.compile(
    r"만들|작성|제작|생성|디자인|뽑|렌더|"
    r"(?<![A-Za-z])(?:make|create|design|build|generate|render|produce|animate)(?![A-Za-z])",
    re.IGNORECASE,
)
_MOTION_COMPOUND = re.compile(
    r"모션\s*그래픽|타이포\s*모션|키네틱\s*타이포(?:그래피)?|타이포그래피\s*영상|가사\s*영상|리릭\s*(?:비디오|영상)|"
    r"뮤직\s*비디오|오프닝\s*타이틀|타이틀\s*시퀀스|"
    r"(?<![A-Za-z])(?:motion\s+graphics?|kinetic\s+type(?:graphy)?|typographic\s+motion|lyric\s+videos?|"
    r"music\s+videos?|title\s+sequences?|opening\s+titles?)(?![A-Za-z])",
    re.IGNORECASE,
)
_MOTION_VIDEO = re.compile(r"영상|비디오|(?<![A-Za-z])(?:videos?|clips?)(?![A-Za-z])", re.IGNORECASE)
_MOTION_BARE = re.compile(r"모션|(?<![A-Za-z])motion(?![A-Za-z])", re.IGNORECASE)
# (i) editing or captioning existing footage
_MOTION_EDIT = re.compile(
    r"편집|자막|색\s*보정|트리밍|잘라|자르|촬영본|기존\s*(?:영상|비디오|클립)|"
    r"(?<![A-Za-z])(?:edit|editing|captions?|subtitles?|trim|crop|colou?r[-\s]?grad(?:e|ing)|footage|existing)(?![A-Za-z])",
    re.IGNORECASE,
)
# (ii) a UI or web container with an embed/insert verb or a background video
_MOTION_UI_CONTAINER = re.compile(
    r"페이지|웹\s*사이트|랜딩|화면|컴포넌트|버튼|"
    r"(?<![A-Za-z])(?:pages?|websites?|landing|screens?|components?|buttons?)(?![A-Za-z])",
    re.IGNORECASE,
)
_MOTION_EMBED = re.compile(r"넣|삽입|(?<![A-Za-z])(?:embed\w*|insert\w*)(?![A-Za-z])", re.IGNORECASE)
_MOTION_BACKGROUND = re.compile(r"배경\s*영상|(?<![A-Za-z])background\s+videos?(?![A-Za-z])", re.IGNORECASE)
# (iii) an office deliverable other than a bare 발표, with an embed/insert verb
_MOTION_SLIDES = re.compile(r"발표\s*자료|슬라이드|피피티|덱|(?<![A-Za-z])(?:pptx?|slides?|decks?)(?![A-Za-z])", re.IGNORECASE)
_MOTION_DOCS = re.compile(r"보고서|문서|(?<![A-Za-z])(?:reports?|documents?)(?![A-Za-z])", re.IGNORECASE)
# (iv) a text or image artifact about a video
_MOTION_ABOUT = re.compile(
    r"스크립트|대본|썸네일|요약|기획안|스토리보드|"
    r"(?<![A-Za-z])(?:scripts?|transcripts?|thumbnails?|summary|summari[sz]e|storyboards?)(?![A-Za-z])",
    re.IGNORECASE,
)


def motion_route(text: str) -> str | None:
    """Return the motion mode, the owner an exclusion names, or None."""
    value = str(text or "")
    videoish = _MOTION_COMPOUND.search(value) or _MOTION_VIDEO.search(value)
    if videoish:
        if _MOTION_EMBED.search(value) and (_MOTION_SLIDES.search(value) or _MOTION_DOCS.search(value)):
            return "lit-pptx" if _MOTION_SLIDES.search(value) else "lit-docx"
        if _MOTION_UI_CONTAINER.search(value) and (_MOTION_EMBED.search(value) or _MOTION_BACKGROUND.search(value)):
            return "frontend-ui-ux"
        if _MOTION_EDIT.search(value) or _MOTION_ABOUT.search(value):
            return None
        return MOTION_MODE if _MOTION_VERB.search(value) else None
    ui_surface = _MOTION_UI_CONTAINER.search(value) or _UI_INTENT_NOUN_RE.search(value) or _UI_INTENT_NOUN_KO_RE.search(value)
    if _MOTION_BARE.search(value) and ui_surface:
        return "frontend-ui-ux"
    return None


def detect_motion_video_intent(text: str) -> bool:
    return motion_route(text) == MOTION_MODE


# The optional type-led hint. It only ever names a cue that points toward the
# type path (a type compound, an explicit kinetic-type or lyric ask, or a quoted
# span of two or more words); it never says the reverse. Finding a quote is cue
# detection: the quoted text is reported as a short label, never followed.
_MOTION_TYPE_CUE = re.compile(
    r"타이포\s*모션|키네틱\s*타이포(?:그래피)?|타이포(?:그래피)?\s*영상|가사\s*영상|리릭\s*(?:비디오|영상)|"
    r"타이틀\s*시퀀스|오프닝\s*타이틀|"
    r"(?<![A-Za-z])(?:kinetic\s+type(?:graphy)?|typographic\s+motion|typography\s+videos?|lyric\s+videos?|"
    r"title\s+sequences?|opening\s+titles?)(?![A-Za-z])",
    re.IGNORECASE,
)
_MOTION_QUOTED = re.compile(
    r'"([^"\n]{2,200})"|“([^”\n]{2,200})”|(?<![A-Za-z])\'([^\'\n]{2,200})\'(?![A-Za-z])|「([^」\n]{2,200})」'
)


def motion_cue(text: str) -> str | None:
    """Return a short label for a type-led cue in the request, or None."""
    value = str(text or "")
    compound = _MOTION_TYPE_CUE.search(value)
    if compound:
        phrase = re.sub(r"\s+", " ", compound.group(0))
        return f"type compound ({phrase})"
    for match in _MOTION_QUOTED.finditer(value):
        span = next(group for group in match.groups() if group is not None).strip()
        if len(span.split()) >= 2:
            label = span if len(span) <= 24 else span[:23] + "…"
            return f"quoted span ({label})"
    return None


_RUN_CONTEXT_TASK_PATTERN = re.compile(r"^task:\s*(?P<task>.+?)\s*$", re.MULTILINE)

_FENCED_CODE_RE = re.compile(r"(^|\n)(`{3,}|~{3,})[^\n]*\n.*?(?:\n\2(?=\n|$)|$)", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`[^`\n]*`")
_INDENTED_CODE_LINE_RE = re.compile(r"(?m)^(?: {4,}|\t).*$")
_MODE_LEAD_RE = re.compile(r"^[\s:;,\-—–]+")


def strip_markdown_code(text: str, *, preserve_offsets: bool = False) -> str:
    """Remove markdown code spans/fences before natural trigger parsing."""
    if preserve_offsets:
        masked = str(text or "")
        for pattern in (_FENCED_CODE_RE, _INDENTED_CODE_LINE_RE, _INLINE_CODE_RE):
            masked = pattern.sub(lambda match: re.sub(r"[^\n]", " ", match.group()), masked)
        return masked
    without_fences = _FENCED_CODE_RE.sub("\n", str(text or ""))
    without_indented = _INDENTED_CODE_LINE_RE.sub("", without_fences)
    return _INLINE_CODE_RE.sub(" ", without_indented)


def _after_mode_word(text: str, word: str) -> str | None:
    m = re.match(rf"^\s*{re.escape(word)}(?![\w-])(?P<rest>.*)$", text, re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    return m.group("rest").strip()


def _after_semantic_family_word(text: str, word: str) -> str | None:
    """Match family ids only at end-of-input or before real whitespace.

    Slash, backslash, dot, colon, and filename-style suffixes are data, not family
    invocations. The stricter rule is scoped to the three imported families so it
    does not change established punctuation handling for other LitHermes modes.
    """
    m = re.match(rf"^\s*{re.escape(word)}(?=$|\s)(?P<rest>.*)$", text, re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    return m.group("rest").strip()


def _after_start_work(text: str) -> str | None:
    m = re.match(r"^\s*start\s+work(?![\w-])(?P<rest>.*)$", text, re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    return m.group("rest").strip()


def _normalized_exact_phrase(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip()).lower()


def _bare_lit_mode(objective: str) -> str:
    prose = re.sub(r"(?m)^\s*#{1,6}\s+.*$", "", objective).strip()
    first = re.split(r"[\n.!?]", prose, maxsplit=1)[0]
    slide = re.search(r"발표자료|발표|슬라이드|피피티|(?:^|[^A-Za-z])(?:slides?|deck|presentation|pptx?)(?![A-Za-z])", first, re.IGNORECASE)
    document = re.search(r"보고서|리포트|기획서|제안서|문서|워드|(?:^|[^A-Za-z])(?:report|docx?|word)(?![A-Za-z])", first, re.IGNORECASE)
    authoring = re.search(r"만들|작성|써\s*줘|써줘|제작|생성|정리|(?:^|[^A-Za-z])(?:make|create|write|draft|prepare|build|produce|generate)(?![A-Za-z])", first, re.IGNORECASE)
    # The motion check runs before the office and UI checks (MO-C-18), so a
    # video noun beside a bare 발표 or 타이포그래피 still reaches motion.
    motion = motion_route(first)
    if motion is not None:
        return motion
    if authoring and slide:
        return "lit-pptx"
    if authoring and document:
        return "lit-docx"
    english = re.match(
        r"^(?:(?:please|can you|could you)\s+)?(?:draw|create|make|design|render|generate)\s+"
        r"(?P<lead>.{0,120}?)\b(?:diagram|flowchart|flow chart)\b(?P<tail>.*)",
        first, re.IGNORECASE,
    )
    if english and not re.search(
        r"\b(?:app|page|dashboard|widget|editor|parser|component|tool|api|test)s?\b",
        english.group("lead") + " " + english.group("tail"), re.IGNORECASE,
    ):
        return "lit-diagram-drawer"
    if re.search(r"(?:다이어그램|흐름도|구성도).{0,60}(?:그려|그리|만들|생성|작성)", first):
        if not re.search(r"편집기|파서|위젯|대시보드|테스트", first):
            return "lit-diagram-drawer"
    if detect_ui_mode(first) is not None:
        return "frontend-ui-ux"
    return "litwork"


def detect_lit_mode(message: str) -> NaturalLitRoute | None:
    """Route a natural-language LitHermes activation to a native mode.

    The parser intentionally ignores code spans/fences and only treats standalone
    `lit`/`litwork` tokens as activations. A token embedded in `/lit`,
    `/tmp/lit.sock`, `split`, `lit-review`, or `lit_loop` is ignored; path-like
    slash tokens elsewhere remain ordinary task text.
    """
    visible = strip_markdown_code(message, preserve_offsets=True)
    renamed = _renamed_skill_route(visible, visible, message)
    if renamed is not None:
        return renamed
    for word, mode in (
        ("lit-plan", "lit-plan"),
        ("review-work", "review-work"),
        ("litgoal", "litgoal"),
        ("lit-loop", "litwork"),
    ):
        rest = _after_mode_word(visible, word)
        if rest is not None:
            return NaturalLitRoute(mode=mode, objective=_clamp_task(rest), visible_message=visible)
    start_rest = _after_mode_word(visible, "start-work")
    if start_rest is not None:
        block = (
            "BLOCKED: bare `start-work` cannot switch Hermes into the native execution "
            "command from the pre-LLM hook. Invoke `/start-work <approved-plan>` explicitly "
            "after `/lit-plan` has produced an approved plan. No run state was created."
        )
        return NaturalLitRoute(
            mode="start-work",
            objective=_clamp_task(start_rest),
            visible_message=visible,
            blocked=True,
            block_message=block,
        )
    trailing_lit = re.fullmatch(
        r"(?s)(?P<objective>.+?)\r?\n[ \t]*\r?\n[ \t]*lit[ \t]*(?:\r?\n)?[ \t]*",
        visible,
        re.IGNORECASE,
    )
    if trailing_lit is not None:
        return NaturalLitRoute(
            mode=_bare_lit_mode(trailing_lit.group("objective")),
            objective=_clamp_task(trailing_lit.group("objective")),
            visible_message=visible,
        )
    for word, mode in _BARE_SKILL_PREFIXES:
        matcher = _after_semantic_family_word if mode in _SEMANTIC_FAMILY_MODES else _after_mode_word
        rest = matcher(visible, word)
        if rest is not None:
            return NaturalLitRoute(mode=mode, objective=_clamp_task(rest), visible_message=visible)

    for match in LIT_PATTERN.finditer(visible):
        token = match.group(0).lower()
        lead = _MODE_LEAD_RE.match(visible[match.end():])
        after_offset = match.end() + (lead.end() if lead else 0)
        after = visible[after_offset:].strip()
        nonleading_family_example = visible[:match.start()].strip() and any(
            re.match(rf"^\s*{re.escape(family)}(?![\w-])", after, re.IGNORECASE)
            for family in _SEMANTIC_FAMILY_MODES
        )
        if nonleading_family_example:
            continue
        if token == "litwork":
            return NaturalLitRoute(mode="litwork", objective=_clamp_task(after), visible_message=visible)

        renamed = _renamed_skill_route(after, visible, message, after_offset)
        if renamed is not None:
            return renamed

        if _normalized_exact_phrase(after) in KOREAN_PROSE_NATURAL_PHRASES:
            return NaturalLitRoute(mode="korean-prose-cleanup", visible_message=visible)

        for word, mode in (
            ("litresearch", "litresearch"),
        ):
            matcher = _after_semantic_family_word if mode in _SEMANTIC_FAMILY_MODES else _after_mode_word
            rest = matcher(after, word)
            if rest is not None:
                return NaturalLitRoute(mode=mode, objective=_clamp_task(rest), visible_message=visible)

        for word in ("workflow", "kanban"):
            rest = _after_mode_word(after, word)
            if rest is not None:
                return NaturalLitRoute(mode="durable-workflow", objective=_clamp_task(rest), visible_message=visible)

        team_rest = _after_mode_word(after, "team")
        if team_rest is not None:
            mode_rest = _after_mode_word(team_rest, "mode")
            objective = mode_rest if mode_rest is not None else team_rest
            return NaturalLitRoute(mode="kanban-team", objective=_clamp_task(objective), visible_message=visible)

        start_rest = _after_start_work(after)
        if start_rest is not None:
            block = (
                "BLOCKED: natural-language `lit start work` cannot switch Hermes into the "
                "native execution command. Invoke `/start-work <approved-plan>` explicitly "
                "after `/lit-plan` has produced an approved plan. No run state was created."
            )
            return NaturalLitRoute(
                mode="start-work",
                objective=_clamp_task(start_rest),
                visible_message=visible,
                blocked=True,
                block_message=block,
            )

        for word, mode in (
            ("plan", "lit-plan"),
            ("review", "review-work"),
            ("research", "litresearch"),
            ("goal", "litgoal"),
            *(item for item in _LIT_SKILL_SUFFIXES if item[0] != "design"),
        ):
            matcher = _after_semantic_family_word if mode in _SEMANTIC_FAMILY_MODES else _after_mode_word
            rest = matcher(after, word)
            if rest is not None:
                return NaturalLitRoute(mode=mode, objective=_clamp_task(rest), visible_message=visible)

        # After the named routes and before `design` (which names the UI skill):
        # "lit design a lyric video" is a film request (MO-C-18).
        if detect_motion_video_intent(re.split(r"[\n.!?]", after, maxsplit=1)[0]):
            return NaturalLitRoute(mode=MOTION_MODE, objective=_clamp_task(after), visible_message=visible)
        rest = _after_mode_word(after, "design")
        if rest is not None:
            return NaturalLitRoute(mode="frontend-ui-ux", objective=_clamp_task(rest), visible_message=visible)
        objective = after or visible[:match.start()].strip()
        return NaturalLitRoute(mode=_bare_lit_mode(objective), objective=_clamp_task(objective), visible_message=visible)

    # Lowest precedence, deliberately: an explicit `lit` token or a named skill
    # always wins. Only when nothing else matched does the UI intent conjunction
    # get a say.
    if detect_ui_mode(visible) is not None:
        return NaturalLitRoute(
            mode="frontend-ui-ux", objective=_clamp_task(visible), visible_message=visible
        )
    # Placed AFTER the UI conjunction deliberately. The two term sets are
    # disjoint in practice, but on a sentence that satisfied both, the shipped
    # and tested UI route should keep precedence rather than change behaviour.
    if detect_structural_intent(visible):
        return NaturalLitRoute(
            mode="structural-search", objective=_clamp_task(visible), visible_message=visible
        )
    return None

def _extract_run_context_task(message: str) -> str:
    m = _RUN_CONTEXT_TASK_PATTERN.search(message)
    return _clamp_task(m.group("task")) if m else ""


# Slash-command handlers embed this legacy marker in their agent message so
# pre_llm_call can recognize the self-contained objective envelope and avoid
# duplicate routing. It is never converted into native /goal mutation: native
# state is user-managed and unobserved, while durable goal_* state is authoritative.
_BIND_GOAL_PATTERN = re.compile(
    r"<lithermes-bind-goal>(?P<obj>.+?)</lithermes-bind-goal>", re.DOTALL
)


def _extract_bind_goal(message: str) -> str:
    m = _BIND_GOAL_PATTERN.search(message)
    return _clamp_task(m.group("obj")) if m else ""


def bind_goal_marker(objective: str) -> str:
    """Render the legacy objective marker recognized without native mutation."""
    objective = _clamp_task(objective)
    return f"<lithermes-bind-goal>{objective}</lithermes-bind-goal>" if objective else ""
