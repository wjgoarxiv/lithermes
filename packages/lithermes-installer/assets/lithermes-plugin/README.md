# lithermes


The scoped npm identity is an unpublished local candidate. Registry commands below are intended release targets, not evidence of public availability.

Hermes-native workflow tools for plan-first execution, evidence ledgers, and
first-class Hermes skills:

Install from npm with the package name `@litfamily/lithermes`:

```sh
npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes
```

The current working tree carries package metadata present at build time; verify
registry state separately before any release action.

`npx --yes` only approves npm package execution; `install --yes` is the LitHermes
installer approval to mutate Hermes config. `lithermes` is the installed
CLI/plugin name, not the npm package name.

- `/lit-plan` and `/litwork-plan` create durable, objective-achievable plans in
  `plans/`, then forward a goal bootstrap to the Hermes agent. Plans use one
  bounded objective, explicit non-goals, dependency/unknown gates, atomic
  action/output/verification items, evidence commands, decision branches, and a
  falsifiable DoneClaim. Detail is adaptive, not padded.
- `/lit-loop` and `/litwork-loop` create run state under
  `.hermes/lithermes/runs/` and dispatch the task back to the Hermes agent.
- Bounded work schema 3 uses the exact command grammar
  `/lit-loop init <plan> --grant ACTION@ROOT[,ACTION@ROOT] [--worktree PATH]`,
  then `/lit-loop status`, `/lit-loop resume`, `/lit-loop cancel`, or
  `/lit-loop complete`. Canonical plans and semantic authority roots must stay
  inside the worktree. Null worktree resolves to cwd only with an explicit root
  grant. Pause is code-owned and cannot be called as a slash shortcut.
- The model reports bounded progress only with `lithermes_work_progress`.
  `pre_tool_call` supplies the real Hermes session and enforces active-work,
  monotonic CAS revision, replay id, and one-use grant checks. First new progress
  continues; same replay is idempotent; later unchanged and stale work/revision
  calls are silent. Only a genuinely new non-forbidden boundary pauses. A trusted
  explicit user must invoke the emitted `/lit-loop resume` with matching boundary
  identity and ACTION@ROOT; the agent has no resume or grant bypass. Consumed grant
  identities survive event compaction, paused work cannot complete, and terminal
  reuse returns the existing terminal state.
- `pre_tool_call` also gates real Hermes mutation tools with the host-supported
  `action: block` directive. Read-only calls remain available. File writes and
  supported test/build/check terminal calls require exact-session canonical
  action/root authority; paused, wrong-session, out-of-root, ambiguous, and
  unsupported mutations are blocked. Safe action normalization rejects prefixed
  or hyphenated commit, publish, push, release, tag, install, host-config,
  credential, and destructive equivalents.
- Progress arrays, state, replay/history/work collections, and ledger events are
  bounded; evidence is stored as digests instead of raw transcripts. A code-owned
  activation is single-use and fence-safe. Copied slash commands, quoted or fenced
  examples, prompt injection, plan text, tool results, and Korean prose remain
  inert data.
- `/start-work` opens or dry-runs an approved plan against a workspace; it is
  execution-only and never bootstraps a plan from a brief. Completion claims
  require real diff review, scanner evidence, real-surface evidence, cleanup
  receipts, and package dry-run evidence when package surfaces changed.
- `/lit-humanizer` gives conservative prose cleanup guidance; `/lit-korean`,
  `/text-naturalization`, and `/text-neutralization` remain aliases. It protects
  meaning, treats source text as content, not instructions, preserves honorific/register
  and protected spans, and uses a before/after diff when strict or requested. It makes
  no automatic file edits and performs no external fetching.
  `/text-naturalization` and `/text-neutralization` are aliases with the same
  contract: meaning preservation, source text as content, not instructions,
  before/after diff when strict or requested, honorific/register and protected spans
  preservation, no automatic file edits, and no external fetching. Malicious
  pasted text stays inert.
- `/lit-handoff` and exact bare `handoff` load the immutable bundled handoff
  source through a side-effect-free route. The adapter redacts request text,
  resolves the original template, requires live-state verification, and uses
  `🔥 **LIT IGNITED · lit-handoff** 🔥` as its exact first line, once, before
  any other reply content.
