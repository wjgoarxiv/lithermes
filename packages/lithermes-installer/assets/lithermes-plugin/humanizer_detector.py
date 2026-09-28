"""Python port of the LitHumanizer line/sentence/document rule engine."""

from __future__ import annotations

import argparse
from bisect import bisect_right
import json
from pathlib import Path
import re
import sys
from typing import Iterable


PLUGIN_ROOT = Path(__file__).resolve().parent
SKILL_ROOT = PLUGIN_ROOT / "skills" / "lit-humanizer"
RULES_PATH = SKILL_ROOT / "rules.json"
VALID_LANGS = {"ko", "en", "code"}
VALID_SEVERITIES = {"block", "warn"}
VALID_SCOPES = {"line", "sentence", "document"}


def _js_compatible_pattern(pattern: str) -> str:
    """Port JavaScript ASCII word classes without narrowing Unicode ``\s``."""
    result: list[str] = []
    in_class = False
    index = 0
    while index < len(pattern):
        char = pattern[index]
        if char == "\\" and index + 1 < len(pattern):
            code = pattern[index + 1]
            if code in {"w", "d"}:
                value = "A-Za-z0-9_" if code == "w" else "0-9"
                result.append(value if in_class else f"[{value}]")
            elif code in {"b", "B"} and not in_class:
                result.append(r"(?a:\b)" if code == "b" else r"(?a:\B)")
            else:
                result.extend((char, code))
            index += 2
            continue
        if char == "[" and not in_class:
            in_class = True
        elif char == "]" and in_class:
            in_class = False
        result.append(char)
        index += 1
    return "".join(result)


