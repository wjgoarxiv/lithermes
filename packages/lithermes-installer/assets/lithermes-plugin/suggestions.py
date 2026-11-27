"""Skill suggestions for prompts without ``lit``, delivered through ``pre_llm_call``.

A plain prompt that fires a gated rule gets a short context note: the fitting
LitHermes skills plus "none", and the model decides yes or no for each. Nothing
loads by itself. A prompt that fires no rule gets nothing per turn when the host
renders the session skill index (Hermes 0.21 system prompt sections); on a host
without that section it gets one compact catalog line instead.

A rule ships only after it reaches recall >= 0.85 and near-miss false positives
<= 0.10 on the sealed held-out half of ``test/fixtures/routing-eval``. Rules that
missed the gate are kept out of ``RULES`` and recorded in ``DROPPED``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

MAX_SUGGESTION_BYTES = 520
MAX_CATALOG_BYTES = 520

_FENCE = re.compile(r"(`{3,}|~{3,})[^\n]*\n.*?\n\1", re.DOTALL)
_INLINE = re.compile(r"`[^`\n]+`")
_TAGGED = re.compile(r"<([a-z][a-z0-9-]*)(?:\s[^>]*)?>.*?</\1>", re.DOTALL | re.IGNORECASE)
_SLASH = re.compile(r"(?:^|[\s\"'>(`])/[a-z][a-z0-9-]+", re.IGNORECASE)
_LIT = re.compile(r"(?:^|\s)lit(?:\s|$|[-:])", re.IGNORECASE)
_KNOWLEDGE = re.compile(
    r"\b(?:what\s+is|what's|what\s+are|explain|difference\s+between|why\s+does|how\s+does)\b|뭐야|무엇인가|설명해|차이가",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Rule:
    skill: str
    gloss: str
    nouns: re.Pattern[str]
    cues: re.Pattern[str]
    exclude: re.Pattern[str] | None = None


_FIGURE_NOUN = re.compile(
    r"\b(?:plot|plots|chart|graph|figure|histogram|scatter\s*plot|heat\s*map|heatmap|box\s*plot|bar\s+chart|line\s+chart|error\s+bars?)\b"
    r"|그래프|플롯|차트|시각화|히스토그램|산점도|그림으로",
    re.IGNORECASE,
)
_FIGURE_CUE = re.compile(
    r"\b(?:data|dataset|csv|tsv|xlsx|results?|measurements?|values|experiment(?:al)?|samples?|columns?|time\s+series|"
    r"plot|visuali[sz]e|publication)\b|\.csv\b|데이터|결과|측정|실험|값|논문",
    re.IGNORECASE,
)
_FIGURE_EXCLUDE = re.compile(
    r"\b(?:dashboard|web\s*page|website|react|html|component|landing|diagram|flow\s*chart|flowchart|architecture|"
    r"org\s*chart|gantt|plot\s+twist|graph\s*ql|knowledge\s+graph|graph\s+database|dependency\s+graph)\b"
    r"|대시보드|웹|다이어그램|도식|순서도|아키텍처",
    re.IGNORECASE,
)
_DIAGRAM_NOUN = re.compile(
    r"\b(?:diagram|flow\s*chart|flowchart|sequence\s+diagram|architecture\s+(?:diagram|drawing|map)|system\s+map|"
    r"mind\s*map|state\s+machine\s+diagram|er\s+diagram|block\s+diagram)\b"
    r"|다이어그램|도식|개념도|개요도|순서도|흐름도|구성도|구조도",
    re.IGNORECASE,
)
_DIAGRAM_CUE = re.compile(
    r"\b(?:draw|make|create|sketch|design|generate|build|render|need|want|produce|illustrate)\b"
    r"|그려|그리|만들어|만들|작성|필요|그림",
    re.IGNORECASE,
)
_DIAGRAM_EXCLUDE = re.compile(
    r"\bP&ID\b|\bPFD\b|\b(?:piping|instrumentation|apparatus|equipment\s+layout|cutaway|isometric)\b"
    r"|계장도|공정도|장치도|모식도",
    re.IGNORECASE,
)

RULES: tuple[Rule, ...] = (
    Rule("lit-scientific-visualization", "figures from data", _FIGURE_NOUN, _FIGURE_CUE, _FIGURE_EXCLUDE),
    Rule("lit-diagram-drawer", "diagrams of systems and flows", _DIAGRAM_NOUN, _DIAGRAM_CUE, _DIAGRAM_EXCLUDE),
)

# Candidates are scored by the same eval as RULES. One that misses the gate stays
# out of RULES and is named in DROPPED; its skill still appears in the catalog line.
CANDIDATES: tuple[Rule, ...] = (
    Rule(
        "lit-brainstorm",
        "options for an open question",
        re.compile(r"\b(?:options|ideas|alternatives|approaches|directions)\b|아이디어|대안|방안|선택지", re.IGNORECASE),
        re.compile(
            r"\b(?:what\s+are\s+my|give\s+me|brainstorm|come\s+up\s+with|list\s+(?:some|a\s+few)|could\s+i|ways?\s+to)\b"
            r"|브레인스토밍|떠올려|뭐가\s*있|알려줘|내줘",
            re.IGNORECASE,
        ),
    ),
    Rule(
        "deep-interview",
        "pin down a vague request first",
        re.compile(r"\b(?:something|an?\s+app|a\s+tool|my\s+project|a\s+system|a\s+platform)\b|뭔가|앱|서비스|프로젝트", re.IGNORECASE),
        re.compile(r"\b(?:help\s+me|not\s+sure|i\s+want|i'd\s+like)\b|도와줘|만들고\s*싶|하고\s*싶", re.IGNORECASE),
    ),
)
DROPPED: dict[str, str] = {
    "lit-brainstorm": "dev recall 0.75, near-miss 0.50; held-out recall 0.75, near-miss 0.50",
    "deep-interview": "dev recall 1.00, near-miss 0.00; held-out recall 0.67, near-miss 0.00",
}

CATALOG_SKILLS = (
    "lit-plan", "start-work", "litwork", "review-work", "debugging", "deep-interview", "lit-brainstorm",
    "litresearch", "lit-humanizer", "lit-commit", "refactor", "lit-diagram-drawer",
    "lit-scientific-visualization", "lit-handoff", "lit-adhd",
)


def visible_text(prompt: str) -> str:
    """The prompt with closed fences, inline code and tagged host blocks removed."""
    text = _FENCE.sub(" ", prompt)
    text = _TAGGED.sub(" ", text)
    return _INLINE.sub(" ", text)


def fired(prompt: str, rules: tuple[Rule, ...] = RULES) -> list[str]:
    text = visible_text(str(prompt or ""))
    if _KNOWLEDGE.search(text):
        return []
    hits = []
    for rule in rules:
        if rule.exclude is not None and rule.exclude.search(text):
            continue
        if rule.nouns.search(text) and rule.cues.search(text):
            hits.append(rule.skill)
    return hits


def eligible(prompt: str) -> bool:
    """A suggestion never rides on a ``lit`` prompt, a slash command or LitHermes envelope text.

    Command and activation text, even copied or quoted, stays inert: it gets no
    extra context at all.
    """
    text = str(prompt or "")
    if not text.strip() or "<lithermes-" in text:
        return False
    stripped = text.lstrip()
    if stripped.lower().startswith("lit") and (len(stripped) == 3 or not stripped[3].isalnum()):
        return False
    return not (_LIT.search(visible_text(text)) or _SLASH.search(text))


def suggestion(prompt: str) -> str:
    if not eligible(prompt):
        return ""
    hits = fired(prompt)
    if not hits:
        return ""
    glosses = {rule.skill: rule.gloss for rule in RULES}
    offered = "; ".join(f"{skill} ({glosses[skill]})" for skill in hits)
    return (
        "<lithermes-skill-suggestion>"
        f"These LitHermes skills may fit this request: {offered}; or none. "
        'Decide yes or no for each. Load only the ones that fit with skill_view("lithermes:<name>"); '
        "if none fits, carry on without one. Nothing has loaded by itself."
        "</lithermes-skill-suggestion>"
    )


def catalog_line() -> str:
    return (
        "<lithermes-skill-catalog>LitHermes skills you can load with "
        'skill_view("lithermes:<name>") when one fits: ' + ", ".join(CATALOG_SKILLS) + ".</lithermes-skill-catalog>"
    )
