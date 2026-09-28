"""Minimal YAML-frontmatter reader for rule files. Standard library only.

This parses the SUBSET the rules engine acts on — `description`, `alwaysApply`,
and `globs` (plus the Claude `paths` and Copilot `applyTo` aliases, normalized
into `globs`). It is not a YAML parser and must never be used as one: PyYAML is
an installer dependency, not a plugin-payload dependency, and the payload is
standard-library-only by contract.

Unparseable frontmatter is never fatal. The body is salvaged and a diagnostic is
attached, so a malformed rule degrades to "present but not glob-matched" instead
of taking the hook down.
"""

from __future__ import annotations

try:
    from .globmatch import split_pattern_scalar
except (ImportError, ModuleNotFoundError):
    from globmatch import split_pattern_scalar

_TRUE_SCALARS = frozenset({"true", "yes", "on", "1"})
_FALSE_SCALARS = frozenset({"false", "no", "off", "0"})
_GLOB_KEYS = ("globs", "paths", "applyto")


class ParsedRule(object):
    __slots__ = ("description", "always_apply", "globs", "body", "diagnostic")

    def __init__(self, description="", always_apply=False, globs=(), body="", diagnostic=""):
        self.description = description
        self.always_apply = always_apply
        self.globs = tuple(globs)
        self.body = body
        self.diagnostic = diagnostic


def _strip_bom(text: str) -> str:
    return text[1:] if text.startswith("\ufeff") else text


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value


def _strip_comment(value: str) -> str:
    """Drop a trailing ` # comment` outside quotes. Conservative by design."""
    quote = ""
    for index, char in enumerate(value):
        if quote:
            if char == quote:
                quote = ""
            continue
        if char in ("'", '"'):
            quote = char
            continue
        if char == "#" and (index == 0 or value[index - 1] in " \t"):
            return value[:index]
    return value


def split_frontmatter(content: str):
    """Return (frontmatter_text, body). No opening `---` means no frontmatter."""
    text = _strip_bom(content).replace("\r\n", "\n")
    if not text.startswith("---\n"):
        return "", text
    lines = text.split("\n")
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            return "\n".join(lines[1:index]), "\n".join(lines[index + 1:])
    # An unterminated fence is not frontmatter; treat the whole file as body.
    return "", text


def _parse_scalar_globs(raw: str):
    raw = _unquote(raw)
    if not raw:
        return []
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1]
        return [_unquote(item) for item in split_pattern_scalar(inner) if _unquote(item)]
    # D5: Cursor writes `globs: *.ts,*.tsx` as one comma-separated scalar.
    return [item for item in split_pattern_scalar(raw) if item]


def parse_rule(content: str) -> ParsedRule:
    frontmatter_text, body = split_frontmatter(content)
    if not frontmatter_text.strip():
        return ParsedRule(body=body)

    description = ""
    always_apply = False
    globs = []
    diagnostic = ""
    pending_list_key = ""

    for line in frontmatter_text.split("\n"):
        if not line.strip() or line.lstrip().startswith("#"):
            continue

        stripped = line.strip()
        if stripped.startswith("- ") and pending_list_key:
            item = _unquote(_strip_comment(stripped[2:]).strip())
            if item and pending_list_key in _GLOB_KEYS:
                globs.append(item)
            continue

        if ":" not in line:
            diagnostic = "unparsed frontmatter line (no key)"
            pending_list_key = ""
            continue

        key, _, raw = line.partition(":")
        key = key.strip().lower()
        raw = _strip_comment(raw).strip()
        pending_list_key = key if not raw else ""

        if key == "description":
            description = _unquote(raw)
        elif key == "alwaysapply":
            lowered = _unquote(raw).lower()
            if lowered in _TRUE_SCALARS:
                always_apply = True
            elif lowered in _FALSE_SCALARS:
                always_apply = False
            elif lowered:
                diagnostic = "alwaysApply is not a boolean"
        elif key in _GLOB_KEYS:
            if raw:
                globs.extend(_parse_scalar_globs(raw))

    # Order-preserving dedup: pattern order decides which one is reported as the
    # match reason, so a set would make the reported reason nondeterministic.
    seen = set()
    unique = []
    for pattern in globs:
        if pattern not in seen:
            seen.add(pattern)
            unique.append(pattern)

    return ParsedRule(
        description=description,
        always_apply=always_apply,
        globs=unique,
        body=body,
        diagnostic=diagnostic,
    )