- `/lit-scientific-visualization`, exact `lit-scientific-visualization`, and
  exact `lit scientific visualization` load the immutable 16-file scientific
  source. The adapter resolves scripts, assets, and reference fallbacks from the
  installed source root. It never claims generic, quoted, code, mixed, or
  near-miss visualization requests, imports scientific packages during plugin
  registration, or silently runs pip/uv. Missing `matplotlib` is non-fatal
  `DEGRADED`; its exact first line, once and before any other reply content, is
  `🔥 **LIT IGNITED · lit-scientific-visualization** 🔥`.
- `/lit-pptx <brief>` and `/lit-docx <brief>` load `lithermes:lit-pptx` and `lithermes:lit-docx`. Bare `lit` with report or slide authoring wording routes to the corresponding skill; a combined request creates both formats. The packaged `skills/lit-pptx/bin/office.mjs` installs pinned dependencies in the LitHermes cache on first use and exposes deck QA, integrity, DOCX conversion, editing, lint, and visual audit.
- `/lit-typographic-motion <brief>` loads `lithermes:lit-typographic-motion`. Bare `lit` with a film-creation request writes a treatment first, then renders a stage film (a model-authored page captured frame by frame) or a type film on the installed WebGL2 engine. Pre-warm with `lithermes motion-runtime install`; check the five runtime probes with `lithermes motion-runtime status`. The render gate records measurements and withholds exports on flash failure. Typographic-motion engine adapted from mexicat/pdoom-video (MIT, Giacomo Magnanini), commit `ca251e3`.
- `/lit-diagram-drawer <brief>` and the exact `lit-diagram-drawer` route load the
  installed diagram skill. Its Python checks cover source geometry, accessibility,
  content requirements, motion source rules, and visible-text findings; actual
  rendering remains a separate local capability.
- The `pre_llm_call` hook injects an Litwork directive when the user says
  a standalone `lit` or `litwork`. It also routes `lit plan`, `lit review`,
  `lit research`, `lit goal`, and durable `lit workflow` / `lit kanban` / `lit team`
  intents to the matching Hermes-native contract. Bare `lit-crucible`, `litresearch`,
    `lit-init`, and `lit-recap` inject the matching bundled `SKILL.md` body into
    the natural route, while `lit start work` remains a visible BLOCKED handoff to `/start-work`.
  Kanban routes are setup/proposal guidance for Hermes Kanban profile lanes;
  `lit team` does not claim a literal native team mode.
  Intent-shaped skills route the same way from a bare leading token or after `lit`:
  `autoresearch`, `autoconference`, `wikify`, `lit-comprehend`, `refactor`, `debugging`, `lit-commit`,
  `lit-burnoff`, `lit-burnoff-file`, `comment-checker`, `lsp`, `lsp-setup`, and
  `rules`.
