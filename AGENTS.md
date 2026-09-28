# AGENTS.md — LitHermes

Family-wide rules live in the umbrella `AGENTS.md` above this checkout. Read that first if you
started here; an agent launched inside this directory does not see it automatically.

This file covers only what differs in this repository.

## What this is

LitHermes — the **Hermes Agent** port of the lit workflow family. npm package `@litfamily/lithermes`.
A Node installer that ships a **Python plugin payload**. Git root is this directory, branch `main`.

**There is no `package.json` at this repository root.** The published package lives at
`packages/lithermes-installer/`, which is why every command below carries a `--prefix`.

## Entry points

| Surface | Path |
|---|---|
| Installer source | `packages/lithermes-installer/src/` |
| Python plugin payload | `packages/lithermes-installer/assets/lithermes-plugin/` |
| Routing / contexts | `assets/lithermes-plugin/core_routing.py`, `core_contexts.py` |
| Skills | `assets/lithermes-plugin/skills/<id>/SKILL.md` |
| Payload hash manifest | `assets/lithermes-plugin/payload-version.json` (generated) |

## Verification

```bash
npm --prefix packages/lithermes-installer test          # ~347 pass as of 2026-08-01
npm --prefix packages/lithermes-installer run test:python
npm --prefix packages/lithermes-installer run pack:dry
```

**Python tests must go through that runner.** A bare `python3 -m unittest` reports roughly
20 fake failures in `test_model_diagnostics.py`, because the runner resolves the interpreter
Hermes itself uses. Those failures are an artifact of the wrong interpreter, not real.

## Editing the payload

After changing anything under `packages/lithermes-installer/assets/lithermes-plugin/**`,
re-run the sync **last**, after all other edits:

```bash
node packages/lithermes-installer/scripts/sync-plugin.js --in-place
```

Otherwise the content-hashed `payload-version.json` goes stale. Note that this script always
bumps `syncedAt` even when nothing changed — check whether `sourceHash` actually moved before
committing the diff, and revert a timestamp-only change.

## Do not touch

- `# REFERENCE/` is a read-only archive (the name literally starts with `# `, so quote it in
  shell). It holds the legacy ancestor project, whose name is a forbidden token that must
  never appear in tracked files.
- Never pass `--home` to lithermes — it is silently ignored and writes the live profile.
- `HANDOFF.md` in this directory is **deprecated**. The authoritative handoff is
  `../HANDOFF.md` at the family root.

## Packaging

This directory is not an npm package root, so `AGENTS.md` here cannot be published.

Repository README artwork belongs under `docs/assets/`. The package `files`
allowlist ships runtime payload, bilingual entry READMEs, and the `readme-assets/`
folder used by the npm-rendered pages. Repository READMEs use `cover.svg`,
constructed from explicit vector geometry and outlined type. Package READMEs use
version-pinned jsDelivr URLs for every image, poster, or film link, and each
target file must be included in `readme-assets/` and the package tarball.
Historical cover bytes live in `packages/lithermes-installer/test/fixtures/legacy-cover.png`
for scanner regression tests; that fixture and release checklists stay out of npm.
Package README links to documents outside the tarball must be absolute URLs;
never rely on npm rewriting repository-relative links for the private source host.
Repository READMEs may keep relative artwork paths for GitHub rendering.
