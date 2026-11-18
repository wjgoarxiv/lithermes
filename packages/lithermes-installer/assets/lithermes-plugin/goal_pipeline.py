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

GOAL_MAX_CHARS = 500
FALSIFY_TIMEOUT_SECONDS = 120

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

STATUS = {
    "asked": "Approve plan, start work and set goal: /goal {condition}? (yes / edit / no)",
    "asked_start": "Approve plan and start work? (yes / no)",
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
        return {"line": STATUS["asked_start"] + "\n" + STATUS["skipped"].format(reason=refused), "consent": consent}
    consent = {"version": 2, **refused, "plan": plan, "askedAt": asked}
    consent["hash"] = consent_hash(consent)
    _write_json(goal_dir(workspace) / "consent.json", consent)
    return {"line": STATUS["asked"].format(condition=refused["condition"]), "consent": consent}


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
    """Binds the answer to exactly what was asked: the plan, the condition and the check."""
    return condition_hash("\0".join(str(consent.get(key) or "") for key in ("plan", "condition", "check")))


def consent_answer(prompt: str) -> str | None:
    """`yes` (exactly, any case) accepts; `edit` and `no` answer too; anything else is no answer."""
    text = str(prompt or "").strip().lower()
    return text if text in {"yes", "edit", "no"} else None


def consent_is_intact(consent: dict[str, Any] | None) -> bool:
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
    if answer is None:
        return {}
    folder = goal_dir(workspace)
    consent = _read_json(folder / "consent.json")
    now = time.time() if now is None else now
    if not consent_is_intact(consent):
        return {}
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
