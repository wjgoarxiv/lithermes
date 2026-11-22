"""One checkable goal condition per approved plan, proposed once at plan approval.

A lit-plan plan carries a `## Done when` block with one `check: \\`<command>\\`` line. This module
turns it into one condition of at most 500 characters,

    Every row in plans/<f>.md is ticked and `<command>` exits 0 [lit:<id>]

lints it (no judgment words, no push/publish-only success, an allowlisted test command), and runs
the command once, read-only and time-boxed, to prove the condition is false now. The consent line
goes into the plan approval question; only a whole-prompt `yes`, typed in the session that was
asked, counts.

Hermes has a native `/goal` (with deterministic `/goal gate add <cmd>` gates), but LitHermes keeps
it user-managed: the plugin never calls GoalManager. So an exact `yes` records the intent and hands
the user the two lines to paste, and the same check runs at turn end as an advisory once every row
is ticked. The records live in the plugin's own state, outside the project, so the model never
finds them while it works in the workspace: `$HERMES_HOME/lithermes/goal/<workspace key>/`.

    consent.json  the question asked: condition, its hash, plan, check, time, and
                  the asking session once its turn ended                        (asked)
    intent.json   the user's exact `yes` to that question                           (accepted)
    result.json   the turn-end advisory run of the check, read on the next turn      (checked)

A `lit` / `lit-loop` run with no plan gets one question of its own, `kind: "loop"`: the condition is
the project's test command exiting 0 with the objective done, there are no plan rows, and the
question carries its asking session from the start. Only the exact `yes` records the intent; it
starts nothing. `no` or any other reply from the asking session drops the question.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import subprocess
import time
from pathlib import Path
from typing import Any

try:
    from .redaction import redact_text
except (ImportError, ModuleNotFoundError):
    from redaction import redact_text  # type: ignore

GOAL_MAX_CHARS = 500
FALSIFY_TIMEOUT_SECONDS = 120
LOOP_OBJECTIVE_CHARS = 180
LOOP_CONSENT_TTL_SECONDS = 30 * 60
LOOP_INTENT_TTL_SECONDS = 24 * 60 * 60

_JUDGMENT_WORDS = (
    r"\bworks?\b", r"\bworking\b", r"\blooks? (?:good|fine|right|nice|great)\b", r"\bseems?\b",
    r"\bproperly\b", r"\bcorrectly\b", r"\bclean(?:ly)?\b", r"\bnicely\b", r"\bshould (?:work|pass)\b",
    r"\bas expected\b", r"\bgood enough\b",
    r"잘\s*(?:동작|작동|돌아|돼|된다|되면)", r"괜찮", r"깔끔", r"제대로", r"문제\s*없", r"완벽",
)
_OUTWARD_ONLY = re.compile(
    r"^\s*(?:git\s+push|npm\s+publish|pnpm\s+publish|yarn\s+publish|gh\s+(?:release|pr\s+merge)|git\s+tag)\b",
    re.IGNORECASE,
)
# Test runners the dry run may start. Anything else is refused before it runs.
_CHECK_ALLOWLIST = (
    r"npm (?:test|run [\w:.-]+)(?: --[\w-]+)*",
    r"npm --prefix [\w./-]+ (?:test|run [\w:.-]+)",
    r"node --test(?: [\w./*-]+)*",
    r"node [\w./-]+\.m?js(?: [\w./=-]+)*",
    r"(?:pnpm|yarn) (?:test|run [\w:.-]+)",
    r"(?:pytest|python3? -m (?:pytest|unittest))(?: [\w./:-]+)*",
    r"cargo test(?: [\w-]+)*",
    r"go test(?: [\w./-]+)*",
    r"make (?:test|check|verify)",
    r"(?:bash|sh) scripts/[\w./-]+\.sh",
)
_ROW = re.compile(r"^- \[([ xX])\] ")
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_DONE_WHEN = re.compile(r"^##\s+Done when\s*$", re.IGNORECASE)
_CHECK_LINE = re.compile(r"^\s*(?:[-*]\s+)?check:\s*`([^`\n]+)`\s*$")
_PLAN_PATH = re.compile(r"^plans/[\w.-]+\.md$")
_LOOP_LEAD = re.compile(r"^\s*(?:-?loop|work)\b\s*", re.IGNORECASE)
_UNSAFE_COMMANDS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\b(?:rm|rmdir)\s+-r(?:f)?\b[^;&|\n]*",
        r"\b(?:sudo|eval|exec)\b[^;&|\n]*",
        r"\b(?:npm|pnpm|yarn)\s+(?:publish|unpublish)\b[^;&|\n]*",
        r"\bgit\s+(?:push|reset|clean)\b[^;&|\n]*",
    )
)

STATUS = {
    "asked": "Approve plan, start work and set goal: /goal {condition}? (yes / edit / no)",
    "asked_start": "Approve plan and start work? (yes / no)",
    "loop_asked": "Set goal for this lit-loop: /goal {condition}? (yes / no)",
    "loop_accepted": (
        "Goal accepted for this lit-loop, not set by LitHermes: Hermes /goal stays yours. "
        "Paste these two lines to arm it: /goal {condition}  then  /goal gate add {check}"
    ),
    "loop_declined": "No goal set: you said no.",
    "skipped": "No goal set: {reason}.",
    "not_started": "Plan not started: {reason}.",
    "accepted": (
        "Work started from {plan}. Goal accepted, not set by LitHermes: Hermes /goal stays yours. "
        "Paste these two lines to arm it: /goal {condition}  then  /goal gate add {check}"
    ),
    "started": "Work started from {plan}. No goal set.",
    "start_failed": "Plan not started and no goal set: {reason}.",
    "edit": "Not started and no goal set: edit the plan or its `## Done when` check, then I ask again.",
    "declined": "Not started and no goal set: you said no.",
    "other_session": "Approval not recorded for this session. Run: /start-work {plan}",
    "met": "Goal condition met: {condition}. If you set it with /goal, Hermes closes it at its next check.",
    "not_met": "Goal condition not met yet: `{check}` exited {exit}.",
}

# What each question offers and what each answer does: the one list the answer guide is built from.
ANSWERS = {
    "asked": (
        ("yes", "Starts the work now and accepts this goal; you get its /goal lines to paste"),
        ("edit", "Change the plan or its check first, then I ask again"),
        ("no", "Nothing starts"),
    ),
    "asked_start": (("yes", "Starts the work now, with no goal"), ("no", "Nothing starts")),
    "loop_asked": (
        ("yes", "accept this goal; you get its /goal lines to paste"),
        ("no", "keep working without a goal"),
    ),
}
_GUIDE_TITLE = {
    "asked": "approve plan · start work · set goal",
    "asked_start": "approve plan · start work",
    "loop_asked": "set goal for this lit-loop",
}


def answer_guide(kind: str, condition: str = "", *, plain: bool = False) -> str:
    """The guide shown right under a goal question: each answer word and what it does.

    Markdown (a blockquote with a table) for a reply the model writes; plain aligned rows for text
    the hook draws, each ending in a Markdown hard break so a rendered reply keeps the rows apart.
    """
    answers = ANSWERS[kind]
    if plain:
        width = max(len(word) for word, _ in answers)
        rows = [f"  {word.ljust(width)}  → {what}" for word, what in answers]
        return "  \n".join([*rows, "  Type the word alone."])
    lines = [f"> **▶ Answer: {_GUIDE_TITLE[kind]}**", ">"]
    if condition:
        lines += [f"> Goal: `` /goal {condition} ``", ">"]
    lines += ["> | Type | What happens |", "> |---|---|"]
    lines += [f"> | **`{word}`** | {what} |" for word, what in answers]
    return "\n".join([*lines, ">", "> Type the word alone."])


def condition_hash(condition: str) -> str:
    return hashlib.sha256(str(condition).encode("utf-8")).hexdigest()[:16]


def goal_id(plan: str, check: str) -> str:
    return hashlib.sha256(f"{plan}\0{check}".encode("utf-8")).hexdigest()[:8]


def _hermes_home() -> Path:
    value = (os.environ.get("HERMES_HOME") or "").strip()
    return Path(value).expanduser() if value else Path.home() / ".hermes"


def goal_dir(workspace: Path) -> Path:
    """Goal records for one workspace, kept under the Hermes home and keyed by the workspace path."""
    key = hashlib.sha256(str(Path(workspace).resolve()).encode("utf-8")).hexdigest()[:16]
    return _hermes_home() / "lithermes" / "goal" / key


def plan_rows(text: str) -> tuple[int, int]:
    """(ticked, total) column-zero checkbox rows outside fenced code."""
    ticked = total = 0
    fence = ""
    for line in str(text or "").splitlines():
        opened = _FENCE.match(line)
        if opened:
            marker = opened.group(1)
            if not fence:
                fence = marker[0] * len(marker)
            elif marker.startswith(fence):
                fence = ""
            continue
        if fence:
            continue
        row = _ROW.match(line)
        if row:
            total += 1
            ticked += row.group(1) in "xX"
    return ticked, total


def parse_done_when(plan_text: str) -> dict[str, Any]:
    lines = str(plan_text or "").splitlines()
    start = next((index for index, line in enumerate(lines) if _DONE_WHEN.match(line)), None)
    if start is None:
        return {"ok": False, "reason": "the plan has no `## Done when` block"}
    for line in lines[start + 1:]:
        if line.startswith("## "):
            break
        match = _CHECK_LINE.match(line)
        if match:
            return {"ok": True, "check": match.group(1).strip()}
    return {"ok": False, "reason": "the `## Done when` block names no `check:` command"}


def compile_condition(plan: str, check: str) -> dict[str, Any]:
    ident = goal_id(plan, check)
    condition = f"Every row in {plan} is ticked and `{check}` exits 0 [lit:{ident}]"
    if len(condition) > GOAL_MAX_CHARS:
        return {"ok": False, "reason": f"the condition is over {GOAL_MAX_CHARS} characters; point the check at one script"}
    return {"ok": True, "condition": condition, "id": ident}


def lint_condition(condition: str, check: str) -> dict[str, Any]:
    reasons = []
    if len(str(condition)) > GOAL_MAX_CHARS:
        reasons.append(f"over {GOAL_MAX_CHARS} characters")
    words = [m.group(0) for pattern in _JUDGMENT_WORDS if (m := re.search(pattern, str(check), re.IGNORECASE))]
    if words:
        reasons.append(f"judgment words cannot be checked ({', '.join(words)})")
    if _OUTWARD_ONLY.search(str(check)):
        reasons.append("a push, publish or release is not a check of the work")
    if not any(re.fullmatch(pattern, str(check)) for pattern in _CHECK_ALLOWLIST):
        reasons.append(f"`{check}` is not an allowlisted test command")
    return {"ok": not reasons, "reasons": reasons}


def falsify(workspace: Path, plan_text: str, check: str, *, timeout: int = FALSIFY_TIMEOUT_SECONDS, run=subprocess.run) -> dict[str, Any]:
    """The dry run: the condition must be false right now, or the goal would be met at once.

    Runs the allowlisted check once, no shell, stdin closed, output discarded, time-boxed. Unticked
    rows already make it false, but the check still runs so an unrunnable or hanging command is
    caught before it becomes a goal.
    """
    ticked, total = plan_rows(plan_text)
    argv = shlex.split(check)
    planned_script = argv[:1] in (["bash"], ["sh"]) and len(argv) == 2 and argv[1] in str(plan_text)
    try:
        result = run(
            argv, cwd=str(workspace), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, timeout=timeout, check=False, shell=False,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "reason": f"`{check}` did not finish within {timeout} s"}
    except (OSError, ValueError):
        return {"ok": False, "reason": f"`{check}` cannot run here"}
    code = result.returncode
    if code == 127 and not planned_script:
        return {"ok": False, "reason": f"`{check}` cannot run here"}
    if code == 0 and total and ticked == total:
        return {"ok": False, "reason": "the goal is already true (every row is ticked and the check exits 0)"}
    return {"ok": True, "open": total - ticked, "exit": code}


def loop_objective(text: str) -> str:
    """The objective a lit-loop goal names: one redacted line, slash lines and risky commands gone.

    User text is inert data here: it is never run, only quoted into the condition after this pass.
    """
    lines = [line for line in str(text or "").splitlines() if not line.lstrip().startswith("/")]
    cleaned = redact_text(" ".join(lines))
    for pattern in _UNSAFE_COMMANDS:
        cleaned = pattern.sub("[UNSAFE_COMMAND_REDACTED]", cleaned)
    cleaned = " ".join(cleaned.split())
    cleaned = _LOOP_LEAD.sub("", cleaned, count=1)
    return cleaned[:LOOP_OBJECTIVE_CHARS].strip()


def compile_loop_condition(objective: str, check: str) -> dict[str, Any]:
    """A lit-loop's condition: its check exits 0 and its objective is done. No plan, so no rows."""
    ident = goal_id(f"loop\0{objective}", check)
    condition = f"`{check}` exits 0 and this is done: {objective} [lit:{ident}]"
    if len(condition) > GOAL_MAX_CHARS:
        return {"ok": False, "reason": f"the condition is over {GOAL_MAX_CHARS} characters; shorten the objective"}
    return {"ok": True, "condition": condition, "id": ident}


