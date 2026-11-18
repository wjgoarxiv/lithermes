"""The skill plan of a `lit <prompt>` turn.

The routing cascade in core_routing still picks ONE primary mode, first match wins. This module
adds the companions: the other content routes the same prompt matched, in the cascade's order,
without duplicates and capped at three skills in all, plus lit-crucible when the ask is a large or
risky design. The model confirms or drops each companion against a short catalog of the skills
this profile really has, says the final plan once, and loads each skill with skill_view when its
part starts. `lit +viz +ui <task>` names the plan outright and nothing is added or dropped.

A moved extension skill (MOVED_SKILL_FAMILIES) is offered only when the Hermes profile holds it
under skills/<id>/SKILL.md; otherwise the plan names it once with its install command. Read-only
primaries (lit-adhd, review-work, litresearch, the brainstorms) never gain a companion that can
write. Pure apart from `installed_extensions`, which looks at the profile's skills folder.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

try:
    from .core_contract import MOVED_SKILL_FAMILIES, extension_command_line
except (ImportError, ModuleNotFoundError):
    from core_contract import MOVED_SKILL_FAMILIES, extension_command_line

PLAN_CAP = 3

# `lit +<alias>`: short words a user can type without looking anything up.
SKILL_ALIASES = {
    "viz": "lit-scientific-visualization",
    "plot": "lit-scientific-visualization",
    "ui": "frontend-ui-ux",
    "design": "frontend-ui-ux",
    "qa": "visual-qa",
    "crucible": "lit-crucible",
    "plan": "lit-plan",
    "research": "litresearch",
    "review": "review-work",
    "debug": "debugging",
    "deck": "lit-pptx",
    "slides": "lit-pptx",
    "pptx": "lit-pptx",
    "doc": "lit-docx",
    "docx": "lit-docx",
    "diagram": "lit-diagram-drawer",
    "schematic": "lit-schematic",
    "motion": "lit-typographic-motion",
    "video": "lit-typographic-motion",
    "readme": "readme-studio",
    "ast": "structural-search",
    "refactor": "refactor",
    "brainstorm": "lit-brainstorm",
    "ultra": "ultra-brainstorm",
    "humanize": "lit-humanizer",
    "commit": "lit-commit",
    "browser": "browser-drive",
}

# One short "use when" phrase per skill the catalog may offer; a moved skill appears only when installed.
CATALOG = {
    "lit-plan": "plan before code",
    "lit-crucible": "attack a risky design",
    "lit-brainstorm": "scored options",
    "ultra-brainstorm": "hundreds of idea children, judged",
    "litresearch": "sourced research",
    "review-work": "review a diff",
    "debugging": "fix a failure",
    "refactor": "restructure safely",
    "structural-search": "AST search or codemod",
    "lit-humanizer": "de-template prose",
    "lit-commit": "git history",
    "browser-drive": "drive a browser",
    "lit-pptx": ".pptx deck",
    "lit-docx": ".docx document",
    "lit-diagram-drawer": "concept diagram",
    "lit-schematic": "P&ID or apparatus drawing",
    "lit-scientific-visualization": "data figure",
    "frontend-ui-ux": "build an interface",
    "visual-qa": "check a built interface",
    "lit-typographic-motion": "kinetic-type film",
    "readme-studio": "README with cover",
}

# Skills that only read. A plan led by one of these keeps only companions from this set.
READ_ONLY_SKILLS = frozenset({"lit-adhd", "review-work", "litresearch", "lit-brainstorm", "ultra-brainstorm", "lit-crucible"})
_READ_ONLY_PRIMARIES = frozenset({"lit-adhd", "review-work", "litresearch", "lit-brainstorm", "ultra-brainstorm"})

# Route modes whose skill id differs from the mode name.
_MODE_SKILL = {"korean-prose-cleanup": "lit-humanizer", "kanban-team": "lit-team", "durable-workflow": "litwork"}

_HATCH = re.compile(r"(?:^|\s)lit(?:work)?((?:\s+\+[a-z][a-z-]{0,30})+)(?=\s|$)", re.IGNORECASE)
_HATCH_STRIP = re.compile(r"((?:^|\s)lit(?:work)?)(?:\s+\+[A-Za-z][A-Za-z-]{0,30})+(?=\s|$)", re.IGNORECASE)

_RISKY_DESIGN = re.compile(
    r"\b(?:redesign(?:ing)?|re-?architect(?:ure|ing)?|architecture(?!\s+diagram)|migrat(?:e|ion|ing)|overhaul(?:ing)?)\b"
    r"|설계|아키텍처|마이그레이션|전면\s?개편",
    re.IGNORECASE,
)
_EXPLAIN = re.compile(r"\b(?:explain|describe|summari[sz]e|what\s+is)\b|설명|요약", re.IGNORECASE)
# Drawing a design is not changing one: an architecture diagram asks for no crucible.
_DRAWING = re.compile(r"\b(?:diagram|flowchart|schematic|chart|figure)s?\b|다이어그램|도식|흐름도|그림", re.IGNORECASE)
_DELIVERABLES = frozenset({
    "lit-pptx", "lit-docx", "frontend-ui-ux", "lit-scientific-visualization", "lit-diagram-drawer",
    "lit-schematic", "lit-typographic-motion", "readme-studio",
})


@dataclass(frozen=True)
class SkillHatch:
    skills: tuple[str, ...]
    unknown: tuple[str, ...]
    rest: str


@dataclass(frozen=True)
class PlanEntry:
    id: str
    installed: bool = True

    @property
    def moved(self) -> bool:
        return self.id in MOVED_SKILL_FAMILIES


@dataclass(frozen=True)
class SkillPlan:
    entries: tuple[PlanEntry, ...]
    dropped: tuple[tuple[str, str], ...] = ()
    forced: bool = False
    unknown: tuple[str, ...] = ()
    read_only: bool = False
    installed: frozenset[str] = field(default_factory=frozenset)


def skill_for_mode(mode: str) -> str:
    return _MODE_SKILL.get(mode, mode)


def parse_skill_hatch(visible: str, message: str | None = None) -> SkillHatch | None:
    """`lit +viz +ui <task>`: the forced skills in the user's order, unknown names, and the prompt without them.

    ``visible`` is the prompt with code spans and fences blanked (so a hatch inside code is inert);
    ``message`` is the original text the stripped prompt is cut from, offsets unchanged.
    """
    match = _HATCH.search(visible or "")
    if match is None:
        return None
    skills: list[str] = []
    unknown: list[str] = []
    for token in match.group(1).split():
        name = token[1:].lower()
        skill = SKILL_ALIASES.get(name) or (name if name in CATALOG else None)
        if skill is None:
            unknown.append(name)
        elif skill not in skills:
            skills.append(skill)
    source = message if message is not None else visible
    rest = source[: match.start(1)] + source[match.end(1):]
    return SkillHatch(tuple(skills[:PLAN_CAP]), tuple(unknown), rest)


def wants_crucible(text: str, ids: list[str]) -> bool:
    if _EXPLAIN.search(text or "") or _DRAWING.search(text or ""):
        return False
    return bool(_RISKY_DESIGN.search(text or "")) or sum(1 for skill in ids if skill in _DELIVERABLES) >= 3


def hermes_home(env: dict[str, str] | None = None) -> Path:
    env = os.environ if env is None else env
    return Path(env.get("HERMES_HOME") or Path(env.get("HOME") or Path.home()) / ".hermes")


def installed_extensions(home: Path | None = None) -> frozenset[str]:
    """The moved skills this Hermes profile holds (skills/<id>/SKILL.md). An unreadable folder reads as none."""
    root = (home or hermes_home()) / "skills"
    found = set()
    for skill in MOVED_SKILL_FAMILIES:
        try:
            if (root / skill / "SKILL.md").is_file():
                found.add(skill)
        except OSError:
            continue
    return frozenset(found)


def build_skill_plan(
    primary_mode: str,
    companions: list[str] | tuple[str, ...] = (),
    *,
    text: str = "",
    forced: SkillHatch | None = None,
    installed: frozenset[str] = frozenset(),
) -> SkillPlan | None:
    """The ordered plan, or None when it is the primary alone (an ordinary prompt's context stays as it was)."""
    primary = skill_for_mode(primary_mode or "")
    if not primary:
        return None
    read_only = primary in _READ_ONLY_PRIMARIES
    dropped: list[tuple[str, str]] = []
    if forced is not None:
        picked = [skill for skill in forced.skills if skill != primary]
    else:
        picked = [skill_for_mode(mode) for mode in companions if skill_for_mode(mode) != primary]
        if (
            not read_only
            and primary != "lit-crucible"
            and "lit-crucible" not in picked
            and wants_crucible(text, [primary, *picked])
        ):
            picked.insert(0, "lit-crucible")
    kept: list[str] = []
    for skill in dict.fromkeys(picked):
        if read_only and skill not in READ_ONLY_SKILLS:
            dropped.append((skill, f"{primary} is read-only"))
        else:
            kept.append(skill)
    cap = PLAN_CAP if forced is not None else PLAN_CAP - 1
    dropped.extend((skill, "over the cap") for skill in kept[cap:])
    kept = kept[:cap]
    if not kept and forced is None:
        return None
    entries = tuple(
        PlanEntry(skill, installed=(skill not in MOVED_SKILL_FAMILIES or skill in installed))
        for skill in (primary, *kept)
    )
    return SkillPlan(
        entries=entries,
        dropped=tuple(dropped),
        forced=forced is not None,
        unknown=forced.unknown if forced is not None else (),
        read_only=read_only,
        installed=installed,
    )


def plan_line(plan: SkillPlan, *, marks: bool = True) -> str:
    """`Skill plan: 1 litwork (primary) → 2 lit-pptx (not installed)`; ``marks=False`` drops the install marks."""
    labels = []
    for index, entry in enumerate(plan.entries):
        label = f"{index + 1} {entry.id}{' (primary)' if index == 0 else ''}"
        if marks and entry.moved and not entry.installed:
            label += " (not installed)"
        labels.append(label)
    return "Skill plan: " + " → ".join(labels)


def install_line(plan: SkillPlan, *, short: bool = False) -> str:
    """One line naming every missing extension once, with the command pattern that installs each."""
    missing = [entry.id for entry in plan.entries if entry.moved and not entry.installed]
    if not missing:
        return ""
    if short:
        return f"Not installed on this profile: {', '.join(missing)} (`extensions install <id> --yes`)."
    command = extension_command_line(missing[0]).replace(missing[0], "<id>")
    return f"Not installed on this profile: {', '.join(missing)}. Install one with `{command}`, then open a new session."


def plan_ids(plan: SkillPlan | None) -> list[str]:
    return [entry.id for entry in plan.entries] if plan else []


def _catalog(plan: SkillPlan) -> list[str]:
    in_plan = {entry.id for entry in plan.entries}
    lines = []
    for skill, use in CATALOG.items():
        if skill in in_plan or (plan.read_only and skill not in READ_ONLY_SKILLS):
            continue
        if skill in MOVED_SKILL_FAMILIES and skill not in plan.installed:
            continue
        lines.append(f"{skill} ({use})")
    return lines


def skill_plan_context(plan: SkillPlan, *, compact: int = 0) -> str:
    """The model-facing block: fixed text around the plan; nothing from the prompt is echoed.

    ``compact`` (0-5) sheds parts, least important first, for a turn whose route already fills
    most of the host's context budget: 1 drops the catalog, 2 the confirm and load guidance,
    3 shortens the install and `lit +…` lines, 4 drops the left-out notes, 5 keeps the plan alone.
    """
    if compact >= 5:
        return "<lithermes-skill-plan>\n" + plan_line(plan) + "\n</lithermes-skill-plan>"
    short = compact >= 3
    lines = [plan_line(plan, marks=not short)]
    if plan.forced:
        lines.append(
            "Named with `lit +…`: keep it exactly."
            if short
            else "The user named this plan with `lit +…`: keep it exactly, add nothing and drop nothing."
        )
        if plan.unknown:
            lines.append("Ignored unknown plan names: " + " ".join(f"+{name}" for name in plan.unknown) + ".")
    elif compact < 2:
        lines.append(
            "The companions after the primary are candidates the hook matched, not orders: confirm or drop each "
            "one for this request, and add at most one skill from the catalog below when the work clearly needs it."
        )
    if compact < 4:
        lines.extend(f"Left out: {skill} ({why})." for skill, why in plan.dropped)
    if compact < 2:
        lines.append(
            "Say the final plan right after the probe line in the same `Skill plan:` form. Load each companion when its "
            'part starts, never all up front: skill_view("lithermes:<id>"), or skill_view("<id>") for an extension. '
            "A skill not installed is not loaded: give its install line once and go on without it."
        )
    missing = install_line(plan, short=short)
    if missing:
        lines.append(missing)
    catalog = [] if plan.forced or compact >= 1 else _catalog(plan)
    if catalog:
        lines.append("Catalog: " + "; ".join(catalog) + ".")
    return "<lithermes-skill-plan>\n" + "\n".join(lines) + "\n</lithermes-skill-plan>"
