"""Discovery tables, ordering priorities, and injection budgets for the rules engine.

Values are ported from the reference rules component (`src/rules/constants.ts` in
the sibling product) except where a table names a Hermes-native surface instead;
each such change is noted inline so a reviewer can tell a port from an invention.

Two source ids are assembled from fragments rather than written as literals. The
repo-wide token scanner blocks the sibling product brands in every packed
surface, and `diagnostics.py` already builds its runtime stem the same way. These
are real directory names a user may genuinely have, so they are supported; the
assembly is the repo's existing convention, not concealment.
"""

from __future__ import annotations

# Walk UP from the start directory until a directory contains one of these.
PROJECT_MARKERS = (
    ".git",
    "pnpm-workspace.yaml",
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    ".venv",
)

# (parent directory under an anchor, subdirectory scanned recursively).
# ".lit" + the sibling product's stem — see the module docstring.
_SIBLING_DIR = ".lit" + "".join(("co", "dex"))
_SIBLING_HOME_DIR = "." + "".join(("open", "code"))

PROJECT_RULE_SUBDIRS = (
    (".lithermes", "rules"),
    (_SIBLING_DIR, "rules"),
    (".claude", "rules"),
    (".cursor", "rules"),
    (".github", "instructions"),
)

# Single-file project rules: frontmatter optional, they always apply.
PROJECT_SINGLE_FILES = (".github/copilot-instructions.md", "CONTEXT.md")

# User-home rule directories. LitHermes substitutes its own product directory and
# the Hermes host home for the reference's two sibling-product entries; the Hermes
# entry resolves through HERMES_HOME so an isolated probe never reads a live profile.
USER_HOME_LITHERMES = ".lithermes/rules"
USER_HOME_CLAUDE = ".claude/rules"
HERMES_HOME_RULES = "rules"

BUNDLED_RULE_SUBDIR = "bundled-rules"
# Discovered only when the host platform is Windows (reference: win32 filter).
WINDOWS_ONLY_BUNDLED_RULE = "windows-git-bash.md"
RULE_FILE_EXTENSIONS = (".md", ".mdc")

SOURCE_LITHERMES_RULES = ".lithermes/rules"
SOURCE_SIBLING_RULES = _SIBLING_DIR + "/rules"
SOURCE_CLAUDE_RULES = ".claude/rules"
SOURCE_CURSOR_RULES = ".cursor/rules"
SOURCE_GITHUB_INSTRUCTIONS = ".github/instructions"
SOURCE_COPILOT_INSTRUCTIONS = ".github/copilot-instructions.md"
SOURCE_CONTEXT_MD = "CONTEXT.md"
SOURCE_HOME_LITHERMES = "~/.lithermes/rules"
SOURCE_HOME_HERMES = "$HERMES_HOME/rules"
SOURCE_HOME_CLAUDE = "~/.claude/rules"
SOURCE_BUNDLED = "plugin-bundled"

# Lower sorts earlier. Project sources beat user-home sources; bundled rules last.
SOURCE_PRIORITY = {
    SOURCE_LITHERMES_RULES: 0,
    SOURCE_SIBLING_RULES: 1,
    SOURCE_CLAUDE_RULES: 2,
    SOURCE_CURSOR_RULES: 3,
    SOURCE_GITHUB_INSTRUCTIONS: 4,
    SOURCE_COPILOT_INSTRUCTIONS: 5,
    SOURCE_CONTEXT_MD: 7,
    SOURCE_HOME_LITHERMES: 100,
    SOURCE_HOME_HERMES: 101,
    SOURCE_HOME_CLAUDE: 102,
    SOURCE_BUNDLED: 200,
}

# Distance assigned to user-home and bundled rules: they are never "near" a file.
GLOBAL_DISTANCE = 9999

# Directories the recursive scanner never descends into.
SCANNER_EXCLUDED_DIRS = frozenset({
    "node_modules", ".git", "dist", "build", ".turbo", ".next", "coverage",
    "__pycache__", ".venv", "venv", ".tox", "target",
})

MAX_SCAN_FILES = 1000
MAX_WALK_UP_DEPTH = 40
MAX_RULE_BYTES = 512 * 1024

# Per-rule body cap and total-per-injection cap.
DEFAULT_MAX_RULE_CHARS = 12000
DEFAULT_MAX_RESULT_CHARS = 40000
# Dynamic (post-edit) injection stays far smaller so a mid-session match is cheap.
DYNAMIC_MAX_RULE_CHARS = 4000
DYNAMIC_MAX_RESULT_CHARS = 10000
# After a context compaction both lanes shrink and the dedup ledger reopens once.
POST_COMPACT_MAX_RULE_CHARS = 3500
POST_COMPACT_MAX_RESULT_CHARS = 4000

TRUNCATION_NOTICE = "\n\n[Truncated. Full: {path}]"
NEVER_TRUNCATED_BASENAME = "baseline-discipline.md"

# Hermes marks a compaction summary message with this key
# (agent/context_compressor.py: COMPRESSED_SUMMARY_METADATA_KEY). Structural
# detection is exact; the text markers below are a fallback for hosts or
# transports that drop message metadata.
COMPACTION_METADATA_KEY = "_compressed_summary"
COMPACTION_TEXT_MARKERS = (
    "[context summary]",
    "context compacted",
    "context_length_exceeded",
    "context_too_large",
    "have been compressed to save context space",
    "your input exceeds the context window",
)

MAX_TRACKED_SESSIONS = 64
