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
npm --prefix packages/lithermes-installer run check:lock
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

## Skills lock

`packages/lithermes-installer/skills.lock.json` (tracked, not packed) holds per-skill size
budgets and the exact `npm pack --dry-run --json --ignore-scripts` file list. It sits beside
`payload-version.json`, which stays the authority for payload integrity. After a skill or
package-file change, `git add` any new file first (only tracked files are measured), then run:

```bash
npm --prefix packages/lithermes-installer run sync:lock    # check:lock is the read-only form
```

`policy` (the old per-skill SKILL.md floors, the 150000 B total and the 42789-word corpus floor)
and `budgets` are hand-owned; a sync never lowers or reseeds
them. A new skill needs `-- --accept-new <id>`, a removed one `-- --drop <id>`; otherwise the
sync writes nothing and exits 1, as it does when the pack would ship a file Git does not
track. Raise a budget by hand when a skill grows on purpose. Turning a
skill into a smaller stub means lowering its floor by hand in the same commit, with the reason.
The nine skills that moved to `wjgoarxiv-skills` on 2026-11-11 are such stubs: their budgets
are stub budgets set by hand (one file and at most 9000 B each; seven files and 120000 B for
`frontend-ui-ux`, which keeps the interface probe),
the lazy UI/UX cap went with their bodies, and both totals still clear their floors, so neither
floor was lowered. A stub that grows back past its budget fails `check:lock`.

## Do not touch

- `# REFERENCE/` is a read-only archive (the name literally starts with `# `, so quote it in
  shell). It holds the legacy ancestor project, whose name is a forbidden token that must
  never appear in tracked files.
- `lithermes` has no `--home` option and refuses it (older releases ignored it and wrote the live
  profile). Select a profile with `--hermes-home PATH`.
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