def load_rules(path: str | Path = RULES_PATH) -> list[dict]:
    """Load the bundled schema, rejecting malformed or duplicate rule entries."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("schema_version") != 1 or not isinstance(data.get("rules"), list):
        raise ValueError("rules.json must use schema_version 1 and contain a rules array")
    seen: set[str] = set()
    result = []
    flag_values = {"i": re.IGNORECASE, "m": re.MULTILINE, "s": re.DOTALL}
    for item in data["rules"]:
        rule_id = item.get("id")
        if not isinstance(rule_id, str) or not rule_id or rule_id in seen:
            raise ValueError(f"missing or duplicate rule id: {rule_id}")
        seen.add(rule_id)
        if item.get("lang") not in VALID_LANGS or item.get("severity") not in VALID_SEVERITIES or item.get("scope") not in VALID_SCOPES:
            raise ValueError(f"invalid lang, severity, or scope for {rule_id}")
        if not isinstance(item.get("pattern"), str) or not isinstance(item.get("context"), list):
            raise ValueError(f"incomplete rule definition: {rule_id}")
        flags = 0
        for flag in item.get("flags", ""):
            if flag not in flag_values:
                raise ValueError(f"unsupported regex flag {flag!r} for {rule_id}")
            flags |= flag_values[flag]
        compiled = re.compile(_js_compatible_pattern(item["pattern"]), flags)
        result.append({**item, "regex": compiled})
    return result


def _is_internal_path(file: str) -> bool:
    segments = re.split(r"[\\/]+", str(file).replace("\\", "/"))
    for index, segment in enumerate(segments):
        lower = segment.lower()
        if lower in {"plans", "evidence", "ledgers", ".hermes"} or lower.startswith(".lit") or segment.upper().startswith("HANDOFF"):
            return True
    return False


def _is_caption(line: str) -> bool:
    return bool(re.match(r"^\s*(?:>\s*)?(?:!\[)?(?:표\s*\d+|그림\s*\d+|table\s+\d+|figure\s+\d+)\b", line, re.IGNORECASE | re.ASCII))


_PLAIN_SOURCE = re.compile(r"^\s*(?:Source|Sources|출처|자료|※\s*자료)\s*[:：]", re.IGNORECASE | re.ASCII)
_BOLD_OR_HTML = re.compile(r"^\s*(?:\*\*|__|<b\b)", re.IGNORECASE | re.ASCII)
_CAVEAT_PHRASE = re.compile(
    r"\b(?:not\s+(?:realized\s+results?|verified|independently verified|performed|a permit decision|final|actual)|"
    r"demo(?:nstration)?\s+(?:synthesis|assumptions|recommendations?)|"
    r"(?:preliminary|provisional|tentative|draft|estimated?)\s+(?:results?|data|findings?|outcomes?|values?)|"
    r"results?\s+may\s+(?:change|be revised)|subject\s+to\s+change)\b|미실현|실현되지|미검증|검증되지|미확인|"
    r"(?:잠정|예비|추정|예상)(?:치)?(?:\s*(?:결과|자료|수치|값))?|변동\s*가능|변경\s*가능|확정되지|미확정",
    re.IGNORECASE | re.ASCII,
)
_STANDALONE_STATUS = re.compile(
    r"^(?:assumptions?|recommendations?|unverified|preliminary|provisional|tentative|draft|estimated?|estimate|forecast|projection|projected|planned|simulated|modeled|가정|권고|제안|잠정(?:치)?|예비|추정(?:치)?|예상)$",
    re.IGNORECASE | re.ASCII,
)
_APPENDED_CAVEAT = re.compile(
    r"(?:^|\s)(?:not\s+(?:realized\s+results?|verified|independently verified|performed|a permit decision|final|actual)|"
    r"demo(?:nstration)?\s+(?:synthesis|assumptions|recommendations?)|"
    r"(?:preliminary|provisional|tentative|draft|estimated?)\s+(?:results?|data|findings?|outcomes?|values?)|"
    r"results?\s+may\s+(?:change|be revised)|subject\s+to\s+change|unverified|미실현|실현되지|미검증|검증되지|미확인|"
    r"잠정(?:치)?|예비(?:자료|결과|수치)?|추정(?:치|자료|결과)?|예상(?:치|자료|결과)?|변동\s*가능|변경\s*가능|확정되지|미확정)\s*[.!?。)]*$",
    re.IGNORECASE | re.ASCII,
)


def _plain_source_line(line: str) -> bool:
    return bool(_PLAIN_SOURCE.match(line)) and not _BOLD_OR_HTML.match(line)


def _has_embedded_caveat(line: str) -> bool:
    body = re.sub(r"^\s*(?:Source|Sources|출처|자료|※\s*자료)\s*[:：]\s*", "", line, flags=re.IGNORECASE | re.ASCII)
    segments = [re.sub(r"[.!?。]+$", "", segment.strip()) for segment in re.split(r"[,;:—–]", body)]
    tail = segments[-1] if segments else ""
    return bool(_CAVEAT_PHRASE.search(tail) or _STANDALONE_STATUS.fullmatch(tail) or _APPENDED_CAVEAT.search(body))


def _inline_code_as_spaces(line: str) -> str:
    return re.sub(r"(`+)[^`]*?\1", lambda match: " " * len(match.group(0)), line)


def _source_rows(text: str) -> list[dict]:
    fence: tuple[str, int] | None = None
    caption_pending = 0
    figure_active = False
    rows = []
    for number, line in enumerate(re.split(r"\r?\n", text), start=1):
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if fence:
            if marker and marker.group(1)[0] == fence[0] and len(marker.group(1)) >= fence[1]:
                fence = None
            caption_pending = 0
            figure_active = False
            rows.append({"line": line, "number": number, "candidate": "", "skipped": True, "caption": False, "caption_attribution": False})
            continue
        if marker:
            caption_pending = 0
            fence = (marker.group(1)[0], len(marker.group(1)))
            figure_active = False
            rows.append({"line": line, "number": number, "candidate": "", "skipped": True, "caption": False, "caption_attribution": False})
            continue
        if re.match(r"^\s{0,3}>", line):
            caption_pending = 0
            figure_active = False
            rows.append({"line": line, "number": number, "candidate": "", "skipped": True, "caption": False, "caption_attribution": False})
            continue
        candidate = _inline_code_as_spaces(line)
        caption = _is_caption(line)
        plain_source = _plain_source_line(line)
        source_anchor = bool(
            re.match(r"^\s*\|", line)
            or re.match(r"^\s*!\[[^\]]*\]\s*\(", line)
            or re.match(r"^\s*<img\b", line, re.IGNORECASE | re.ASCII)
            or caption
        )
        opens_figure = bool(re.search(r"<figure\b", line, re.IGNORECASE | re.ASCII))
        closes_figure = bool(re.search(r"</figure\s*>", line, re.IGNORECASE | re.ASCII))
        if opens_figure:
            figure_active = True
        caption_attribution = not _has_embedded_caveat(line) and plain_source and (caption_pending > 0 or figure_active)
        if source_anchor or closes_figure:
            caption_pending = 2
        elif plain_source:
            caption_pending = 0
        elif line.strip() and caption_pending > 0:
            caption_pending = 0
        elif caption_pending > 0:
            caption_pending -= 1
        if closes_figure:
            figure_active = False
        rows.append({"line": line, "number": number, "candidate": candidate, "skipped": False, "caption": caption, "caption_attribution": caption_attribution})
    return rows


def _join_rows(rows: list[dict], separator: str) -> dict:
    text_parts: list[str] = []
    offsets: list[int] = []
    size = 0
    for index, row in enumerate(rows):
        if index:
            size += len(separator)
        offsets.append(size)
        text_parts.append(row["candidate"])
        size += len(row["candidate"])
    return {"text": separator.join(text_parts), "line_starts": list(zip(offsets, (row["number"] for row in rows)))}


def _line_at_offset(span: dict, offset: int) -> int:
    if "line" in span:
        return span["line"]
    starts = span["line_starts"]
    if not starts:
        return 1
    positions = [entry[0] for entry in starts]
    index = max(0, bisect_right(positions, offset) - 1)
    return starts[index][1]


def _slice_span(span: dict, start: int, end: int) -> dict:
    selected = [(offset - start, line) for offset, line in span["line_starts"] if start <= offset < end]
    if not selected or selected[0][0] > 0:
        selected.insert(0, (0, _line_at_offset(span, start)))
    return {"text": span["text"][start:end], "line_starts": selected}


_SENTENCE_BOUNDARY = re.compile(r"[.!?。！？]+(?:[\"'”’»)\]]*)\s+")


def _split_sentences(span: dict) -> list[dict]:
    parts = []
    start = 0
    for match in _SENTENCE_BOUNDARY.finditer(span["text"]):
        whitespace = len(match.group(0)) - len(match.group(0).rstrip())
        end = match.end() - whitespace
        if end > start:
            parts.append(_slice_span(span, start, end))
        start = match.end()
    if start < len(span["text"]):
        parts.append(_slice_span(span, start, len(span["text"])))
    return parts


def _rule_segments(rows: list[dict], rule: dict) -> list[dict]:
    skip_captions = "table_figure_caption" in rule["context"]
    if rule["scope"] == "line":
        return [
            {"text": row["candidate"], "line": row["number"]}
            for row in rows
            if not row["skipped"] and not (skip_captions and (row["caption"] or row["caption_attribution"]))
        ]
    segments: list[dict] = []
    group: list[dict] = []

    def flush() -> None:
        nonlocal group
        if group:
            joined = _join_rows(group, " " if rule["scope"] == "sentence" else "\n")
            segments.extend(_split_sentences(joined) if rule["scope"] == "sentence" else [joined])
            group = []

    for row in rows:
        exempt = skip_captions and (row["caption"] or row["caption_attribution"])
        if row["skipped"] or exempt or (rule["scope"] == "sentence" and not row["candidate"].strip()):
            flush()
        else:
            group.append(row)
    flush()
    return segments


def _matches_language(rule: dict, text: str) -> bool:
    if rule["lang"] == "ko":
        return bool(re.search(r"[가-힣]", text))
    if rule["lang"] == "en":
        return bool(re.search(r"[a-z]", text, re.IGNORECASE | re.ASCII))
    return True


def scan_text(text: str, rules: Iterable[dict] | None = None, file: str = "<stdin>") -> list[dict]:
    """Return at most one finding per rule segment with canonical line mapping."""
    if _is_internal_path(file):
        return []
    selected = list(rules) if rules is not None else load_rules()
    rows = _source_rows(str(text or ""))
    findings = []
    cache: dict[tuple[str, bool], list[dict]] = {}
    for rule in selected:
        key = (rule["scope"], "table_figure_caption" in rule["context"])
        if key not in cache:
            # Scope is the only rule-specific segmentation property. A shallow
            # rule copy shares its context only when caption handling differs.
            cache[key] = _rule_segments(rows, rule)
        for segment in cache[key]:
            if not _matches_language(rule, segment["text"]):
                continue
            match = rule["regex"].search(segment["text"])
            if match is None:
                continue
            excerpt = re.sub(r"\s+", " ", segment["text"].strip())[:180]
            findings.append({
                "file": str(file),
                "rule": rule["id"],
                "severity": rule["severity"],
                "line": _line_at_offset(segment, match.start()),
                "line_end": _line_at_offset(segment, max(match.start(), match.end() - 1)),
                "match": match.group(0)[:240],
                "excerpt": excerpt,
            })
    return findings


def exit_code(findings: Iterable[dict]) -> int:
    severities = {finding["severity"] for finding in findings}
    return 2 if "block" in severities else 1 if "warn" in severities else 0


def _read_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".docx", ".pptx", ".pdf"}:
        try:
            from humanizer_office import extract_text
        except ImportError:
            from .humanizer_office import extract_text
        return extract_text(path)
    if path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError("refusing text larger than 2 MiB")
    return path.read_text(encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scan new prose for LitHumanizer editing signals.")
    parser.add_argument("--json", action="store_true", help="print findings as JSON")
    parser.add_argument("--stdin-json", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("path", nargs="?", help="text, DOCX, PPTX, or PDF file; stdin when omitted")
    args = parser.parse_args(argv)
    try:
        if args.stdin_json:
            payload = json.load(sys.stdin)
            if not isinstance(payload, dict) or not isinstance(payload.get("text"), str):
                raise ValueError("expected JSON object with a text string")
            text = payload["text"]
            file = str(payload.get("file") or "<stdin>")
        else:
            path = Path(args.path).expanduser() if args.path else None
            text = _read_text(path) if path else sys.stdin.read()
            file = str(path) if path else "<stdin>"
        findings = scan_text(text, file=file)
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError, RuntimeError) as error:
        print(f"LIT_HUMANIZER_SCAN_ERROR: {error}", file=sys.stderr)
        return 3
    if args.stdin_json or args.json:
        print(json.dumps(findings, ensure_ascii=False, separators=(",", ":")))
    else:
        for finding in findings:
            print(f"{finding['severity'].upper()} {finding['rule']}:{finding['line']}: {finding['excerpt']}")
        if not findings:
            print("LIT_HUMANIZER_CLEAN")
    return 0 if args.stdin_json else exit_code(findings)


if __name__ == "__main__":
    raise SystemExit(main())