def detect_check(workspace: Path) -> str | None:
    """The project's own test command for the question the prompt hook asks; None when it has none."""
    root = Path(workspace)
    try:
        scripts = json.loads((root / "package.json").read_text(encoding="utf-8")).get("scripts")
        if isinstance(scripts, dict) and isinstance(scripts.get("test"), str):
            return "npm test"
    except (OSError, ValueError, AttributeError):
        pass
    for name, check in (("pytest.ini", "pytest"), ("pyproject.toml", "pytest"), ("Cargo.toml", "cargo test"), ("go.mod", "go test ./...")):
        if (root / name).is_file():
            return check
    return None


def falsify_loop(workspace: Path, check: str, *, timeout: int = FALSIFY_TIMEOUT_SECONDS, run=subprocess.run) -> dict[str, Any]:
    """A lit-loop has no unticked rows to keep its goal false, so its check must fail right now."""
    try:
        result = run(
            shlex.split(check), cwd=str(workspace), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, timeout=timeout, check=False, shell=False,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "reason": f"`{check}` did not finish within {timeout} s"}
    except (OSError, ValueError):
        return {"ok": False, "reason": f"`{check}` cannot run here"}
    if result.returncode == 127:
        return {"ok": False, "reason": f"`{check}` cannot run here"}
    if result.returncode == 0:
        return {"ok": False, "reason": f"`{check}` already passes, so the goal would be met at once; write the failing test first"}
    return {"ok": True, "exit": result.returncode}


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    staging = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    staging.write_text(json.dumps(data, ensure_ascii=False) + "\n", encoding="utf-8")
    staging.replace(path)


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def propose(workspace: Path, plan_arg: str, *, now: float | None = None, timeout: int = FALSIFY_TIMEOUT_SECONDS, run=subprocess.run) -> dict[str, Any]:
    """Build, lint and dry-run the condition for one plan; record the question. Returns {line, consent?}.

    The question asks to start the work and, when the condition passed every check, to set the goal.
    When the goal was refused, the question asks to start the work alone and a second line names why.
    """
    workspace = Path(workspace).resolve()
    plan_path = (workspace / str(plan_arg or "")).resolve()
    try:
        plan = plan_path.relative_to(workspace).as_posix()
    except ValueError:
        plan = ""
    if not plan_arg or not _PLAN_PATH.match(plan):
        return {"line": STATUS["not_started"].format(reason="give the plan as plans/<slug>.md inside this project")}
    try:
        plan_text = plan_path.read_text(encoding="utf-8")
    except OSError:
        return {"line": STATUS["not_started"].format(reason=f"{plan} cannot be read")}
    refused = _goal_refusal(workspace, plan, plan_text, timeout=timeout, run=run)
    asked = time.time() if now is None else now
    if isinstance(refused, str):
        consent = {"version": 2, "condition": "", "check": "", "id": "", "plan": plan, "askedAt": asked}
        consent["hash"] = consent_hash(consent)
        _write_json(goal_dir(workspace) / "consent.json", consent)
        line = STATUS["asked_start"] + "\n" + STATUS["skipped"].format(reason=refused)
        return {"line": line, "consent": consent, "guide": answer_guide("asked_start")}
    consent = {"version": 2, **refused, "plan": plan, "askedAt": asked}
    consent["hash"] = consent_hash(consent)
    _write_json(goal_dir(workspace) / "consent.json", consent)
    line = STATUS["asked"].format(condition=refused["condition"])
    return {"line": line, "consent": consent, "guide": answer_guide("asked", refused["condition"])}