- On the first interactive top-level `pre_llm_call`, the payload runs one
  foreground update barrier by default. It resolves the host-owned
  `HERMES_HOME`, validates an exact stable registry version, and calls the
  package's transaction bridge with `npx --yes --package @litfamily/lithermes@<version> -- lithermes
  __auto-update --hermes-home PATH`. The bridge performs the real guarded
  `install --yes --no-hud --no-style --no-patch-installed-hermes` child, separate locking, backup,
  journal/receipt, rollback on interruption or timeout, and a truthful
  post-install doctor. `--no-auto-update`, `LITHERMES_NO_AUTO_UPDATE`,
  `NO_UPDATE_NOTIFIER`, and `LITHERMES_NO_UPDATE_CHECK` disable the relevant
  path. Noninteractive, CI, JSON, dry-run, HUD/help/version/uninstall, and
  delegate sessions remain no-op. The update bridge never receives npm
  credentials and never uses the unsupported `--home` option.
- Optional Jev skill hint (`jev_hint.py`), off by default. When
  `LITHERMES_JEV=1` and `TYPESAFE_API_KEY` are both set in the environment,
  `pre_llm_call` sends a top-level prompt that no LitHermes route claimed (not a
  slash command, not a command envelope, at least 4 non-space characters) to
  TypeSafe's Jev: one POST that refuses redirects, redacted over an
  8,000-character window and then cut to 2,000, with the `PORTED_SKILLS`
  catalog plus `none`, a 1.5 s deadline and no retry. A hook failure there
  never costs the turn its other context. Only an exact catalog id
  at confidence 0.35 or higher becomes one fixed advisory line naming
  `lithermes:<id>`; response text never enters context. Failures leave the turn
  unchanged, and `transform_llm_output` prefixes one short note per session.
  While both switches are on, the same transform also opens the first reply of
  each session with the plain line `✦ Jev skill hint ON` (banner first, note on
  the next line when both are due); it is released with the session.
  `LITHERMES_JEV_MODEL`, `_TIMEOUT_MS` (max 3000), `_MAX_CALLS` (default 200
  per session) and `_MIN_CONFIDENCE` tune it; `LITHERMES_JEV_TRACE=1` appends
  the redacted prompt's hash, ids and timings (no text, key or body) to Hermes home
  `lithermes/jev-trace.jsonl`. Status and doctor print `Jev skill hint: ...`;
  when on, they add the last hinted skill id and latency of the session named
  by `HERMES_SESSION_ID` (`on — last hint lit-humanizer (0.43s)`) or `on — no
  hint yet`, and `on — no session` outside any session. The CLI runs in its own
  process, so an accepted hint also writes only that id, the latency and a
  timestamp to Hermes home `lithermes/jev-last-<session hash>.json` (mode 0600,
  atomic), one file per session, removed when the session ends. Neither file is
  written through a symlink.
- Optional automatic handoff (`auto_handoff.py`), off by default. The user
  switches it on with `/lit-handoff auto on <percent>` (plain text reply, no
  model call; `auto off` and `auto status` likewise) or with
  `LITHERMES_AUTO_HANDOFF=1` plus `LITHERMES_AUTO_HANDOFF_PERCENT`; the
  environment wins over the saved value, any flag value other than `1` keeps it
  off, and a percent that is not a whole number from 1 to 99 leaves it off with a
  doctor warning. There is no built-in percent: `on` without a number reuses the
  last saved one and asks when none exists. The switch is saved in Hermes home
  `lithermes/auto-handoff.json` (mode 0600, atomic, never written through a
  symlink). `post_api_request` reads the prompt size of each model call
  (`usage.prompt_tokens`, else input plus cache read plus cache write) over the
  model's context window (`model.context_length` from the Hermes config, else
  the host's own lookup, bounded to 3 seconds) and keeps the latest reading per
  session in memory. Crossing the percent marks one pending directive;
  `pre_llm_call` delivers it on the next turn, merged through the post-edit
  composition so the byte budget keeps it whole. The directive names the bundled
  lit-handoff source, asks for an `auto-handoff-id:` line in the file and for
  the one plain line `Handoff saved. Run /compact now.` (`/compress` on Hermes
  0.17, which has no `/compact`). A plugin cannot start compaction here. After
  the user compacts, or Hermes compacts on its own, the next `pre_llm_call`
  sees a new `_compressed_summary` message, and loads a digest (Current State
  and Next Steps, at most 1,400 bytes, redacted and escaped) of `HANDOFF.md` or
  `.handoff/HANDOFF.md`, but only when the file carries this session's id, was
  written after the directive and is a regular file. Anything else gets a
  one-line refusal. It fires once per crossing, never for delegate children,
  and forgets a session when it ends. Status and doctor print `Automatic
  handoff: ...` and warn when the percent is at or above the estimate of
  Hermes' own compaction point (the `compression` settings, the small-window
  floor and the token cap when the running host has them).
- The `post_tool_call` hook is an observer — Hermes discards its return value — so
  it records the paths a completed `write_file` / `patch` call mutated and
  `pre_llm_call` renders them on the next turn. A source-code edit names
  `lithermes:comment-checker`; an interface extension or a `/components/`, `/ui/`,
  or `/styles/` path segment names `lithermes:frontend-ui-ux` and
  `lithermes:visual-qa`. At most two skills are named, and a docs-only edit or an
  edit with no resolvable path emits nothing at all.
  Native `/goal` is user-managed and unobserved; users may manage it themselves.
  LitHermes has no cache-coherent host controller/post-judge API and performs no automatic update, clear, or resume. Durable `goal_*` state is authoritative for
  criteria, evidence, and completion.
- The `post_api_request` observer consumes Hermes' normalized numeric `usage`
  receipt only (`input_tokens`, `output_tokens`, `prompt_tokens`,
  `total_tokens`, `reasoning_tokens`, `cache_read_tokens`, and
  `cache_write_tokens`). It appends a local `lithermes.provider-cache/v1`
  event with hashed provider/model labels; it never inspects or persists request,
  response, prompt, transcript, URL, or credential fields. A positive
  `cache_read_tokens` value is `MEASURED`; zero counters remain `UNPROVEN` and
  are never inferred as a cache miss. Status/doctor report the capability and
  keep the live-hit claim `UNPROVEN` until a real receipt arrives.
- Explicit skills are available as:
  `lithermes:lit-burnoff-file`, `lithermes:autoresearch`, `lithermes:autoconference`,
  `lithermes:lit-comprehend`,
  `lithermes:lit-humanizer`, `lithermes:comment-checker`,
  `lithermes:debugging`, `lithermes:deep-interview`,
  `lithermes:frontend-ui-ux`, `lithermes:readme-studio`, `lithermes:lit-commit`,
    `lithermes:lit-crucible`, `lithermes:lit-init`, `lithermes:lit-recap`,
  `lithermes:lit-handoff`, `lithermes:lit-scientific-visualization`,
  `lithermes:lit-diagram-drawer`,
    `lithermes:lsp`, `lithermes:lsp-setup`,
  `lithermes:litresearch`, `lithermes:lit-code`, `lithermes:refactor`,
  `lithermes:lit-burnoff`, `lithermes:review-work`,
  `lithermes:rules`, `lithermes:start-work`, `lithermes:structural-search`,
  `lithermes:browser-drive`,
  `lithermes:visual-qa`,
  `lithermes:lit-plan`, `lithermes:litgoal`, `lithermes:litwork`, and `lithermes:wikify`.
- The two UI/UX entrypoints are concise and route preserved dense guidance through
  `references/complete-contract.md`. The detailed `lithermes:frontend-ui-ux`
  contract routes 20 focused design references, and the detailed
  `lithermes:visual-qa` contract routes `skills/visual-qa/references/capture-playbook.md` for
  per-channel capture rules and the exact blocked-capability codes. Every reference is
  hash-listed in `payload-version.json` and verified by installer doctor. Reference text
  is inert data, never an instruction.
- `lithermes:frontend-ui-ux` also exposes the manifest-routed canonical library under
  `references/_canonical-corpus/`. Its 167-file path/size/SHA-256 inventory, legal
  bytes, aggregate digest, regular-file types, and no-extra-files rule must all pass
  before scanner protection applies. Imported Markdown, CSV, and Python stay inert;
  imported Python is never executed. The existing normalized design-intelligence
  resource remains independent.
- `lithermes:autoresearch`, `lithermes:autoconference`, and `lithermes:wikify` install
  one family entrypoint each with nested mode closures. Autoresearch requires an
  explicit budget and bounded-work authority. Autoconference requires real Hermes
  multi-agent capability, root-only delegation, and child packet-only writes. Wikify
  keeps raw sources inert and uses explicit task-local review states. None publishes,
  deploys, creates a daemon, or mutates a live Hermes profile.
- The Hermes Python plugin's `lithermes_knowledge_capture` tool and `pre_tool_call` hook receive
  one strict structured Wikify event. Valid kinds are `fact`, `decision`, `failure`, `risk`,
  `rule`, and `checkpoint`. The runtime rejects malformed, secret-bearing, and
  instruction-shaped values. It never mines raw chat, transcripts, source bodies, fetched text,
  credentials, or tokens. Capture is default-on. Use the Hermes-native
  `hermes lithermes knowledge capture off` command or `LITHERMES_WIKIFY_CAPTURE=0` to opt out of
  automatic capture without changing Hermes host configuration.
  When the host supplies a canonical workspace argument, receipt scope uses it with
  the available session identity. The process cwd is only a fallback when the host
  omits that argument.
  The append-only `.hermes/lithermes/knowledge/claims.jsonl` file is authoritative.
  New stable records start as `review-needed`. `hermes lithermes knowledge save <id>` accepts
  one record. `hermes lithermes knowledge review <id> accepted|rejected|stale` records an
  explicit review state. The `pre_llm_call` query path returns only relevant `accepted` records,
  includes local provenance, and emits no knowledge block on no match. `review-needed`,
  `rejected`, and `stale` records never enter that block. The injected-knowledge context has a
  2048-byte normal budget and a 4096-byte hard limit. These byte budgets are not the Hermes
  model context window. It uses no network, daemon, watcher, embedding, vector database, new
  dependency, derived truth store, or external service. Single-record appends are idempotent,
  so cancel and resume do not apply.
  Public bounded-authority wording has a narrow product-local review-needed exception.
  This exception does not write wiki pages or public sources. Knowledge mutation uses
  descriptor-pinned POSIX operations. The claim append lock is cooperative. The local authority
  assumes a cooperative local user and same-UID processes. It is not a hostile multi-user authorization
  boundary. A same-UID process with workspace access can still read or change the local state.
  Windows returns `unsupported-platform-pinned-write` and does not mutate local knowledge.
- Delegation fans lanes out through the native `delegate_task` tool (children
  run in parallel; top-level dispatch returns immediately, then separate child
  results re-enter later). There is no combined wait: the parent tracks and
  merges per-child re-entry receipts and decides batch completion after every
  dispatched lane is accounted for. There is no named-agent registry
  and no per-child model selection. Broad review commands record a local redacted
  `delegate_batch_intent` summary under `.hermes/lithermes/runs/<run>/delegate_batches/<batch>/`.
- New installs default to the lead route `gpt-6-astra` / `xhigh` for planning,
  review, and other lead work, and to `gpt-6-luna` / `max` for helpers and
  ordinary workers on the global child route. Model diagnostics report these
  routes without exposing credential fields. The coding-lead alternative is `gpt-6.1-sol` /
  `xhigh`. Astra and `gpt-6.1-sol` each support `low`, `medium`, `high`, `xhigh`,
  `max`, and `ultra`; Sol defaults to `xhigh` when selected as lead. The previous
  generation `gpt-6-sol` stays selectable with the same efforts, so existing
  configs keep working. Luna supports `low`, `medium`, `high`, `xhigh`, and
  `max`, with no `ultra`. Existing GPT-5.6
  choices remain selectable within their listed bounds: `gpt-5.6-sol` at
  `high` or `xhigh`, `gpt-5.6-terra` at `high`, `xhigh`, or `max`, and `gpt-5.6-luna`
  at `high` or `max`; general `gpt-5.6` offers `high`. The live model catalog
  lists no retirement date for these GPT-5.6 values. Ordinary reinstall and
  update preserve existing configured model and effort settings, while
  `--reconfigure-model` is the explicit selection reset. An explicit GPT-5.6
  lead reset applies the existing 372,000 context length and 0.9 compression
  threshold; GPT-6 resets do not add either value when absent.
  Hermes has no per-task model override and no per-subagent model override. The
  named reviewer and `litwork-reviewer` routes are unavailable. Hermes also
  exposes no TUI route visibility surface. A configured route is not execution
  proof; an execution receipt is required. A global child `gpt-5.6-luna`
  `xhigh` route is forbidden and stops before installation; `gpt-6-luna`
  accepts `xhigh`. Existing Astra routes with a missing or unsupported effort
  (`none` or arbitrary text) stop before preservation, with bytes and
  permissions unchanged. On
  Hermes 0.17.0 and 0.19.0, `delegation.max_concurrent_children: 20` is a hard per-batch
  limit; fresh or explicitly reconfigured managed settings keep delegation flat at depth 1,
  preserved nested settings make doctor fail, and diagnostics expose
  async batch slots plus the potential simultaneous-child ceiling. Normal delegation uses the OpenAI OAuth Responses runtime; 650K
  auto-compaction is unavailable because the host compression schema is
  ratio-only. The host exposes no verified GPT-6-specific context limit, so
  fresh or explicitly reconfigured GPT-6 settings do not add
  `model.context_length` or compression thresholds; existing explicit values
  are preserved. The 372,000 / 0.9 defaults apply only to explicit GPT-5.6 lead
  resets. Credential-risk or malformed config stays no-write with no backup
  and the installer directs model selection to `hermes model`.
  Direct mutation also requires exact 0.17.0 or 0.19.0 source markers for both the
  per-batch limit, global delegation route, and Responses route. A source hash is rechecked immediately
  before backup/write; drift is reclassified and aborted without mutation.
  A configured route is not execution proof: only an actual `delegate_task`
  execution receipt with requested/effective child identity can prove TERRA ran.
  Existing `delegation.provider`, `delegation.base_url`, or
  `delegation.api_mode` is a user-owned custom transport. Even explicit
  reconfiguration preserves those bytes, leaves the managed child route
  unapplied/unavailable, and directs manual resolution to `hermes model`.
  The managed Astra Responses route writes no `temperature`, `top_p`, or
  `top_logprobs`. If those fields are present on the managed Astra `model`,
  `agent`, or global-child route, installer and doctor fail closed before write
  and preserve the source bytes. Valid sampling on an existing non-Astra route
  remains usable. Custom-provider `extra_body`, auxiliary settings, and
  arbitrary runtime request overrides are host-owned and outside this product
  guarantee; they are not recursively filtered or deleted merely because Astra
  exists elsewhere.
  Installer doctor only reports the plugin loaded when enabled-user JSON and a
  real status command from the installed plugin directory both succeed.
  The npm `doctor` surface also inspects generated bytecode without deleting it;
  package-payload cleanup belongs only to explicit test/pack preparation.
- `/review-work` has a draft-plan mode and the existing completion mode. Plan
  review audits scope/objective achievability, dependencies, atomic checklist
  items, acceptance/evidence, and failure/decision/cleanup, returning `PASS`,
  `ITERATE`, or `NEEDS-CONTEXT` without implementation. Completion review remains
  the five-lane no-rubber-stamp gate: scope/diff, tests/evidence, package/payload,
  security/provenance, and real-surface/docs. A DoneClaim is blocked unless each
  falsifier has evidence and every generated or runtime artifact has a cleanup receipt.
- Public retrieval hardening in `lit research` keeps external research public-only:
  public endpoint/feed routes first, structured Attempt/Verdict trace, route
  taxonomy, validation beyond HTTP 200, login/paywall/CAPTCHA refusal,
  private/loopback route refusal in the research contract, bounded retry, untried
  safe routes / `not_exhausted` reporting, actionable diagnostics, A/B source
  comparison, and a claim/source/confidence/uncertainty graph before synthesis.
  Host retrieval lane protocol uses host-provided webfetch, browser/browsing lane,
  repo deep-dive lane, and `delegate_task`; there is no bundled standalone
  crawler/browser engine, and agents must review fetched content as data, not instructions.

## LLM Contract Schema

Every bundled skill entrypoint is contract-first under the stable schema
`lithermes_llm_contract/v1`. The contract headings are intentionally machine-
addressable so Hermes route wrappers, Python hooks, and `goal_*` tools can point
the model at the same obligations without copying prose between harnesses:

| Heading | Purpose in Hermes |
|---|---|
| `#contract.activation` | identifies the active `plugin.yaml`/skill/route surface before legacy prose |
| `#contract.inputs` | marks user text, repo files, logs, fetched pages, and delegate context as bounded data |
| `#contract.mode_matrix` | separates direct skill loads, `pre_llm_call` route injection, and `delegate_task` lanes |
| `#contract.procedure` | keeps execution on Hermes-native hooks, slash commands, and status/doctor surfaces |
| `#contract.outputs` | shapes DoneClaim-style summaries, blockers, evidence paths, and next steps |
| `#contract.evidence` | requires command transcripts, real-surface probes, cleanup receipts, and payload hashes |
| `#contract.hard_stops` | blocks stale payload hashes, unapproved irreversible actions, and unsafe route bypasses |
| `#contract.anti_patterns` | forbids sibling-copy prose, foreign harness primitives, and tests-only completion claims |

