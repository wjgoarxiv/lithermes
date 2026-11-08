# Bash — LSP setup (Hermes / LitHermes)

- **Recommended server:** `bash-language-server start`
- **Extensions:** `.sh .bash .zsh .ksh`
- **Install hint:** `npm install -g bash-language-server`

## Install

- **macOS:** `npm install -g bash-language-server`
- **Linux:** `npm install -g bash-language-server`
- **Windows:** `npm install -g bash-language-server` (PowerShell)

For real diagnostics, also install `shellcheck`:

- **macOS:** `brew install shellcheck`
- **Linux:** `apt install shellcheck` (or `dnf install ShellCheck`)
- **Windows:** `scoop install shellcheck`

Confirm it resolves:

```bash
command -v bash-language-server
command -v shellcheck
```

## Configure

Hermes already ships this server as the built-in `bash-language-server`: no config entry is
needed. Install the binary from the Install section above (or run
`hermes lsp install bash-language-server` when Hermes offers an auto-install recipe for it),
then confirm Hermes sees it:

```bash
hermes lsp status
```

Only add an entry under `lsp.servers` in the Hermes config file
(`~/.hermes/config.yaml`, or `$HERMES_HOME/config.yaml`) to override the
default — a custom binary path, `disabled`, `env`, or
`initialization_options`. Built-in entries take no `extensions` key.

`bash-language-server` delegates diagnostics to `shellcheck`: without it on PATH the server runs but reports nothing, so install `shellcheck` as well. To point at a non-PATH binary, export `SHELLCHECK_PATH` in the launching shell.
## Alternatives

- `shellcheck` standalone as a linter-only flow (no LSP).
- `shfmt` for formatting (complements, does not replace, the LSP).

## Troubleshooting
- **PATH:** `bash-language-server` on PATH; reopen shell after `npm -g` install.
- **No diagnostics:** `shellcheck` missing — diagnostics are powered by it; install and reopen.
- **Wrong shell dialect:** `.zsh`/`.ksh` are linted as bash; shellcheck may flag shell-specific syntax.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.sh
# or: bun ../../scripts/verify-lsp.ts path/to/file.sh
```