def propose_loop(
    workspace: Path, check: str, objective: str, *, session_id: str = "", now: float | None = None,
    timeout: int = FALSIFY_TIMEOUT_SECONDS, run=subprocess.run, falsify_now: bool = True,
) -> dict[str, Any]:
    """The lit-loop question once its check exists; records it, or records nothing and says why.

    `falsify_now=False` skips the dry run: the prompt hook cannot wait on a test run, and the
    objective clause keeps such a goal false until the work is done. A hook-asked question carries
    its session at once; one asked through the CLI is bound when its turn ends, like a plan's.
    """
    workspace = Path(workspace).resolve()
    goal = loop_objective(objective)
    command = " ".join(str(check or "").split())
    if not goal:
        return {"line": STATUS["skipped"].format(reason="name what the loop should finish")}
    built = compile_loop_condition(goal, command)
    if not built["ok"]:
        return {"line": STATUS["skipped"].format(reason=built["reason"])}
    lint = lint_condition(built["condition"], command)
    if not lint["ok"]:
        return {"line": STATUS["skipped"].format(reason="; ".join(lint["reasons"]))}
    if falsify_now:
        dry = falsify_loop(workspace, command, timeout=timeout, run=run)
        if not dry["ok"]:
            return {"line": STATUS["skipped"].format(reason=dry["reason"])}
    consent = {
        "version": 2, "kind": "loop", "condition": built["condition"], "check": command, "id": built["id"],
        "plan": None, "objective": goal, "askedAt": time.time() if now is None else now,
    }
    if session_id:
        consent["session"] = session_id
    consent["hash"] = consent_hash(consent)
    _write_json(goal_dir(workspace) / "consent.json", consent)
    line = STATUS["loop_asked"].format(condition=built["condition"])
    return {"line": line, "consent": consent, "guide": answer_guide("loop_asked", built["condition"])}