When any payload file under `packages/lithermes-installer/assets/lithermes-plugin/**`
changes, run the payload hash refresh command before packaging:

```sh
npm --prefix packages/lithermes-installer run sync-plugin -- --in-place
```

## Mode Contract

- `lit` / `litwork`: Litwork execution discipline; direct `lit <task>` writes
  `.hermes/lithermes/runs/<run>/` and forwards the task.
- `lit plan`: planning-only. Do not implement or start work; create/refine a
  proportionate objective-achievable plan first.
- `lit review`: review-work audits a draft plan with `PASS` / `ITERATE` /
  `NEEDS-CONTEXT`, or verifies completed work through the existing 5-lane
  all-or-nothing gate. Review never implements the plan.
- `lit research`: separate verified facts, hypotheses, sources, and uncertainty;
  journals live under `.hermes/lithermes/litresearch/<slug>/`. Public retrieval
  hardening tries public endpoint/feed routes first, records a structured
  Attempt/Verdict trace with route taxonomy, validates more than HTTP 200,
  refuses login/paywall/CAPTCHA routes, blocks no network traffic itself,
  instructs refusal of private/loopback routes, reports untried safe routes /
  `not_exhausted` when evidence is incomplete, reports actionable diagnostics,
  uses A/B checks, and keeps a claim/source/confidence/uncertainty graph.
