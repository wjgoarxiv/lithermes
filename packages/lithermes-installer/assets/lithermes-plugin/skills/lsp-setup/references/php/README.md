# PHP — LSP setup (Hermes / LitHermes)

- **Recommended server:** `intelephense --stdio`
- **Extensions:** `.php`
- **Install hint:** `npm install -g intelephense`

## Install

Intelephense is a Node package, so Node.js (and npm) must be installed first.

- **macOS:** `npm install -g intelephense`
- **Linux:** `npm install -g intelephense`
- **Windows:** `npm install -g intelephense`

Confirm it resolves:

```bash
command -v intelephense
```

## Configure

Hermes already ships this server as the built-in `intelephense`: no config entry is
needed. Install the binary from the Install section above (or run
`hermes lsp install intelephense` when Hermes offers an auto-install recipe for it),
then confirm Hermes sees it:

```bash
hermes lsp status
```

Only add an entry under `lsp.servers` in the Hermes config file
(`~/.hermes/config.yaml`, or `$HERMES_HOME/config.yaml`) to override the
default — a custom binary path, `disabled`, `env`, or
`initialization_options`. Built-in entries take no `extensions` key.

Intelephense's premium features (rename, find-all-implementations, etc.) require a licence key, which is passed through the editor's LSP `initializationOptions` rather than the Hermes LSP config. Without a key the server runs fine in free mode.
## Alternatives

**phpactor** — pure-PHP, no Node dependency. Set the `command` to
`["phpactor", "language-server"]`.

## Troubleshooting
- **PATH:** `intelephense` must be on PATH; reopen the shell after a global npm install. If missing, check `npm bin -g` is on PATH.
- **No Node:** Intelephense fails to start without Node.js. Install Node, then reinstall.
- **Wrong PHP version inference:** set `intelephense.environment.phpVersion` (via your editor's init options) to match your project.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.php
# or: bun ../../scripts/verify-lsp.ts path/to/file.php
```
