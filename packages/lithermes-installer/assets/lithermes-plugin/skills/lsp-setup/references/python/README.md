# Python — LSP setup (Hermes / LitHermes)

- **Recommended server:** `basedpyright-langserver --stdio`
- **Extensions:** `.py .pyi`
- **Install hint:** `pip install basedpyright`

## Install

- **macOS:** `pip install basedpyright` (or `uv tool install basedpyright`)
- **Linux:** `pip install basedpyright` (or `uv tool install basedpyright`)
- **Windows:** `pip install basedpyright`

Prefer `uv tool install basedpyright` when the project uses uv — it keeps the
server isolated from project venvs and always on PATH.

Confirm it resolves:

```bash
command -v basedpyright-langserver
```

## Configure

Hermes already ships Python support as the built-in `pyright` (Microsoft's type
checker, pointed at your project venv automatically): no config entry is needed
— install it with `hermes lsp install pyright` (or let Hermes auto-install it)
and confirm with `hermes lsp status`.

To run `basedpyright` instead (the default this reference recommends), declare
it as a **custom** server — Hermes has no `basedpyright` built-in — in the
Hermes config file (`~/.hermes/config.yaml`, or `$HERMES_HOME/config.yaml`)
under `lsp.servers`. Custom servers match before built-ins, so this entry takes
`.py`/`.pyi` over from `pyright`:

```yaml
lsp:
  servers:
    python:
      command: ["basedpyright-langserver", "--stdio"]
      extensions: [".py", ".pyi"]
```

Type-check strictness lives in `pyrightconfig.json` or `[tool.basedpyright]` in
`pyproject.toml`, not in the Hermes LSP config.

## Choosing a server

Type checkers and the linter serve different roles. Run a type server, and
optionally `ruff` ALONGSIDE it (not instead). Point the custom entry's
`command` at your choice (keep the `python` id and the `extensions` list so it
still claims `.py`/`.pyi`):

| command                              | install                | role                                    |
| ------------------------------------ | ---------------------- | --------------------------------------- |
| `["basedpyright-langserver", "--stdio"]` | `pip install basedpyright` | strictest types, **default**       |
| `["pyright-langserver", "--stdio"]`  | `pip install pyright`  | upstream Microsoft type checker         |
| `["ty", "server"]`                   | `pip install ty`       | Astral, very fast, pre-1.0/experimental |
| `["ruff", "server"]`                 | `pip install ruff`     | lint + format only, complements a type server |

Recommended: keep `basedpyright` as the `python` entry. `ruff` does not
type-check, so if you want lint diagnostics too run it as a separate tool rather
than replacing the type server.

## Troubleshooting
- **PATH:** `basedpyright-langserver` must be on PATH; reopen shell after install. `uv tool install` writes to `~/.local/bin`.
- **Wrong interpreter / missing imports:** the server must see the project venv. Set `python.pythonPath` / `venvPath` in `pyrightconfig.json`, or activate the venv before launching.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.py
# or: bun ../../scripts/verify-lsp.ts path/to/file.py
```