- `lit-crucible`, `litresearch`, `lit-init`, `lit-recap`, `lit-handoff`,
  `lit-scientific-visualization`, and `lit-diagram-drawer`: bounded bare or exact natural routes load the bundled
  skill body for the matching explicit skill; they do not fall back to generic
  Litwork.
- `lit goal`: bind one objective plus checkable criteria in
  `.hermes/lithermes/litgoal/`.
- `lit workflow` / `lit kanban`: durable-workflow setup/proposal mode through
  Hermes Kanban. Probe `hermes version`, `hermes kanban --help`, and
  `hermes profile list`; initialize/start gateway if missing; create/propose a
  Kanban root card only after setup and approval.
- `lit team`: no literal native team mode is claimed; use Hermes Kanban profile lanes.
- `lit start work`: `BLOCKED` in natural routing because `pre_llm_call` cannot
  switch Hermes commands. The user must invoke `/start-work <approved-plan>`.

Natural routing ignores code spans, fenced code, substrings, compounds, path-
embedded tokens, and real slash-command mentions. `/tmp/repo` and
`/api/v1/users` are path-like arguments, not suppressors. Secret-bearing prompt
text is redacted before persistence or model-facing handoff; malformed input
fails closed without partial run state. Local `.hermes/lithermes` state, plans,
runs, evidence, `state.json`, `ledger.jsonl`, and `notepad.md` are not packaged.
The same package exclusion covers `.hermes/lithermes/knowledge/claims.jsonl` and its local
`settings.json` capture setting.

