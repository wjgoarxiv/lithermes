"""A "check back later" follow-up that only reports, run by Hermes' own cron scheduler.

``hermes lithermes followup`` prints a blueprint and never creates anything: one ``hermes cron create``
line, and the same job as ``cronjob_manage`` arguments for asking the agent to create it. The user runs
it. The job runs in the project folder (``workdir``), loads the ``lithermes:litgoal`` skill, and its
prompt carries a ``<lithermes-followup>`` marker line.

When that job fires, Hermes starts a fresh cron session (``platform: cron``). LitHermes recognises the
marker in that session's first prompt and then:

1. reads the project's state itself: plan rows done and left (``plan.md``, ``plans/*.md``), bounded runs
   and their parked steps, and how long each open plan has sat unchanged;
2. compares a hash of that picture with the last one in the project's ``shown.jsonl`` (the record of
   what LitHermes already told the user). Unchanged: the model is told to answer exactly ``[SILENT]``,
   which Hermes' cron delivery suppresses. Changed: the report goes in, the hash is recorded, and the
   model is told to send that report as its whole answer;
3. blocks every tool in that session except reads (``read_file``, ``search_files``, ``goal_status``,
   skill views and read-only terminal pipelines). Hermes' cron approval mode already denies dangerous
   commands; a plain file write needs no approval there, so this guard is what keeps the run read-only.

Nothing here schedules, approves, or writes outside the project's ``.hermes/lithermes/shown.jsonl``.
"""

from __future__ import annotations

import hashlib
import json
import re
import shlex
import threading
import time
from pathlib import Path
from typing import Any

try:
    from . import bounded_work, shown_record
except (ImportError, ModuleNotFoundError):
    import bounded_work  # type: ignore
    import shown_record  # type: ignore

MARKER = "<lithermes-followup"
DEFAULT_EVERY = "every 2h"
# Plugin skills resolve only by their qualified name; a bare `litgoal` is looked up among the user's own skills.
SKILL = "lithermes:litgoal"
NAME = "lithermes-followup"
SILENT = "[SILENT]"
MAX_PLANS = 12
MAX_PLAN_BYTES = 256 * 1024
STALE_DAYS = 3
_MARKER_RE = re.compile(r'^<lithermes-followup v="1" workdir="([^"\n]+)">', re.MULTILINE)
_ROW = re.compile(r"^\s*- \[([ xX])\] (.+?)\s*$")
_PLAIN = re.compile(r"[\x00-\x1f\x7f]")
_READ_TOOLS = frozenset({"read_file", "search_files", "goal_status", "skill_view", "skills_list"})
MAX_PROMPT_SCAN = 256 * 1024
_LOCK = threading.Lock()
_REPORT_ONLY: dict[str, str] = {}
_MAX_SESSIONS = 64


def _reset_for_tests() -> None:
    with _LOCK:
        _REPORT_ONLY.clear()


def _clip(text: Any, limit: int) -> str:
    plain = " ".join(_PLAIN.sub(" ", str(text or "")).split())
    return plain if len(plain) <= limit else plain[: limit - 1] + "…"


# ---- the printed blueprint ----------------------------------------------------

def prompt(workdir: Path) -> str:
    """One line, so the printed shell command stays one line."""
    return " ".join([
        f'<lithermes-followup v="1" workdir="{workdir}">',
        "Report-only follow-up for this project. LitHermes adds the project's state to this turn and says",
        "whether anything changed since the last report. Do not edit, run, approve or schedule anything.",
        f"If LitHermes says nothing changed, answer exactly {SILENT}. Otherwise send its report as your whole answer.",
    ])


