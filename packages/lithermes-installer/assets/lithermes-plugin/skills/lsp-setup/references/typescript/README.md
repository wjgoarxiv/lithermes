# TypeScript / JavaScript — LSP setup (Hermes / LitHermes)

- **Recommended server:** `typescript-language-server --stdio`
- **Extensions:** `.ts .tsx .js .jsx .mjs .cjs .mts .cts`
- **Install hint:** `npm install -g typescript-language-server typescript@6`

## Install

- **macOS:** `npm install -g typescript-language-server typescript@6`
- **Linux:** `npm install -g typescript-language-server typescript@6`
- **Windows:** `npm install -g typescript-language-server typescript@6` (PowerShell or cmd)

`typescript-language-server` is only a thin wrapper — it needs the `typescript`
package (`tsserver`) present too, either globally or in the project's
`node_modules`. Always install both. Pin `typescript@6`: TypeScript 7 (the Go
port) ships no `lib/tsserver.js`, which `typescript-language-server` loads.

Confirm it resolves:

```bash
command -v typescript-language-server
```

## Configure

Hermes already ships TypeScript/JavaScript support as the built-in
`typescript`: no config entry is needed, and Hermes already covers `.ts .tsx
.js .jsx .mjs .cjs .mts .cts`. Hermes auto-installs the server on first use
(its recipe pins `typescript@6`); a manual global install is optional and must
pin the same line (see the Install section). Confirm Hermes sees it:

```bash
hermes lsp status
```

Only add an entry under `lsp.servers` in the Hermes config file
(`~/.hermes/config.yaml`, or `$HERMES_HOME/config.yaml`) to override the
default — a custom binary path, `disabled`, `env`, or
`initialization_options`. Built-in entries take no `extensions` key.

## Alternatives

Swap the `command` for your toolchain with an override under
`lsp.servers.typescript` (built-in entries take no `extensions` key):

| command                                   | when to choose                          |
| ----------------------------------------- | --------------------------------------- |
| `["deno", "lsp"]`                         | Deno projects (handles `.ts/.tsx/.js`)  |
| `["biome", "lsp-proxy", "--stdio"]`       | Biome lint/format as the LSP            |
| `["vscode-eslint-language-server", "--stdio"]` | ESLint diagnostics                 |
| `["oxlint", "--lsp"]`                     | fast Oxc-based linting                  |
| `["vue-language-server", "--stdio"]`      | `.vue` single-file components           |
| `["svelteserver", "--stdio"]`             | `.svelte` files                         |
| `["astro-ls", "--stdio"]`                 | `.astro` files                          |

`eslint` install: `npm i -g vscode-langservers-extracted`. To run Deno instead
of the default, set `command: ["deno", "lsp"]` on the `lsp.servers.typescript`
override.

## Troubleshooting
- **PATH:** `typescript-language-server` must be on PATH; reopen shell after `npm i -g`. Check your global bin with `npm bin -g`.
- **Missing tsserver:** errors like "Could not find tsserver" mean the `typescript` package is absent — install it globally or in the project.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.ts
# or: bun ../../scripts/verify-lsp.ts path/to/file.ts
```
