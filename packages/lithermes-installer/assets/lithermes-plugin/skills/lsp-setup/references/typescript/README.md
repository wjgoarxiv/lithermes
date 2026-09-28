# TypeScript / JavaScript — LSP setup (Hermes / LitHermes)

- **Recommended server:** `typescript-language-server --stdio`
- **Extensions:** `.ts .tsx .js .jsx .mjs .cjs .mts .cts`
- **Install hint:** `npm install -g typescript-language-server typescript`

## Install

- **macOS:** `npm install -g typescript-language-server typescript`
- **Linux:** `npm install -g typescript-language-server typescript`
- **Windows:** `npm install -g typescript-language-server typescript` (PowerShell or cmd)

`typescript-language-server` is only a thin wrapper — it needs the `typescript`
package (`tsserver`) present too, either globally or in the project's
`node_modules`. Always install both.

Confirm it resolves:

```bash
command -v typescript-language-server
```

## Configure

Hermes declares language servers under `lsp.<language>`. Each entry
is keyed by language name and holds a `command` array plus an
`extensions` list. TypeScript/JavaScript already ships in the default
config:

```json
{
  "lsp": {
    "typescript": {
      "command": [
        "typescript-language-server",
        "--stdio"
      ],
      "extensions": [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs"
      ]
    }
  }
}
```

Add `.mts`/`.cts` to the `extensions` list if your project uses them. Hermes
resolves the server for an edited file by matching its extension against this
list.

## Alternatives

Swap the `command` for your toolchain. Keep the same Hermes LSP config shape and adjust
the `extensions` list to cover the extensions that server should own:

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
of the default, replace the `typescript` entry's `command` with `["deno", "lsp"]`.

## Troubleshooting
- **PATH:** `typescript-language-server` must be on PATH; reopen shell after `npm i -g`. Check your global bin with `npm bin -g`.
- **Missing tsserver:** errors like "Could not find tsserver" mean the `typescript` package is absent — install it globally or in the project.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.ts
# or: bun ../../scripts/verify-lsp.ts path/to/file.ts
```