def offer_loop(workspace: Path, session_id: str, objective: str, *, now: float | None = None) -> dict[str, Any] | None:
    """The prompt hook's question for a lit-loop's first activation, or None when it asks nothing.

    It asks only with an objective, a project test command, and no goal owned (an accepted intent)
    or pending (a live question). An accepted loop goal counts as owned for a day. Nothing runs here.
    """
    if not session_id or not loop_objective(objective):
        return None
    folder = goal_dir(workspace)
    stamp = now if now is not None else time.time()
    if (folder / "intent.json").exists():
        if not _loop_intent_is_spent(_read_json(folder / "intent.json"), stamp):
            return None
        (folder / "intent.json").unlink(missing_ok=True)
    pending = _read_json(folder / "consent.json")
    if (folder / "consent.json").exists() and not (
        pending and pending.get("kind") == "loop" and not _loop_is_live(pending, stamp)
    ):
        return None
    check = detect_check(workspace)
    if not check:
        return None
    offer = propose_loop(workspace, check, objective, session_id=session_id, now=now, falsify_now=False)
    return offer if offer.get("consent") else None


def _loop_intent_is_spent(intent: dict[str, Any] | None, now: float) -> bool:
    """An accepted lit-loop goal stops blocking the next question a day after the yes.

    LitHermes cannot see Hermes' own `/goal`, and a loop goal has no plan rows to tick, so a day
    stands in for "finished". A plan's intent is retired by its own check instead and never ages out.
    """
    if not intent or intent.get("kind") != "loop":
        return False
    accepted = intent.get("acceptedAt")
    return isinstance(accepted, (int, float)) and now - accepted > LOOP_INTENT_TTL_SECONDS


