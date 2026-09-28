# LitHermes Release Checklist

Version-specific factual-scope sections below document the current release. Historical changelog entries do not restore removed capabilities.


The scoped npm identity is published. Confirm the target version on the public registry before release.

Run from `packages/lithermes-installer` unless noted. Publishing is a manual,
explicitly-approved step. Do not auto-publish, tag, create releases, or bump
versions without direct user approval.

## 0. Clean-Room And No-Trace Gate

- [ ] Tracked files contain no denied provenance tokens, including short aliases
  and path fragments.
- [ ] Historical notes use neutral capability descriptions only.
- [ ] Stale tracked plans, evidence, run ledgers, and local state are removed or
  kept untracked.
- [ ] Scanner fixtures build denied strings from char codes, fragments, or opaque
  IDs; raw denied strings are never committed.

## 1. Version Surfaces (bump together only with approval)

- [ ] `packages/lithermes-installer/package.json` - `"version"`
- [ ] `packages/lithermes-installer/package-lock.json` - root and package `"version"`
- [ ] `packages/lithermes-installer/assets/lithermes-plugin/plugin.yaml` - `version:`
- [ ] `README.md` (repo root) - `@litfamily/lithermes@<version>`
- [ ] `README_Ko-KR.md` (repo root) - `@litfamily/lithermes@<version>`
- [ ] package English/Korean READMEs - `@litfamily/lithermes@<version>`
- [ ] shipped frontend/visual-QA install examples - plugin version and current
  bundled-skill count
- [ ] `packages/lithermes-installer/test/readme.test.js` - hardcoded version assertions
- [ ] `packages/lithermes-installer/test/prepublish-guard.test.js` and
  `test/release.test.js` - exact release-version fixtures
- [ ] shipped frontend/visual-QA complete-contract transcripts - current plugin version
- [ ] `CHANGELOG.md` - new `## [<version>]` entry

Note: `payload-version.json` is a source-sync manifest, not a product version.
Re-sync only if bundled plugin files changed.

### 1.0.11 factual release scope

This checklist covers the 1.0.11 release.

- [ ] The Jev last hint is kept per session in `jev-last-*.json`: `hermes lithermes status` and `doctor` inside a session name only that session's last hint, report `on — no session` outside any session, and each session's file is removed when the session ends; the files still hold no prompt text, key or response text and are never written through a symlink.
- [ ] The plugin loads on Python 3.12 or later without an invalid escape sequence `SyntaxWarning`.
- [ ] The README, package README and privacy notes describe the per-session last hint; the packed tarball stays under the 12 MiB cap.
- [ ] The version lockstep, full color-on Node suite, Python suite, both token scans, dry pack, and isolated real-surface QA gates pass.

### 1.0.3 factual release scope

This checklist covers the 1.0.3 release.

- [ ] The animated README cover includes a still image for reduced-motion preferences.
- [ ] Automatic skill review is removed because it never completed a review in practice. Leftover pending-review and skill-loop state files are inert and may be deleted without affecting other state.
- [ ] The catalog remains at 11 tools and 10 hooks.
- [ ] Publishing refuses when either test suite fails.
- [ ] Full Node, Python, lockstep, payload, scanner, and packed-install gates pass.

### 0.9.9 factual release scope

- [ ] Native command and natural-route prompts expose request-scoped `reader`,
  `technical`, and `audit` communication modes; `reader` is the default and
  filters routine execution metadata from parent and child synthesis.
- [ ] Evidence, ledgers, handoffs, status/debug output, and structured artifacts
  retain their detailed contracts. Natural-language compliance is documented as
  advisory because Hermes exposes no supported generated-response interceptor.
- [ ] Package, lockfile, plugin manifest, bundled contract transcripts, public
  package references, and exact-version fixtures all use `0.9.9`.
- [ ] Required regressions include the Full Node, Python, forbidden-token,
  payload-hash, dry-pack, isolated intrusion, and runtime-state exclusion gates.

### 0.9.8 factual release scope

- [ ] The installer exposes the approved provider choice and separate lead/child
  model routes, with the xAI key warning and fail-closed unsafe combinations.