Release/readiness boundary: LitHermes does not publish, tag, create releases,
push, commit, or bump versions from skill guidance. Those actions require
explicit user approval. Package readiness requires real diff inspection,
payload hash refresh after bundled asset edits, denied-token scans, and
`npm pack --dry-run --json` evidence.

Enable with:

```yaml
plugins:
  enabled:
    - lithermes
```

## Reference

The bundled workflow reference is written for LitHermes command names and
Hermes gateway behavior. LitHermes runs entirely on Hermes-native primitives
(`delegate_task`, the durable `goal_*` tools, and the `on_session_start` /
`pre_llm_call` / `post_tool_call` / `post_api_request` / `subagent_stop` hooks) and ships no external
prompt-runtime installer in the plugin payload. Repo-rule loading is handled by
Hermes' native context-files feature plus the bundled LitHermes rules engine
(`rules/`), whose glob matcher is a documented subset of `.cursor/rules`
semantics — see `rules/globmatch.py` DIVERGENCES.

## Skill rename compatibility

The current skill ids are `lit-crucible`, `lit-init`, `lit-commit`, `lit-burnoff`, `lit-burnoff-file`, `lit-korean`, and `lit-code`. Previous typed ids redirect for one release and emit one rename note; the next minor removes them. Install/update replaces the manifest-owned plugin tree, removing old skill directories and recording the new paths and hashes. The previous Korean slash command redirects to `/lit-korean`. `lit-team` names the existing Hermes Kanban route without adding a team skill.

