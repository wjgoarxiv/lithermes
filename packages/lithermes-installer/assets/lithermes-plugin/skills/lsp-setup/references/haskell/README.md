# Haskell — LSP setup (Hermes / LitHermes)

- **Recommended server:** `haskell-language-server-wrapper --lsp`
- **Extensions:** `.hs .lhs`
- **Install hint:** `ghcup install hls`

The `-wrapper` binary detects your project's GHC version and dispatches to the matching HLS build.

## Install

- **macOS:** `ghcup install hls` (install ghcup via `brew install ghcup` or the official script)
- **Linux:** `ghcup install hls` (ghcup script from https://www.haskell.org/ghcup/)
- **Windows:** `ghcup install hls` (ghcup is installed via the Windows installer / PowerShell bootstrap)

HLS needs a working GHC plus Cabal and/or Stack. Install a matching toolchain first:

```bash
ghcup install ghc
ghcup install cabal
```

Confirm it resolves:

```bash
command -v haskell-language-server-wrapper
```

## Configure

Hermes already ships this server as the built-in `haskell-language-server`: no config entry is
needed. Install the binary from the Install section above (or run
`hermes lsp install haskell-language-server` when Hermes offers an auto-install recipe for it),
then confirm Hermes sees it:

```bash
hermes lsp status
```

Only add an entry under `lsp.servers` in the Hermes config file
(`~/.hermes/config.yaml`, or `$HERMES_HOME/config.yaml`) to override the
default — a custom binary path, `disabled`, `env`, or
`initialization_options`. Built-in entries take no `extensions` key.

Per-project plugin/formatter settings normally live in a `hie.yaml` (cradle) and `.haskell-language-server` files rather than the Hermes LSP config.
## Alternatives

- `ghcide` (the core HLS engine, standalone) — largely superseded by HLS.
- `hlint` standalone for lint-only checks; `ormolu`/`fourmolu` for formatting.

## Troubleshooting
- **PATH:** `haskell-language-server-wrapper` on PATH; reopen shell after `ghcup install`.
- **GHC mismatch:** the installed HLS must support your project's GHC version — run `ghcup install hls` for that GHC, or align GHC to a supported one.
- **No cradle:** multi-package repos may need a `hie.yaml`; generate one with `gen-hie > hie.yaml`.
- **Slow first load:** HLS compiles dependencies on first open; let it finish indexing.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.hs
# or: bun ../../scripts/verify-lsp.ts path/to/file.hs
```
