# Lua — LSP setup (Hermes / LitHermes)

- **Recommended server:** `lua-language-server`
- **Extensions:** `.lua`
- **Install hint:** `https://github.com/LuaLS/lua-language-server`

## Install

See `https://github.com/LuaLS/lua-language-server`.

- **macOS:** `brew install lua-language-server`
- **Linux:** download a release from GitHub, or `pacman -S lua-language-server` (Arch) / AUR
- **Windows:** download a release from the GitHub releases page and add its `bin` to PATH

Confirm it resolves:

```bash
command -v lua-language-server
```

## Configure

Hermes already ships this server as the built-in `lua-language-server`: no config entry is
needed. Install the binary from the Install section above (or run
`hermes lsp install lua-language-server` when Hermes offers an auto-install recipe for it),
then confirm Hermes sees it:

```bash
hermes lsp status
```

Only add an entry under `lsp.servers` in the Hermes config file
(`~/.hermes/config.yaml`, or `$HERMES_HOME/config.yaml`) to override the
default — a custom binary path, `disabled`, `env`, or
`initialization_options`. Built-in entries take no `extensions` key.

Deeper behavior (Neovim runtime libraries, the Lua runtime version, allowed globals) is configured through a project `.luarc.json` rather than the Hermes LSP config. For Neovim config work, a `.luarc.json` like the following resolves `vim` globals and the stdlib:

```json
{
  "runtime": { "version": "LuaJIT" },
  "workspace": { "library": ["/usr/share/nvim/runtime/lua"] },
  "diagnostics": { "globals": ["vim"] }
}
```
## Alternatives

None.

## Troubleshooting
- **PATH:** `lua-language-server` must be on PATH; reopen the shell after install.
- **Undefined `vim` global:** add `vim` to `diagnostics.globals` and set `workspace.library` in `.luarc.json` (see above) for Neovim work.
- **Wrong runtime version:** set `runtime.version` (`LuaJIT`, `Lua 5.4`, etc.) to match your interpreter, or stdlib functions report as undefined.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.lua
# or: bun ../../scripts/verify-lsp.ts path/to/file.lua
```