## LIT mark and activation probe

The installer uses the 44×20 banner with a `lithermes` product column, retaining
its install-plan frame. The native welcome skin owns the 22×10 standard mark;
plugin registration adjusts the active managed skin in memory for the current
terminal. No session hook prints a second welcome mark and user-owned skins are
preserved. The native host may omit welcome art in its compact layout.

Slash-command `display` renders the padded 16×5 micro mark with
`🔥 LIT IGNITED · <route> 🔥`. In truecolor terminals, every non-space mark and
label glyph is bold with an orange-to-pink-to-cyan gradient; xterm-256 uses the
nearest stop colors `#FF6337` → 203, `#FF2D95` → 198, and `#00E5FF` → 45. `NO_COLOR`,
CI, non-TTY output, and other unsupported color conditions keep the acknowledgement
plain. Natural routes use the existing output-transform hook at reply arrival
because Hermes' pre-LLM hook accepts model context, with no acknowledgement
channel. That transform appends indented, plain micro rows and the same label,
with no ANSI escapes, while preserving the model reply byte for byte; it never
supplies, removes, or normalizes a probe. Measured blocked routes still replace
unsafe model output with their denial. A route wrapper requires exactly one
model-emitted first line, `🔥 **LIT IGNITED · <discipline>** 🔥`, on its own line
before any other reply content, with the canonical id (including `lit-korean`
for its old aliases). This remains an advisory model instruction whose absence
must be visible to a probe, not hidden by rendering.