def blueprint(workdir: Path | str, every: str = DEFAULT_EVERY) -> str:
    """The lines ``hermes lithermes followup`` prints. Creates nothing."""
    folder = Path(workdir).expanduser().resolve()
    if '"' in str(folder) or "\n" in str(folder):
        raise ValueError("the project path cannot hold a double quote or a newline")
    text = prompt(folder)
    command = " ".join([
        "hermes cron create", shlex.quote(every), shlex.quote(text),
        "--name", NAME, "--skill", SKILL, "--workdir", shlex.quote(str(folder)),
    ])
    tool_args = {
        "action": "create", "name": NAME, "schedule": every, "prompt": text,
        "skills": [SKILL], "workdir": str(folder),
    }
    return "\n".join([
        f"LitHermes follow-up for {folder} (report only; nothing is scheduled until you run a line below).",
        "",
        "Run this in a shell:",
        command,
        "",
        "Or ask Hermes to call cronjob_manage with these arguments:",
        json.dumps(tool_args, ensure_ascii=False, indent=2),
        "",
        f"Each run reads plan rows, bounded runs and parked steps, and answers {SILENT} (nothing is delivered)",
        "when nothing changed since the last report. Its tools are limited to reads. Stop it with",
        "`hermes cron list` and `hermes cron remove <job id>`.",
    ])


def setup_cli(parser) -> None:
    parser.add_argument("--every", default=DEFAULT_EVERY, help=f"Hermes schedule text (default: {DEFAULT_EVERY!r})")
    parser.add_argument("--worktree", default=".", help="project folder the job runs in (default: here)")


def handle_cli(args) -> int:
    folder = Path(str(getattr(args, "worktree", ".") or ".")).expanduser()
    if not folder.is_dir():
        print(f"{folder} is not a folder.")
        return 2
    try:
        print(blueprint(folder, str(getattr(args, "every", DEFAULT_EVERY) or DEFAULT_EVERY)))
    except ValueError as exc:
        print(str(exc))
        return 2
    return 0


# ---- the woken run ------------------------------------------------------------

def _plan_files(workdir: Path) -> list[Path]:
    found: list[Path] = []
    for name in ("plan.md", "PLAN.md"):
        path = workdir / name
        # On a case-insensitive disk both names are the same file.
        if path.is_file() and not any(path.samefile(seen) for seen in found):
            found.append(path)
    plans = workdir / "plans"
    if plans.is_dir():
        found += sorted(
            (p for p in plans.glob("*.md") if p.is_file() and not p.is_symlink()),
            key=lambda p: p.stat().st_mtime, reverse=True,
        )
    return list(dict.fromkeys(found))[:MAX_PLANS]


def _plan_rows(path: Path) -> tuple[int, int, str]:
    try:
        raw = path.read_bytes()[:MAX_PLAN_BYTES].decode("utf-8", "replace")
    except OSError:
        return 0, 0, ""
    done = total = 0
    upcoming = ""
    for line in raw.splitlines():
        row = _ROW.match(line)
        if not row:
            continue
        total += 1
        if row.group(1) in "xX":
            done += 1
        elif not upcoming:
            upcoming = row.group(2)
    return done, total, upcoming


def _runs(workdir: Path) -> list[tuple[str, str, int]]:
    root = workdir / ".hermes" / "lithermes" / bounded_work.WORK_DIRNAME
    out: list[tuple[str, str, int]] = []
    if not root.is_dir():
        return out
    for run_dir in sorted(root.iterdir()):
        if not run_dir.is_dir():
            continue
        try:
            state = json.loads((run_dir / "state.json").read_text(encoding="utf-8"))
            parked = bounded_work.parked_steps(workdir, run_dir.name)
        except (OSError, ValueError):
            continue
        if not isinstance(state, dict) or state.get("status") in {"completed", "cancelled"}:
            continue
        out.append((run_dir.name, str(state.get("status") or "?"), len(parked)))
    return out


