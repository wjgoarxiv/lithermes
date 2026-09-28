---
description: Shell expectations when Hermes runs on Windows under Git Bash.
alwaysApply: true
---

# Windows / Git Bash

This rule is bundled but only discovered when the host platform is Windows.

- Assume Git Bash, not PowerShell or `cmd.exe`. POSIX path separators and quoting
  apply; do not emit `%VAR%` or backtick-escaped PowerShell.
- Paths reaching tools may arrive as `C:\...`. Normalize to `/c/...` for shell
  commands and keep `/`-separated paths in any file you write.
- `&&` and `||` work; `;` between commands works. PowerShell-only builtins
  (`Get-ChildItem`, `Select-String`) do not exist here.
- Line endings: write LF. A tool that rewrites a file to CRLF creates a diff the
  user did not ask for.