`lit_mark_rows.json` contains the approved Ignition B geometry and per-cell
foreground colors, sampled from the authored interlocking vector symbol. Its
SHA-256 is `e7f3e2be168bedc5c15836d105ffed570f3bfd8745522502293de8718f503aec`.
The package carries its own complete data; no umbrella folder or other product
is needed at runtime. The standard, banner, and micro exports remain string
arrays with exact 22×10, 44×20, and 16×5 envelopes, including canvas padding.
The banner retains its final empty canvas row. README code blocks omit only
trailing spaces. Lockups keep an eight-space gap after the mark envelope and
accept arbitrary plain product labels. The old round6 banner fixture remains
historical and is no longer the current geometry authority.

JS `colorize(rows, {mode})` and Python `colorize(rows, options)` preserve glyphs
and use flat Ignition Orange `#FF6337`, Signal Lime `#D7F75B`, and Terminal Ivory
`#F2EFDF`. Indexed foreground approximations are 203, 191, and 230 respectively.
Neither renderer forces a background. The legacy `shadow` option is accepted
but has no effect on the flat mark. Unknown custom glyph rows use neutral
ivory; a canonical mark with any supported lockup label retains its cell colors.
Native skin markup uses Rich; command display uses native ANSI; reply
transcripts use unchanged plain rows. The installer generates all managed skin
YAML through the JS renderer, while the Python welcome hook adjusts the active
managed skin in memory for its current terminal. Accent presets, progress and
spinner colors remain separate from the logo palette.

`NO_COLOR` (including an empty value), CI, JSON, and piped output suppress ANSI.
An explicit non-UTF-8 locale or `TERM=dumb` uses `LIT`; an unspecified locale
assumes Unicode support. Plugin payload edits require the native payload hash
refresh after the final source change; both runtime modules and the row data
are shipped through the existing assets allowlist.