def _loop_is_live(consent: dict[str, Any], now: float) -> bool:
    asked = consent.get("askedAt")
    return isinstance(asked, (int, float)) and 0 <= now - asked <= LOOP_CONSENT_TTL_SECONDS


def _goal_refusal(workspace: Path, plan: str, plan_text: str, *, timeout: int, run) -> str | dict[str, str]:
    """The reason no goal can be set for this plan, or {condition, check, id} when one can."""
    if re.search(r"(?m)^goal:\s*never\s*$", plan_text):
        return "this plan is marked goal: never"
    done = parse_done_when(plan_text)
    if not done["ok"]:
        return done["reason"]
    built = compile_condition(plan, done["check"])
    if not built["ok"]:
        return built["reason"]
    lint = lint_condition(built["condition"], done["check"])
    if not lint["ok"]:
        return "; ".join(lint["reasons"])
    dry = falsify(workspace, plan_text, done["check"], timeout=timeout, run=run)
    if not dry["ok"]:
        return dry["reason"]
    return {"condition": built["condition"], "check": done["check"], "id": built["id"]}


def consent_hash(consent: dict[str, Any]) -> str:
    """Binds the answer to exactly what was asked: the plan, the condition and the check (and a loop's kind)."""
    keys = ("plan", "condition", "check") + (("kind",) if consent.get("kind") == "loop" else ())
    return condition_hash("\0".join(str(consent.get(key) or "") for key in keys))