def picture(workdir: Path, now: float | None = None) -> tuple[str, str]:
    """``(hash, report)`` for the project's state now. The hash leaves out ages, so time alone is no change."""
    moment = time.time() if now is None else now
    keyed: list[Any] = []
    lines: list[str] = []
    for path in _plan_files(workdir):
        done, total, upcoming = _plan_rows(path)
        if not total:
            continue
        rel = path.relative_to(workdir).as_posix()
        keyed.append(["plan", rel, done, total])
        line = f"- {rel}: {done}/{total} rows done"
        if done < total:
            line += f"; next: {_clip(upcoming, 80)}"
            idle = (moment - path.stat().st_mtime) / 86400
            if idle >= STALE_DAYS:
                line += f"; unchanged for {int(idle)} days"
        lines.append(line)
    for work_id, status, parked in _runs(workdir):
        keyed.append(["run", work_id, status, parked])
        line = f"- bounded work {work_id}: {status}"
        if parked:
            line += f", {parked} step(s) parked; type `lit approve` or `lit deny` in a session in this project"
        lines.append(line)
    digest = hashlib.sha256(json.dumps(keyed, sort_keys=True).encode("utf-8")).hexdigest()[:16]
    report = "\n".join([f"LIT follow-up · {workdir.name}", *(lines or ["- no plan rows or bounded runs found"])])
    return digest, report


def _marked_workdir(message: str) -> Path | None:
    # Hermes puts its cron notice and the loaded skill before the job's own prompt, so look at all of it.
    found = _MARKER_RE.search(str(message or "")[:MAX_PROMPT_SCAN])
    if not found:
        return None
    folder = Path(found.group(1))
    return folder if folder.is_absolute() and folder.is_dir() else None


def pre_llm_call(**kwargs: Any) -> dict[str, str] | None:
    """In a cron session whose prompt carries the marker: the report or ``[SILENT]``, and the read-only guard."""
    if str(kwargs.get("platform") or "").strip().lower() != "cron":
        return None
    session_id = str(kwargs.get("session_id") or "")
    with _LOCK:
        known = _REPORT_ONLY.get(session_id)
    workdir = _marked_workdir(str(kwargs.get("user_message") or ""))
    if workdir is None:
        return None
    if not session_id:
        return {"context": f"LitHermes follow-up: no session id, so the run cannot be held to reads. Answer exactly {SILENT}."}
    with _LOCK:
        if len(_REPORT_ONLY) >= _MAX_SESSIONS and session_id not in _REPORT_ONLY:
            _REPORT_ONLY.pop(next(iter(_REPORT_ONLY)))
        _REPORT_ONLY[session_id] = str(workdir)
    if known is not None:
        return None
    state = workdir / ".hermes" / "lithermes"
    try:
        digest, report = picture(workdir)
    except OSError:
        return {"context": f"LitHermes follow-up could not read {workdir}. Answer exactly {SILENT}."}
    if shown_record.was_shown(state, "followup", digest):
        return {"context": (
            '<lithermes-followup-result changed="false">\n'
            f"Nothing changed since the last follow-up report. Answer exactly {SILENT} and nothing else.\n"
            "</lithermes-followup-result>"
        )}
    shown_record.mark_shown(state, "followup", digest)
    return {"context": "\n".join([
        '<lithermes-followup-result changed="true">',
        "Send the report below as your whole answer, as written. Do not call tools or add advice.",
        report,
        "</lithermes-followup-result>",
    ])}


def pre_tool_call(tool_name: Any, args: Any, session_id: Any) -> dict[str, str] | None:
    """Every tool but a read is blocked in a follow-up session."""
    with _LOCK:
        held = str(session_id or "") in _REPORT_ONLY
    if not held:
        return None
    name = str(tool_name or "").strip()
    if name in _READ_TOOLS:
        return None
    payload = args if isinstance(args, dict) else {}
    if name == "terminal" and bounded_work.classify_observation(payload.get("command")):
        return None
    return {
        "action": "block",
        "message": (
            f"LitHermes follow-up runs only report; `{_clip(name, 40)}` was not run. "
            f"Send the report you were given, or {SILENT} if nothing changed."
        ),
    }


def release_session(session_id: Any) -> None:
    with _LOCK:
        _REPORT_ONLY.pop(str(session_id or ""), None)
