#!/usr/bin/env python3
"""Verifier for comprehend explainer artifacts.

Usage:
    python verify-explainer.py <artifact.html> [--repo <dir>] [--json]

Exits 0 on PASS, 1 on FAIL.

Checks:
  artifact-exists        File must exist and be readable
  artifact-nonempty      File must be at least 400 bytes
  filename-dated         Basename must start with YYYY-MM-DD-
  outside-repo           Artifact must NOT be inside the repo worktree
  self-contained         No external resource references
  sections               The 7 useful reader-facing section headers are present
  no-collapsed-code      No <details>/<summary> wrapping <pre> blocks
  code-attribution       Code blocks must carry data-src file attribution
  quotes-real            data-src quoted lines must exist in the cited file
  paths-exist            Repo-relative paths in <code> should exist (WARN)
  no-ascii-art           No box-drawing characters outside <pre> blocks
  quiz                   Quiz structure and anti-tell checks
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

CANONICAL_SECTIONS = (
    "한눈에",
    "이미 알고 있던 것",
    "직관",
    "바뀐 것",
    "직접 만져보기",
    "퀴즈",
    "다음",
)

EXTERNAL_PATTERNS = (
    re.compile(r'<script[^>]+src\s*=\s*["\']https?://', re.IGNORECASE),
    re.compile(r'<link[^>]+href\s*=\s*["\']https?://', re.IGNORECASE),
    re.compile(r'<img[^>]+src\s*=\s*["\']https?://', re.IGNORECASE),
    re.compile(r'<iframe\b', re.IGNORECASE),
    re.compile(r'@import\s+url\s*\(\s*["\']?(?:https?://|//)', re.IGNORECASE),
    re.compile(r'\bfetch\s*\(', re.IGNORECASE),
    re.compile(r'\bXMLHttpRequest\b', re.IGNORECASE),
    re.compile(r'\bimportScripts\b', re.IGNORECASE),
    re.compile(r'<script[^>]+type\s*=\s*["\']module["\'][^>]+src\s*=', re.IGNORECASE),
)

BOX_DRAWING_RE = re.compile(r"[┌┐└┘├┤┬┴┼─│╔╗╚╝╠╣╦╩╬═║]")
ASCII_BOX_RE = re.compile(r"\+[-=]{3,}\+")

DATE_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-")

PRE_BLOCK_RE = re.compile(r"<pre[^>]*>.*?</pre>", re.DOTALL | re.IGNORECASE)
SCRIPT_BLOCK_RE = re.compile(r"<script[^>]*>.*?</script>", re.DOTALL | re.IGNORECASE)
STYLE_BLOCK_RE = re.compile(r"<style[^>]*>.*?</style>", re.DOTALL | re.IGNORECASE)
COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)

DATA_SRC_RE = re.compile(r'<pre[^>]+data-src\s*=\s*"([^"]+)"[^>]*>(.*?)</pre>', re.DOTALL | re.IGNORECASE)

QUIZ_Q_TAG_RE = re.compile(r'<div[^>]+class\s*=\s*"quiz-q"[^>]*data-answer\s*=\s*"(\d+)"[^>]*>', re.IGNORECASE)
OPT_RE = re.compile(r'<button[^>]+class\s*=\s*"opt"[^>]+data-i\s*=\s*"(\d+)"[^>]*>(.*?)</button>', re.DOTALL | re.IGNORECASE)
FB_RE = re.compile(r'<div[^>]+class\s*=\s*"fb"[^>]+data-i\s*=\s*"(\d+)"', re.IGNORECASE)

COLLAPSED_CODE_RE = re.compile(r"<details[^>]*>.*?<pre\b", re.DOTALL | re.IGNORECASE)

# Code-block attribution: <pre> tags that are NOT inside <script>/<style>
CONTENT_PRE_RE = re.compile(r"<pre\b[^>]*>", re.IGNORECASE)
CONTENT_PRE_WITH_SRC_RE = re.compile(r'<pre\b[^>]+data-src\s*=\s*"[^"]*"', re.IGNORECASE)


def _strip_code_blocks(html: str) -> str:
    """Remove <pre>, <script>, <style>, and HTML comments for prose-level checks."""
    text = PRE_BLOCK_RE.sub(" ", html)
    text = SCRIPT_BLOCK_RE.sub(" ", text)
    text = STYLE_BLOCK_RE.sub(" ", text)
    text = COMMENT_RE.sub(" ", text)
    return text


class Finding:
    def __init__(self, check: str, message: str, *, warn: bool = False):
        self.check = check
        self.message = message
        self.warn = warn

    def to_dict(self) -> dict:
        return {"check": self.check, "message": self.message, "level": "WARN" if self.warn else "FAIL"}


def verify(artifact_path: str, repo_dir: str | None = None) -> list[Finding]:
    findings: list[Finding] = []
    path = Path(artifact_path)

    # artifact-exists
    if not path.is_file():
        findings.append(Finding("artifact-exists", f"File not found: {artifact_path}"))
        return findings

    try:
        content = path.read_text(encoding="utf-8")
    except OSError as e:
        findings.append(Finding("artifact-exists", f"Cannot read file: {e}"))
        return findings

    # artifact-nonempty
    if len(content.encode("utf-8")) < 400:
        findings.append(Finding("artifact-nonempty", f"File is under 400 bytes ({len(content.encode('utf-8'))} bytes)"))

    # filename-dated
    if not DATE_PREFIX_RE.match(path.name):
        findings.append(Finding("filename-dated", f"Basename '{path.name}' does not start with YYYY-MM-DD-"))

    # outside-repo
    if repo_dir:
        repo_resolved = Path(repo_dir).resolve()
        artifact_resolved = path.resolve()
        try:
            artifact_resolved.relative_to(repo_resolved)
            findings.append(Finding("outside-repo", "Artifact is inside the repo worktree"))
        except ValueError:
            pass

    # self-contained
    for pattern in EXTERNAL_PATTERNS:
        match = pattern.search(content)
        if match:
            findings.append(Finding("self-contained", f"External resource reference: {match.group(0)[:80]}"))
            break

    # sections
    prose = _strip_code_blocks(content)
    for section in CANONICAL_SECTIONS:
        if section not in content:
            if section == "직접 만져보기":
                findings.append(Finding("sections", f"Missing section: {section} (micro-world may be omitted for structural changes)", warn=True))
            else:
                findings.append(Finding("sections", f"Missing required section: {section}"))

    # no-collapsed-code
    if COLLAPSED_CODE_RE.search(content):
        findings.append(Finding("no-collapsed-code", "Code block inside <details> — collapsed code blocks are not allowed"))

    # code-attribution
    stripped_for_pre = SCRIPT_BLOCK_RE.sub(" ", content)
    stripped_for_pre = STYLE_BLOCK_RE.sub(" ", stripped_for_pre)
    all_pres = CONTENT_PRE_RE.findall(stripped_for_pre)
    attributed_pres = CONTENT_PRE_WITH_SRC_RE.findall(stripped_for_pre)
    if all_pres and len(all_pres) != len(attributed_pres):
        findings.append(Finding(
            "code-attribution",
            f"Artifact has {len(all_pres)} code block(s), but only {len(attributed_pres)} carry a data-src attribution attribute",
        ))
    elif not all_pres:
        findings.append(Finding(
            "code-attribution",
            "Artifact has no code blocks — a code-change walkthrough normally quotes the code it explains",
            warn=True,
        ))

    # quotes-real
    if repo_dir:
        for match in DATA_SRC_RE.finditer(content):
            src_path = match.group(1)
            quoted_text = match.group(2)
            src_file = Path(repo_dir) / src_path
            if not src_file.is_file():
                findings.append(Finding("quotes-real", f"Quoted file does not exist: {src_path}"))
                continue
            try:
                file_content = src_file.read_text(encoding="utf-8")
            except OSError:
                findings.append(Finding("quotes-real", f"Cannot read quoted file: {src_path}"))
                continue
            # Strip HTML tags from quoted text for comparison
            quoted_lines = [
                line.strip()
                for line in re.sub(r"<[^>]+>", "", quoted_text).splitlines()
                if line.strip() and len(line.strip()) > 3
            ]
            if not quoted_lines:
                continue
            matched = sum(1 for line in quoted_lines if line in file_content)
            ratio = matched / len(quoted_lines) if quoted_lines else 1.0
            if ratio < 0.6:
                findings.append(Finding(
                    "quotes-real",
                    f"Phantom quote: <60% of lines from {src_path} found in file ({matched}/{len(quoted_lines)})",
                ))

    # paths-exist (WARN only)
    if repo_dir:
        code_paths = re.findall(r"<code>([^<]+)</code>", prose)
        for cp in code_paths:
            cp = cp.strip()
            if "/" in cp and not cp.startswith("http") and not cp.startswith("--") and len(cp) < 200:
                candidate = Path(repo_dir) / cp
                if not candidate.exists() and not any(c in cp for c in ("*", "?", "{", "}", "$", " ")):
                    findings.append(Finding("paths-exist", f"Path in <code> does not exist: {cp}", warn=True))

    # no-ascii-art (outside <pre> blocks)
    if BOX_DRAWING_RE.search(prose):
        findings.append(Finding("no-ascii-art", "Box-drawing characters found outside code blocks"))
    if ASCII_BOX_RE.search(prose):
        findings.append(Finding("no-ascii-art", "ASCII box pattern (+---+) found outside code blocks"))

    # quiz — split on quiz-q opening tags to get per-question HTML slices
    q_tags = list(QUIZ_Q_TAG_RE.finditer(content))
    q_blocks: list[tuple[int, str]] = []
    for idx, m in enumerate(q_tags):
        answer_idx = int(m.group(1))
        start = m.end()
        end = q_tags[idx + 1].start() if idx + 1 < len(q_tags) else len(content)
        q_blocks.append((answer_idx, content[start:end]))

    if len(q_tags) < 3:
        findings.append(Finding("quiz", f"Too few quiz questions: {len(q_tags)} (minimum 3)"))
    else:
        answers = []
        for answer_idx, q_html in q_blocks:
            opts = OPT_RE.findall(q_html)
            fbs = set(m for m in FB_RE.findall(q_html))

            if len(opts) < 3:
                findings.append(Finding("quiz", f"Quiz question has fewer than 3 options ({len(opts)})"))
            for opt_i, opt_text in opts:
                if opt_i not in fbs:
                    findings.append(Finding("quiz", f"Quiz option {opt_i} has no feedback element"))
            answers.append(answer_idx)

        # Positional tell: all answers in same position
        if len(set(answers)) == 1 and len(answers) >= 3:
            findings.append(Finding("quiz", f"Positional tell: all {len(answers)} answers in position {answers[0]}"))

        # 3 consecutive same-position answers
        for i in range(len(answers) - 2):
            if answers[i] == answers[i + 1] == answers[i + 2]:
                findings.append(Finding("quiz", f"3 consecutive answers in position {answers[i]} (questions {i + 1}-{i + 3})"))
                break

        # Length tell (WARN): >60% of questions have correct=longest option
        if q_blocks:
            longest_is_correct = 0
            for answer_idx, q_html in q_blocks:
                opts = OPT_RE.findall(q_html)
                if not opts:
                    continue
                lengths = [(int(i), len(text.strip())) for i, text in opts]
                max_len = max(l for _, l in lengths)
                longest_indices = [i for i, l in lengths if l == max_len]
                if answer_idx in longest_indices:
                    longest_is_correct += 1
            if len(q_blocks) > 0 and longest_is_correct / len(q_blocks) > 0.6:
                findings.append(Finding(
                    "quiz",
                    f"Length tell: {longest_is_correct}/{len(q_blocks)} questions have correct=longest option",
                    warn=True,
                ))

    return findings


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Verify a comprehend explainer artifact")
    parser.add_argument("artifact", help="Path to the HTML artifact file")
    parser.add_argument("--repo", default=None, help="Repository worktree root for path checks")
    parser.add_argument("--json", action="store_true", help="Output results as JSON")
    args = parser.parse_args()

    findings = verify(args.artifact, args.repo)
    fails = [f for f in findings if not f.warn]
    warns = [f for f in findings if f.warn]

    if args.json:
        result = {
            "artifact": args.artifact,
            "status": "FAIL" if fails else "PASS",
            "findings": [f.to_dict() for f in findings],
        }
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        for f in findings:
            level = "WARN" if f.warn else "FAIL"
            print(f"[{level}] {f.check}: {f.message}")
        if fails:
            print(f"\nRESULT: FAIL ({len(fails)} error(s), {len(warns)} warning(s))")
        else:
            print(f"\nRESULT: PASS ({len(warns)} warning(s))")

    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