def consent_answer(prompt: str) -> str | None:
    """`yes` (exactly, any case) accepts; `edit` and `no` answer too; anything else is no answer."""
    text = str(prompt or "").strip().lower()
    return text if text in {"yes", "edit", "no"} else None


def consent_is_intact(consent: dict[str, Any] | None) -> bool:
    if consent and consent.get("kind") == "loop":
        if not isinstance(consent.get("condition"), str) or not consent["condition"] or consent.get("plan") is not None:
            return False
        return consent.get("hash") == consent_hash(consent) and isinstance(consent.get("askedAt"), (int, float))
    if not consent or not isinstance(consent.get("condition"), str) or not _PLAN_PATH.match(str(consent.get("plan") or "")):
        return False
    return consent.get("hash") == consent_hash(consent) and isinstance(consent.get("askedAt"), (int, float))


def bind_consent(workspace: Path, session_id: str, *, since: float | None) -> bool:
    """At the end of the turn that asked, tie the open question to that session. True when bound.

    Only a question recorded during this turn (`askedAt >= since`) and not yet bound is taken, so
    a session never claims a question another session asked.
    """
    if not session_id or since is None:
        return False
    path = goal_dir(workspace) / "consent.json"
    consent = _read_json(path)
    if not consent_is_intact(consent) or consent.get("session") or consent["askedAt"] < since:
        return False
    _write_json(path, {**consent, "session": session_id})
    return True


def answer_consent(
    workspace: Path, prompt: str, *, session_id: str = "", now: float | None = None, start=None
) -> dict[str, str]:
    """{line, context} for a whole-prompt answer to the question this session was asked; {} when
    there is no question or no answer. A `yes` from any other session, or to a question no session
    owns yet, starts nothing and says how to start the plan by hand.

    `yes` starts the plan through ``start(workspace, plan) -> (ok, context_or_reason)`` (the same
    code path as typing `/start-work <plan>`), and only after the start succeeded records the goal.
    A refused start records nothing and says why.
    """
    answer = consent_answer(prompt)
    folder = goal_dir(workspace)
    consent = _read_json(folder / "consent.json")
    now = time.time() if now is None else now
    if answer is None and not (consent and consent.get("kind") == "loop"):
        return {}
    if not consent_is_intact(consent):
        return {}
    if consent.get("kind") == "loop":
        return _answer_loop(folder, consent, answer, session_id, now)
    if not session_id or consent.get("session") != session_id:
        return {"line": STATUS["other_session"].format(plan=consent["plan"])} if answer == "yes" else {}
    (folder / "consent.json").unlink(missing_ok=True)
    if answer == "edit":
        return {"line": STATUS["edit"]}
    if answer == "no":
        return {"line": STATUS["declined"]}
    if start is None:
        return {"line": STATUS["start_failed"].format(reason="this host has no start path")}
    try:
        ok, detail = start(Path(workspace), consent["plan"])
    except Exception as exc:  # noqa: BLE001 - a failed start is a status line, never a crash
        ok, detail = False, str(exc) or exc.__class__.__name__
    if not ok:
        return {"line": STATUS["start_failed"].format(reason=_one_line(detail))}
    if not consent.get("condition"):
        return {"line": STATUS["started"].format(plan=consent["plan"]), "context": detail}
    _write_json(folder / "intent.json", {**consent, "acceptedAt": now})
    return {
        "line": STATUS["accepted"].format(plan=consent["plan"], condition=consent["condition"], check=consent["check"]),
        "context": detail,
    }