- [ ] The bundled skins expose branding, flame spinner, logo, and light/dark
  palettes for all ten accents; `/agents` visibility is documented honestly and
  the SessionStart hint/nudge remains set-if-absent.
- [ ] Package, lockfile, plugin manifest, bundled contract transcripts, public
  package references, and exact-version fixtures all use `0.9.8`.
- [ ] Required regressions include the Full Node, Python, forbidden-token,
  payload-hash, dry-pack, isolated intrusion, and runtime-state exclusion gates.

This is a local release candidate only; no publish, tag, or push is performed.

### 0.9.2 factual release scope

- [ ] LitHermes documents `hermes curator adopt <name>` as an explicit handoff and
  does not schedule a second curator.
- [ ] This candidate remains stacked on the unpublished `0.9.1` candidate: publish
  `0.9.1` before `0.9.2`; neither version is published by candidate preparation.
- [ ] Package, lockfile, plugin manifest, bundled contract transcripts, public package
  references, and exact-version fixtures all use `0.9.2`.
- [ ] Required regressions include the Full Node, Python, forbidden-token, payload-hash,
  dry-pack, isolated intrusion, and runtime-state exclusion gates.

### 0.9.1 factual release scope

- [ ] The 54 bundled skill entrypoints declare a standalone output-channel
  `## #contract.output_channels` block, with `frontend-ui-ux` and `visual-qa`
  retaining their declarations in `references/complete-contract.md` for their
  bounded entrypoint contracts.
- [ ] The structural skill-port gate requires every declaration, restricts
  `artifact_genre` to the five supported values, and requires the matching
  `limitations_channel` for that genre.
- [ ] The Python deliverable hedge guard reads this machine-readable metadata,
  observes completed writes through `post_tool_call`, and reports findings through
  `pre_llm_call` on the next model turn because Hermes ignores observer-hook return
  values. Working notes remain non-blocking by genre.
- [ ] Release notes state the evidence boundary: two isolated A/B experiments found
  no measurable behavior change from the contract prose. They do not claim that
  prose makes model output cleaner; they claim only that the declaration drives the
  guard that flags hedged reader-facing writes.
- [ ] Package, lockfile, plugin manifest, bundled contract transcripts, public package
  references, and exact-version fixtures all use `0.9.1`.
- [ ] Required regressions include the Full Node, Python, forbidden-token,
  real-surface, and dry-pack gates before this candidate is considered reviewed.

### 0.8.49 factual release scope

- [ ] Candidate scope is limited to the approved product-version alignment; it adds no
  new runtime, installer, host-configuration, or publication behavior.
- [ ] Package, lockfile, plugin manifest, bundled contract transcripts, public package
  references, and exact-version fixtures all use `0.8.49`.
- [ ] Required regressions include the Full Node, Python, forbidden-token, real-surface,
  and dry-pack gates before this candidate is considered reviewed.

### 0.8.48 factual release scope

- [ ] Candidate scope identifies `frontend-ui-ux` with `litfamily.design-contract/v1beta2`
  as the canonical schema and `v1beta1` as compatibility input.
- [ ] Candidate scope identifies browser-drive capability measurement, external-driver
  identity checks, bounded process cleanup, and session/state blockers.
- [ ] Candidate scope identifies the verified Hermes `0.17.0` and `0.19.0` model,
  diagnostics, installer, and package-surface changes.
- [ ] Candidate scope identifies the approved lead `gpt-5.6-sol` / `xhigh` route,
  ordinary-worker `gpt-5.6-luna` / `max` global child route, and explicit
  unavailable reviewer, `litwork-reviewer`, and TUI route surfaces because Hermes
  exposes no per-subagent model override or TUI route visibility API.
- [ ] Required regressions cover complete and unterminated key-value-prefixed PEM
  redaction before handoff and scientific-visualization model routes, plus URI user
  information redaction.
- [ ] Required regressions cover browser-drive tools, nested HTTP URL arguments,
  indirect runtimes, base64 execution, and split or ambiguous shell assignments in
  command position, including quoted concatenation.
- [ ] Required regressions cover proposal-only observer persistence, forbidden-token
  scans, package version lockstep, payload sync through `payload-version.json`,
  `npm test`, `npm run test:python`, `npm run qa:real-surface`, and `npm run pack:dry`.

