r"""Hand-rolled glob matcher for rule `globs:` patterns. Standard library only.

Why hand-rolled: `fnmatch` gives `*`, `?`, and `[seq]` but has no `**` (it lets
`*` cross `/`, which silently over-matches) and no brace expansion. The reference
implementation uses picomatch, ~1,100 lines of JavaScript; vendoring it is not an
option here and would be LitHermes' first runtime dependency either way.

The supported grammar is therefore a deliberate SUBSET. Every known divergence
from `.cursor/rules` / picomatch semantics is listed in DIVERGENCES below and
pinned by tests in test/python/test_rules_globmatch.py. Do not describe this
matcher as picomatch-compatible.

Supported:
  `**`   whole-segment globstar: zero or more path segments
  `*`    zero or more characters within one segment (never crosses `/`)
  `?`    exactly one character within one segment
  `[abc]` `[a-z]` `[!abc]` `[^abc]`  character class, never matches `/`
  `{a,b}` brace alternation, nestable, expanded before compilation
  leading `!` negation (handled by the caller, not here)

There is NO backslash escape: `\` is normalized to `/` so Windows-style paths and
patterns match, exactly as the reference does. See D9.

Dotfiles match (`*` matches `.env`), mirroring the reference's `dot: true`.
Matching is case-sensitive and always performed on `/`-normalized paths.
"""

from __future__ import annotations

import re

# Reviewer-facing list. Each entry has a test with the same id.
DIVERGENCES = (
    (
        "D1-extglob",
        "picomatch runs with `bash: true`, which enables extglob — `?(a|b)`, `*(a|b)`, "
        "`+(a|b)`, `@(a|b)`, `!(a|b)`. This matcher does NOT implement extglob. "
        "`(`, `)` and `|` are literal characters, so `@(a|b).ts` matches a file "
        "literally named `@(a|b).ts` and nothing else.",
    ),
    (
        "D2-trailing-globstar-directory",
        "`src/**` matches paths BELOW `src/` but not the bare path `src`. Rules match "
        "file paths, so a directory-only match has no meaning here.",
    ),
    (
        "D3-partial-segment-globstar",
        "`**` is only a globstar when it is a whole segment. `a**b` degrades to `a*b` "
        "(single-segment), matching picomatch's behaviour for the same input.",
    ),
    (
        "D4-posix-classes",
        "POSIX bracket expressions such as `[[:alpha:]]` are not implemented and do "
        "NOT degrade gracefully. `[[:alpha:]].ts` compiles to the character class "
        "`[\\[:alpha]` followed by a literal `]`, so it matches `a].ts` and never "
        "`a.ts`. A rule using POSIX classes silently matches nothing useful; rewrite "
        "it as `[a-zA-Z]`.",
    ),
    (
        "D5-comma-separated-globs",
        "Cursor `.mdc` files commonly write `globs: *.ts,*.tsx` as one comma-separated "
        "scalar. The reference treats that as a single pattern containing a comma and "
        "therefore never matches. This engine splits a scalar on top-level commas "
        "(commas inside `{...}` are preserved). This is a DELIBERATE divergence from "
        "the reference, toward real Cursor files.",
    ),
    (
        "D6-case-sensitivity",
        "Always case-sensitive. picomatch exposes `nocase`; the reference does not set "
        "it, so behaviour agrees today, but this matcher has no way to opt out.",
    ),
    (
        "D7-no-negated-globstar-anchoring",
        "A negative pattern (`!x`) is matched against the same path bases as a "
        "positive one and simply vetoes the match. There is no per-directory "
        "re-inclusion (`!a/**` then `a/keep.ts`) as gitignore would do.",
    ),
    (
        "D8-brace-expansion-limit",
        "Brace expansion is textual and capped at MAX_BRACE_EXPANSIONS results; a "
        "pattern that would exceed the cap is compiled with its braces treated as "
        "literal characters rather than silently matching a truncated subset.",
    ),
    (
        "D9-no-backslash-escape",
        "There is no backslash escape. `\\` is normalized to `/` in both pattern and "
        "path so Windows-style input matches — the reference normalizes the same way, "
        "so `a\\*b` is the two-segment pattern `a/*b` in both, not a literal `a*b`. "
        "A rule that needs to match a filename containing `*` cannot express it.",
    ),
)

MAX_BRACE_EXPANSIONS = 1024
_MAX_PATTERN_CHARS = 4096
_COMPILED_CACHE = {}
_MAX_COMPILED_CACHE = 2048


def normalize_path(value) -> str:
    """Windows separators and redundant `./` prefixes are not matchable input."""
    text = str(value or "").replace("\\", "/")
    while text.startswith("./"):
        text = text[2:]
    return text


def split_pattern_scalar(value: str):
    """Split a scalar `globs:` value on top-level commas (see D5)."""
    parts = []
    current = []
    depth = 0
    escaped = False
    for char in str(value or ""):
        if escaped:
            current.append(char)
            escaped = False
            continue
        if char == "\\":
            current.append(char)
            escaped = True
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth = max(0, depth - 1)
        if char == "," and depth == 0:
            parts.append("".join(current))
            current = []
            continue
        current.append(char)
    parts.append("".join(current))
    return [part.strip() for part in parts if part.strip()]