def _answer_loop(folder: Path, consent: dict[str, Any], answer: str | None, session_id: str, now: float) -> dict[str, str]:
    """A lit-loop question is answered by the session that was asked, and only by the exact `yes`.

    That session's next prompt always settles it: `yes` records the intent (nothing is started),
    `no` says so, and `edit`, any other words or a stale question just drop it. Another session
    never touches it.
    """
    if not session_id or consent.get("session") != session_id:
        return {}
    (folder / "consent.json").unlink(missing_ok=True)
    if answer not in {"yes", "no"} or not _loop_is_live(consent, now):
        return {}
    if answer == "no":
        return {"line": STATUS["loop_declined"]}
    _write_json(folder / "intent.json", {**consent, "acceptedAt": now})
    return {
        "line": STATUS["loop_accepted"].format(condition=consent["condition"], check=consent["check"]),
        "note": "The user's `yes` answered the goal question only. Go on with the lit-loop work; never type /goal yourself.",
    }


def _one_line(text: str) -> str:
    line = " ".join(str(text or "").split())
    line = re.sub(r"^BLOCKED:\s*", "", line).rstrip(".")
    return line[:240] or "the start was refused"


def turn_end_check(workspace: Path, *, timeout: int = FALSIFY_TIMEOUT_SECONDS, run=subprocess.run) -> dict[str, Any] | None:
    """Advisory, at turn end: once every row of the accepted plan is ticked, run its check once.

    Before that the condition is false by construction, so nothing runs. The result waits in
    result.json for the next turn; a met condition retires the intent.
    """
    folder = goal_dir(workspace)
    intent = _read_json(folder / "intent.json")
    if not intent or not intent.get("condition") or intent.get("hash") != consent_hash(intent):
        return None
    if intent.get("kind") == "loop":
        return None  # no plan rows to wait on; Hermes' own gate runs a loop goal's check
    try:
        plan_text = (Path(workspace) / str(intent["plan"])).read_text(encoding="utf-8")
    except (OSError, KeyError):
        return None
    ticked, total = plan_rows(plan_text)
    if not total or ticked < total:
        return None
    if not lint_condition(intent["condition"], str(intent.get("check") or ""))["ok"]:
        return None
    try:
        result = run(
            shlex.split(intent["check"]), cwd=str(workspace), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, timeout=timeout, check=False, shell=False,
        )
        code = result.returncode
    except subprocess.TimeoutExpired:
        code = -1
    except (OSError, ValueError):
        code = 127
    record = {"condition": intent["condition"], "check": intent["check"], "exit": code, "met": code == 0}
    _write_json(folder / "result.json", record)
    if code == 0:
        (folder / "intent.json").unlink(missing_ok=True)
    return record


def take_result_line(workspace: Path) -> str:
    """The status line of the last turn-end check, said once."""
    path = goal_dir(workspace) / "result.json"
    record = _read_json(path)
    if not record:
        return ""
    path.unlink(missing_ok=True)
    if record.get("met"):
        return STATUS["met"].format(condition=record.get("condition", ""))
    return STATUS["not_met"].format(check=record.get("check", ""), exit=record.get("exit"))