### 0.8.47 factual release scope

- [ ] Release notes identify the simplified English/Korean README surfaces and
  exact-version CDN asset links.
- [ ] Regression coverage proves the four package and plugin version surfaces
  remain aligned at `0.8.47`.

### 0.8.46 factual release scope

- [ ] Release notes identify the provider-free activation and cache measurement
  contracts and their packed/isolated-surface verification.
- [ ] Regression coverage proves the six-phase local speed contract without
  provider calls or completions.

### 0.8.45 factual release scope

- [ ] Release notes identify preserved managed-provider TERRA parent routes at `max`
  as safe for installation without claiming full TERRA runtime capability.
- [ ] Release notes identify effective inherited child-route safety checks and
  current-config capability output after write-boundary drift.
- [ ] Regression coverage proves TERRA/max preservation, inherited child effort
  blocking, and isolated installer/doctor behavior.

### 0.8.44 factual release scope

- [ ] Release notes identify the advisory evidence review guidance in the bundled
  `frontend-ui-ux` reference.
- [ ] Release notes identify the skill-port test coverage for the shipped guidance.

### 0.8.43 factual release scope

- [ ] Release notes identify the review-gated, product-local Wikify knowledge
  capture surface, its `pre_tool_call` hook, its
  `lithermes_knowledge_capture` tool, and its six structured event kinds.
- [ ] Release notes identify default-on capture, the command and environment
  opt-outs, `review-needed` initial state, explicit save/review transitions, and
  accepted-only relevant context injection with provenance and evidence.
- [ ] Release notes identify the 2048-byte normal and 4096-byte hard context
  budgets, no-match silence, rejected input classes, local POSIX write boundary,
  and no-network or external-service boundary.

### 0.8.42 factual release scope

- [ ] Release notes identify the first-interactive `pre_llm_call` automatic-update
  barrier, exact-version install, credential-free environment, and doctor/rollback receipt.
- [ ] Release notes identify the `--no-auto-update` and
  `LITHERMES_NO_AUTO_UPDATE=1` opt-outs and the cache-only detached notifier boundary.

### 0.8.41 factual release scope

- [ ] Release notes identify the new `output_styles.py` module and its fail-open
  contract (missing config, missing yaml, malformed YAML, unknown id → `""`).
- [ ] Release notes identify the three `config.js` functions:
  `readOutputStyleConfig`, `setOutputStyleConfig`, `clearOutputStyleConfig`.
- [ ] Release notes identify the `maybePickOutputStyle` installer prompt and its
  `--style` / `--no-style` flag surface.

### 0.8.40 factual release scope

- [ ] Release notes identify the managed model re-route from `gpt-5.6-sol` /
  `high` (parent) and `gpt-5.6-terra` / `high` (global child) to `gpt-5.6-luna` /
  `max` on both routes.
- [ ] Release notes identify that the Luna safety guard was re-aimed, not
  removed: Luna below `high` effort is still rejected without a silent fallback.

### 0.8.39 factual release scope

- [ ] Release notes identify the shared `/lit-plan` and `/start-work` column-zero
  implementation/final-verifier row grammar and fail-before-run validation.
- [ ] Release notes identify nested, fenced, and incidental checkbox exclusion and
  secret-redacted malformed-plan diagnostics.
- [ ] Release notes identify the two HUMAN-ONLY publication policies: the local
  source-only guard with npm repacking, and the stronger Linux descriptor-sealed
  exact-artifact workflow that requires `NPM_TOKEN`.

### 0.8.38 factual release scope

- [ ] Release notes identify the `lit-recap` source-precedence rule: when the durable
  ledger and the live session disagree, current session and repo facts take
  precedence, and the recap must surface the conflict and mark the ledger entry
  stale rather than presenting durable state as current.

### 0.8.37 factual release scope

- [ ] Release notes identify the `lit-comprehend` explainer skill: a bundled skill,
  its Python verifier, and the routing that reaches it, ported into the Hermes
  plugin payload without altering any existing workflow surface.