def expand_braces(pattern: str):
    """Expand `{a,b}` textually before compilation. Returns brace-free patterns."""
    results = [pattern]
    for _ in range(MAX_BRACE_EXPANSIONS):
        pending = None
        for index, candidate in enumerate(results):
            span = _first_brace_span(candidate)
            if span is not None:
                pending = (index, candidate, span)
                break
        if pending is None:
            return results
        index, candidate, (start, end) = pending
        alternatives = _split_alternatives(candidate[start + 1:end])
        if len(alternatives) < 2:
            # `{a}` or `{}` — nothing to choose between; drop the braces.
            only = alternatives[0] if alternatives else ""
            results[index] = candidate[:start] + only + candidate[end + 1:]
            continue
        expanded = [candidate[:start] + alt + candidate[end + 1:] for alt in alternatives]
        if len(results) - 1 + len(expanded) > MAX_BRACE_EXPANSIONS:
            return None  # D8: caller falls back to literal braces
        results[index:index + 1] = expanded
    return None


def _first_brace_span(pattern: str):
    depth = 0
    start = -1
    escaped = False
    for index, char in enumerate(pattern):
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == "{":
            if depth == 0:
                start = index
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                return (start, index)
            if depth < 0:
                return None
    return None


def _split_alternatives(body: str):
    parts = []
    current = []
    depth = 0
    escaped = False
    for char in body:
        if escaped:
            current.append(char)
            escaped = False
            continue
        if char == "\\":
            current.append(char)
            escaped = True
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
        if char == "," and depth == 0:
            parts.append("".join(current))
            current = []
            continue
        current.append(char)
    parts.append("".join(current))
    return parts


def _segment_regex(segment: str) -> str:
    """Compile one path segment. `/` is never matchable inside a segment."""
    out = []
    index = 0
    length = len(segment)
    while index < length:
        char = segment[index]
        if char == "\\" and index + 1 < length:
            out.append(re.escape(segment[index + 1]))
            index += 2
            continue
        if char == "*":
            # D3: a run of stars inside a segment collapses to a single-segment star.
            while index < length and segment[index] == "*":
                index += 1
            out.append("[^/]*")
            continue
        if char == "?":
            out.append("[^/]")
            index += 1
            continue
        if char == "[":
            close = _closing_bracket(segment, index)
            if close == -1:
                out.append(re.escape("["))
                index += 1
                continue
            out.append(_class_regex(segment[index + 1:close]))
            index = close + 1
            continue
        out.append(re.escape(char))
        index += 1
    return "".join(out)


def _closing_bracket(segment: str, start: int) -> int:
    index = start + 1
    if index < len(segment) and segment[index] in "!^":
        index += 1
    if index < len(segment) and segment[index] == "]":
        index += 1
    while index < len(segment):
        if segment[index] == "]":
            return index
        index += 1
    return -1


def _class_regex(body: str) -> str:
    negated = body[:1] in ("!", "^")
    if negated:
        body = body[1:]
    if not body:
        return re.escape("[]")
    # Ranges (`a-z`) must survive, so `-` is never escaped; everything that can
    # terminate or re-open a class is.
    escaped = (
        body.replace("\\", "\\\\")
        .replace("^", "\\^")
        .replace("[", "\\[")
        .replace("]", "\\]")
    )
    # `/` must never be matched by a class, so it joins the negated set.
    return "[^/{0}]".format(escaped) if negated else "[{0}]".format(escaped)


def _compile_one(pattern: str):
    segments = pattern.split("/")
    parts = []
    for index, segment in enumerate(segments):
        last = index == len(segments) - 1
        if segment == "**":
            if not last:
                # Zero or more whole segments. The separator is part of this
                # group, so the generic `parts.append("/")` below is skipped.
                parts.append("(?:[^/]+/)*")
                continue
            if not parts:
                parts.append(".*")  # the whole pattern is `**`
            elif parts[-1] == "/":
                # D2: `src/**` needs at least one child segment, never bare `src`.
                parts[-1] = "/.+"
            else:
                # Follows another globstar (`**/**`): consume the rest, if any.
                parts.append(".*")
            continue
        parts.append(_segment_regex(segment))
        if not last:
            parts.append("/")
    return re.compile("^" + "".join(parts) + "$")


def compile_pattern(pattern: str):
    """Compile one glob to a list of regexes (one per brace expansion)."""
    normalized = normalize_path(pattern)
    if not normalized or len(normalized) > _MAX_PATTERN_CHARS:
        return []
    cached = _COMPILED_CACHE.get(normalized)
    if cached is not None:
        return cached
    expansions = expand_braces(normalized)
    if expansions is None:  # D8
        expansions = [normalized.replace("{", "\\{").replace("}", "\\}")]
    compiled = []
    for expansion in expansions:
        try:
            compiled.append(_compile_one(expansion))
        except re.error:
            continue
    if len(_COMPILED_CACHE) >= _MAX_COMPILED_CACHE:
        _COMPILED_CACHE.clear()
    _COMPILED_CACHE[normalized] = compiled
    return compiled


def matches(pattern: str, path: str) -> bool:
    """True when `path` (POSIX-normalized) satisfies `pattern`."""
    target = normalize_path(path)
    for regex in compile_pattern(pattern):
        if regex.match(target):
            return True
    return False
