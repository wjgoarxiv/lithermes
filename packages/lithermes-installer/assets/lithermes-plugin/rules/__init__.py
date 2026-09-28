"""LitHermes repo-rule engine.

Public surface consumed by core.py. Everything else in this package is internal.
"""

from __future__ import annotations

from .constants import (
    DEFAULT_MAX_RESULT_CHARS,
    DEFAULT_MAX_RULE_CHARS,
    DYNAMIC_MAX_RESULT_CHARS,
    DYNAMIC_MAX_RULE_CHARS,
    POST_COMPACT_MAX_RESULT_CHARS,
    POST_COMPACT_MAX_RULE_CHARS,
    SOURCE_PRIORITY,
)
from .discovery import find_candidates, find_project_root, path_bases
from .engine import (
    begin_session,
    consume_compaction_budget,
    dynamic_rules_block,
    end_session,
    history_was_compacted,
    load_rule,
    match_rule,
    sort_candidates,
    static_rules_block,
)
from .frontmatter import parse_rule
from .globmatch import DIVERGENCES, matches

__all__ = [
    "DEFAULT_MAX_RESULT_CHARS",
    "DEFAULT_MAX_RULE_CHARS",
    "DIVERGENCES",
    "DYNAMIC_MAX_RESULT_CHARS",
    "DYNAMIC_MAX_RULE_CHARS",
    "POST_COMPACT_MAX_RESULT_CHARS",
    "POST_COMPACT_MAX_RULE_CHARS",
    "SOURCE_PRIORITY",
    "begin_session",
    "consume_compaction_budget",
    "dynamic_rules_block",
    "end_session",
    "find_candidates",
    "find_project_root",
    "history_was_compacted",
    "load_rule",
    "match_rule",
    "matches",
    "parse_rule",
    "path_bases",
    "sort_candidates",
    "static_rules_block",
]