- [ ] Release notes identify the repo-local `AGENTS.md` guidance file, which is
  tracked but never packaged.

### 0.8.36 factual release scope

- [ ] Release notes identify the fallback-path plugin enablement fix: install now
  writes the `plugins: enabled:` config on unsupported-host model fallback paths
  while never writing model keys there, so fresh installs on newer Hermes hosts
  load the plugin.
- [ ] Release notes identify the commit-bound HUMAN-ONLY publish dispatch and the
  documentation/tests that pin it, without claiming any automated publish path.

### 0.8.35 factual release scope

- [ ] Release notes identify the pinned exact frontend corpus and its canonical
  manifest, scanner, doctor, and pack verification without claiming new runtime
  behavior beyond the bundled implementation.
- [ ] Release notes identify the Hermes-native `autoresearch`, `autoconference`,
  and `wikify` families, their 10/7/5 nested mode inventories, exact leading
  natural routes, and bounded safety boundaries.
- [ ] Release notes retain the implemented single-pass carrier, nested-mode hash,
  first-visible-token routing, scaffolder, and isolated-QA hardening.

## 2. Gates (all must pass)

- [ ] `npm test` - full JS + Python suite green
- [ ] CI/publish bootstrap pins `PyYAML==6.0.3` and `jsonschema==4.26.0` for a
  reproducible hosted gate. From the repo root, run
  `npm --prefix packages/lithermes-installer run test:python`; locally,
  `scripts/test-python.js` selects an interpreter where both PyYAML and jsonschema
  import successfully and does not enforce those exact versions. The gate uses
  isolated HOME/HERMES_HOME/cwd. Matplotlib and NumPy remain optional; scientific
  execution tests report explicit skips when unavailable.
- [ ] natural routing regression tests cover `lit`, `litwork`, `lit plan`,
  `lit review`, `lit research`, `lit goal`, BLOCKED `lit start work`, code
  spans/fences, slash-command mentions, and `/tmp/repo` / `/api/v1/users` path
  arguments
- [ ] `npm run qa:negative-matrix` exits 0 - replacement real-surface QA drives the
  shipped design-contract, evidence, review, tier, PNG, and TUI runtimes plus the
  installer CLI; every matrix row prints expected vs observed and no row is a
  mismatch. Rows the shipped runtime cannot produce print `BLOCKED` with their
  exact reason, are never counted as passes, and make the command exit nonzero.
- [ ] `npm run qa:behaviors` exits 0 - model-route safety, bounded-authority
  lifecycle, and prompt-injection/secret-redaction re-proved through the installer
  CLI and the installed plugin payload
- [ ] `npm run qa:negative-control` exits 0 - the matrix is re-run with one
  deliberately wrong expectation and must exit nonzero, proving the probe can fail
- [ ] every real-surface probe printed a cleanup receipt with `remaining=0`, and the
  negative-control self-check left its dedicated `TMPDIR` empty after the child exited
- [ ] both QA scripts replaced the process environment with isolated HOME and
  HERMES_HOME roots before probing, reported `isolated profile check: UNCHANGED`,
  restored the caller environment, and removed every isolated root
- [ ] the live Hermes profile must remain untouched. The QA evidence proves isolation,
  no mutation inside the isolated profile, and complete cleanup; it does not claim to
  fingerprint the live event log. Any separate live-profile observation requires its
  own explicitly authorized, read-only evidence.
- [ ] `node test/scripts/scan-forbidden-tokens.js --tracked` exits 0
- [ ] `node test/scripts/scan-forbidden-tokens.js --package-root` exits 0
- [ ] `npm run pack:dry` passes for the path projection, then an actual temporary
  `npm pack --ignore-scripts --json --pack-destination <temp>` artifact passes
  `node test/scripts/scan-forbidden-tokens.js --pack-tar <temp>/<filename>` so the
  canonical comparison is against produced tar bytes, not source paths alone
- [ ] pack output contains no `*.tgz`, `__pycache__`, `.pyc`, `.hermes/`, local
  agent-state dirs, `plans/`, `runs/`, `evidence/`, `state.json`,
  `ledger.jsonl`, or `notepad.md`
