# Ruby — LSP setup (Hermes / LitHermes)

- **Recommended server:** `rubocop --lsp`
- **Extensions:** `.rb .rake .gemspec .ru`
- **Install hint:** `gem install rubocop`

> **Note:** the executable invoked is **`rubocop`** (`rubocop --lsp`). RuboCop must be installed: `gem install rubocop`.

## Install

- **macOS:** `gem install rubocop`
- **Linux:** `gem install rubocop`
- **Windows:** `gem install rubocop`

In a Bundler project, prefer adding `rubocop` to the `Gemfile` and running via `bundle exec`.

Confirm it resolves (check `rubocop`, since that is what runs):

```bash
command -v rubocop
```

## Configure

Hermes has no built-in for Ruby, so declare a custom server in the Hermes
config file (`~/.hermes/config.yaml`, or `$HERMES_HOME/config.yaml`) under
`lsp.servers`:

```yaml
lsp:
  servers:
    ruby:
      command: ["rubocop", "--lsp"]
      extensions: [".rb", ".rake", ".gemspec", ".ru"]
```

Custom servers are never auto-installed: the binary must be on PATH (or give an
absolute path in `command`).

Behavior is driven by your `.rubocop.yml`; the server surfaces RuboCop diagnostics, formatting, and code actions over LSP.
## Alternatives

- **Shopify `ruby-lsp`** — the standalone `ruby-lsp` executable, richer navigation than RuboCop alone. Set the `command` to `["ruby-lsp"]`.
- **`solargraph`** — older completion/type server; install with `gem install solargraph`, set the `command` to `["solargraph", "stdio"]`.

## Troubleshooting

- **PATH:** `rubocop` on PATH (that is the invoked binary); reopen shell after install.
- **`rubocop` not found:** install RuboCop with `gem install rubocop`.
- **Bundler mismatch:** if the project pins RuboCop in its `Gemfile`, run inside the bundle so versions match.
- **No diagnostics:** check `.rubocop.yml` is valid and not disabling everything.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/file.rb
# or: bun ../../scripts/verify-lsp.ts path/to/file.rb
```
