# C# — LSP setup (Hermes / LitHermes)

- **Recommended server:** `csharp-ls`
- **Extensions:** `.cs`
- **Install hint:** `dotnet tool install -g csharp-ls`

## Install

Requires the **.NET SDK**. Install the tool globally:

- **macOS:** `dotnet tool install -g csharp-ls`
- **Linux:** `dotnet tool install -g csharp-ls`
- **Windows:** `dotnet tool install -g csharp-ls`

Global .NET tools land in `~/.dotnet/tools` — ensure that directory is on PATH (Windows: `%USERPROFILE%\.dotnet\tools`).

Confirm it resolves:

```bash
command -v csharp-ls
```

## Configure

Hermes has no built-in for C#, so declare a custom server in the Hermes config
file (`~/.hermes/config.yaml`, or `$HERMES_HOME/config.yaml`) under
`lsp.servers`:

```yaml
lsp:
  servers:
    csharp:
      command: ["csharp-ls"]
      extensions: [".cs"]
```

Custom servers are never auto-installed: `csharp-ls` must be on PATH (see the
Install section). `csharp-ls` picks up the nearest `.sln` or `.csproj`; keep
the solution restorable (`dotnet restore`).

## Razor / Blazor

Razor and Blazor files use a separate server. Hermes has no built-in for it
either — add a second custom entry under `lsp.servers` (custom servers are
never auto-installed: `roslyn-language-server` must be on PATH):

```yaml
lsp:
  servers:
    razor:
      command: ["roslyn-language-server", "--stdio"]
      extensions: [".razor", ".cshtml"]
```

Install it (requires **v5.8.0+**; see [dotnet/razor](https://github.com/dotnet/razor)):

```bash
dotnet tool install -g roslyn-language-server --prerelease
command -v roslyn-language-server
```

## Alternatives

**OmniSharp** — legacy C# language server. Still works but is being superseded by
the Roslyn-based servers; prefer `csharp-ls` / `roslyn-language-server`.

## Troubleshooting

- **PATH:** `csharp-ls` / `roslyn-language-server` on PATH (`~/.dotnet/tools`); reopen shell after install.
- **No .NET SDK:** install the SDK (not just the runtime) before installing the tool.
- **No symbols:** run `dotnet restore`; an unrestored solution yields empty results.
- **Razor needs v5.8.0+:** older `roslyn-language-server` builds lack the `--stdio` Razor support — install with `--prerelease`.

## Verify

```bash
node --experimental-strip-types ../../scripts/verify-lsp.ts path/to/File.cs
# or: bun ../../scripts/verify-lsp.ts path/to/File.cs
```