- [ ] manual QA replayed for changed runtime surfaces with terminal/http/plugin
  evidence captured
- [ ] Isolated Hermes 0.17.0 installs prove the configured lead
  `gpt-5.6-sol` / `xhigh` and global child route `gpt-5.6-luna` / `max`, hard
  `delegation.max_concurrent_children: 20`, and normal OpenAI OAuth Responses
  runtime delegation. Hermes has no per-task model override; Luna below high
  effort is rejected without silent fallback.
- [ ] Do not call the child route effective from config/install presence. Record
  it as configured until a real `delegate_task` execution receipt exposes the
  requested/effective child model and effort; otherwise close execution proof as N/A.
- [ ] Existing `delegation.provider`, `delegation.base_url`, or
  `delegation.api_mode` survives explicit reconfiguration byte-for-byte; the
  managed child route remains unapplied/unavailable and manual resolution is
  directed to `hermes model`.
- [ ] Async batch docs and runtime prompts require per-child re-entry receipts:
  the parent tracks and merges separate child messages and decides batch
  completion itself because Hermes exposes no combined wait.
- [ ] Doctor reports exact capability states: explicit verified reconfiguration
  reports hard 334800-token auto-compaction from `model.context_length: 372000`
  plus `compression.threshold: 0.90`; otherwise 650K remains unavailable because
  Hermes compression is ratio-only. Synchronous concurrency is hard, and malformed,
  unknown-schema, or credential-risk config falls back to `hermes model` with no
  write, no backup, and no scalar leakage.

## 3. Package Payload Readiness

- [ ] Real diff inspected: `git diff --stat` and changed-file list are known.
- [ ] Bundled plugin asset edits are followed by payload sync/hash refresh.
- [ ] `npm run pack:dry` output is captured, and an actual temporary tarball passes
  the descriptor-captured canonical byte comparison before the tarball is removed.
- [ ] No publish/version/tag/release command is run without explicit approval.

## 4. Ship Boundary

- [ ] Commit only if explicitly asked; keep it atomic and neutral.
- [ ] Push/open PR only if explicitly asked.
- [ ] STOP before any publish, tag, marketplace action, or release creation.
- [ ] Refresh `HANDOFF.md` only as local handoff state, not as a package payload.

### HUMAN-ONLY release path

Releases are published by hand from a maintainer machine; no CI workflow publishes. Publication requires explicit approval. Never log an npm token or OTP.

#### Local npm publish

- [ ] Run from `packages/lithermes-installer` with `clean main` aligned to `live origin/main`.
- [ ] Confirm `https://registry.npmjs.org/`, `npm whoami`, and a structured target-version `E404`
  from `npm view @litfamily/lithermes@1.0.11 version`.
- [ ] Run the full gates, both `scan-forbidden-tokens` modes, and `qa:real-surface`.
- [ ] Record explicit approval. The `prepublishOnly` source-only guard repeats the gates and records
  a SHA-256 digest for its inspected preflight tarball. It is **not byte-identical** to the published
  bytes because npm repacks the source directory afterward.

```sh
# HUMAN-ONLY — package root, prerequisites verified, explicit approval recorded
npm test
npm run test:python
node test/scripts/scan-forbidden-tokens.js --tracked
node test/scripts/scan-forbidden-tokens.js --package-root
npm run qa:real-surface
node scripts/prepublish-guard.js
npm publish --access public
```

After any nonzero result, query the exact registry version and **never blind-retry**. An `E404` means
stop and diagnose; an existing version may mean publication succeeded despite the local error. After
success, download and inspect the published artifact.

```sh
  npm view @litfamily/lithermes@1.0.11 version --json --registry=https://registry.npmjs.org/
VERIFY_DIR="$(mktemp -d)"
  npm pack @litfamily/lithermes@1.0.11 --pack-destination "$VERIFY_DIR" --registry=https://registry.npmjs.org/
  tar -tzf "$VERIFY_DIR/litfamily-lithermes-1.0.11.tgz"
  node test/scripts/scan-forbidden-tokens.js --pack-tar "$VERIFY_DIR/litfamily-lithermes-1.0.11.tgz"
rm -rf "$VERIFY_DIR"
```
