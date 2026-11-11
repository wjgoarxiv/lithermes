# lithermes

Hermes-native workflow tools for plan-first execution, evidence ledgers, and
first-class Hermes skills. With `lit` in front of a request you see this:

- A reply that says it is done while the goal's checks are still open ends with
  `⛔ LIT: not done — <reason>`, and `goal_complete` refuses. A `lit` session that says done
  without ever opening a goal gets the same line.
- A green counts only when the plugin watched that test command finish with exit 0 and signed
  a receipt for it. Change the code afterwards and the receipt goes stale until the tests run
  again.
- Delete a test, drop an assertion or add a skip, and the goal stays closed until the user
  accepts the change with `/lit-accept-tests <reason>`. No model-callable tool does that.
- When a session that held a goal closes, a handoff card is written under
  `.hermes/lithermes/handoff/`. The next session in the project offers the unfinished goal,
  and a bare `lit` adopts it.
- Hermes Desktop shows the goal, its gate and a six-step timeline in a right-hand pane. The
  desktop half is Off by default: switch LitHermes on under Capabilities > Plugins.

The sections below give the detail.

Install from npm with the package name `@litfamily/lithermes`:

```sh
npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes
```

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
  grant. Pause is code-owned and cannot be called as a slash shortcut. Three
  whole-prompt words steer a live run from any Hermes session of the project, a
  nested folder or a linked worktree: `lit cancel` (`lit 취소`) ends it with no work
  id or revision, `lit approve` (`lit 승인`) turns every parked step into a grant and
  `lit deny` (`lit 거절`) refuses them; approving and denying are optional.
- The model reports bounded progress only with `lithermes_work_progress`.
  `pre_tool_call` supplies the real Hermes session and enforces active-work,
  monotonic CAS revision, replay id, and one-use grant checks. First new progress
  continues; same replay is idempotent; later unchanged and stale work/revision
  calls are silent. A call outside the grants, or a new non-forbidden boundary the
  model reports, is parked (up to 16 per run) and the run keeps going; only a
  session that ends pauses a run, and a trusted explicit user hands it on with
  `/lit-loop resume ... --grant continue-session@<root>`. The exact resume for a
  parked boundary still mints a one-use grant identity, and a run paused at a
  boundary by an older LitHermes reads as active with that step parked. The agent has
  no resume or grant bypass. Consumed grant identities survive event compaction,
  paused work cannot complete, and terminal reuse returns the existing terminal state.
- `pre_tool_call` also gates real Hermes mutation tools with the host-supported
  `action: block` directive. Read-only calls remain available. File writes and
  supported test/build/check terminal calls require exact-session canonical
  action/root authority; paused, wrong-session, out-of-root, ambiguous, and
  unsupported mutations are blocked. Safe action normalization rejects prefixed
  or hyphenated commit, publish, push, release, tag, install, host-config,
  credential, and destructive equivalents, and none of them is ever parked.
  While a run is live, secrets and Hermes settings (`~/.ssh`, `~/.aws`, `.env`
  files, private keys, `config.yaml`, `auth.json`, the litgoal seal key) are
  refused for reads and writes, and run state, litgoal gate state and git
  configuration for writes, with no queue and no approval. Hermes' own session
  transcripts and spill files stay readable. Only a path a call names is checked,
  so a folder-wide search can still read inside a secret file.
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
- Moved skills. `lithermes:lit-pptx`, `lithermes:lit-docx`,
  `lithermes:lit-diagram-drawer`, `lithermes:lit-schematic`,
  `lithermes:lit-scientific-visualization`, `lithermes:frontend-ui-ux`,
  `lithermes:visual-qa`, `lithermes:lit-typographic-motion` and
  `lithermes:readme-studio` moved to the `wjgoarxiv-skills`
  repository (`plugins/<family>/skills/<id>`). Each keeps a same-name stub under
  `skills/`, and every route that opened the full skill still lands on it:
  `/lit-pptx`, `/lit-docx`, `/lit-diagram-drawer`, `/lit-schematic`,
  `/lit-scientific-visualization` and `/lit-typographic-motion`, the exact names,
  and bare `lit` with deck, report, diagram, schematic, film, README or interface
  wording. The route context names the folder and the one-skill copy line into
  `${HERMES_HOME:-$HOME/.hermes}/skills/`, and the stub loads the installed copy
  with `skill_view("<id>")`. Without that copy it builds nothing. The vendored
  scientific-visualization source moved too, to
  `plugins/figures/vendor/scientific-visualization`. The Office runtime, the
  motion runtime command and their doctor lines left with the skills.
- `/lit-hijack <brief>` and the exact `lit-hijack` route (also `lit hijack`,
  `lit hijacking`, `lit 하이재킹`, `lit 하이잭`) load the installed hijack skill.
  Published know-how enters only through capture with provenance, a licence gate,
  a source-free spec and a parity proof.
- `/lit-adhd [--here] [--since 7d] [--max 12] [--detail]` and the exact `lit-adhd` route
  (also `lit adhd`, `lit rewind`, `lit-rewind`) load the installed adhd skill. Its collector
  draws a KPI board (do this now, at a glance, milestones, done lately, still to do, don't
  forget) that the reply shows as given; `--detail` (`lit adhd 자세히`) adds the per-session brief.
  One collector run reads the session store read-only and prints the
  cross-session brief; a bare `go` continues the offered step within 30 minutes.
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
  `lit-brainstorm` (after `lit`: `brainstorm`, `brainstorming`, `ideation`, `ideate`, `idea`, `ideas`),
  `lit-burnoff`, `lit-burnoff-file`, `comment-checker`, `lsp`, `lsp-setup`, and
  `rules`.
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
- The `transform_tool_result` hook is the one post-execution hook whose return
  value Hermes keeps. After a `terminal` or `execute_code` call it looks for DOCX,
  PPTX and Markdown files modified while the call ran, in a bounded walk of the
  call's working directories and the folders of paths named in the command, code
  or output (depth 4, 4,000 entries per folder, 6 files, 16 MiB per Office file;
  hidden, dependency and internal `plans/` / `evidence/` / `.hermes/` paths are
  skipped). Office text goes through the bundled extractor and the LitHumanizer
  detector. A block-tier finding adds `LIT_HUMANIZER_SCRIPT_DELIVERABLE_BLOCK`
  with the file, rule ids and matched words to that result's `error` field, so the
  model reads it before its next step. It instructs a rebuild and cannot refuse
  the write: the file already exists, and the command's exit code is left as it
  ran. Each file version is judged once per session.
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
  `lithermes:lit-comprehend`, `lithermes:lit-brainstorm`,
  `lithermes:lit-humanizer`, `lithermes:comment-checker`,
  `lithermes:debugging`, `lithermes:deep-interview`,
  `lithermes:frontend-ui-ux`, `lithermes:readme-studio`, `lithermes:lit-commit`,
    `lithermes:lit-crucible`, `lithermes:lit-init`, `lithermes:lit-recap`,
  `lithermes:lit-handoff`, `lithermes:lit-scientific-visualization`,
  `lithermes:lit-diagram-drawer`, `lithermes:lit-schematic`, `lithermes:lit-hijack`,
  `lithermes:lit-adhd`,
    `lithermes:lsp`, `lithermes:lsp-setup`,
  `lithermes:litresearch`, `lithermes:lit-code`, `lithermes:refactor`,
  `lithermes:lit-burnoff`, `lithermes:review-work`,
  `lithermes:rules`, `lithermes:start-work`, `lithermes:structural-search`,
  `lithermes:browser-drive`,
  `lithermes:visual-qa`,
  `lithermes:lit-plan`, `lithermes:litgoal`, `lithermes:litwork`, and `lithermes:wikify`.
- `lithermes:frontend-ui-ux` keeps the measured interface probe that litwork and
  the UI hand-offs run after a web edit (`scripts/probe.mjs` with its helpers and
  the two rule tables it counts). Every kept file is hash-listed in
  `payload-version.json` and verified by installer doctor. Reference text is inert
  data, never an instruction.
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
  `max`, with no `ultra`. Existing GPT-5.6 choices stay selectable with every
  effort the live model catalog lists for them: `gpt-5.6-sol` and
  `gpt-5.6-terra` take the same six efforts as Astra, and `gpt-5.6-luna` takes
  the same five as `gpt-6-luna`; general `gpt-5.6`, which the live catalog does
  not list, offers `high`. Hermes accepts every listed effort in its config, but
  the request it sends can be lower: `ultra` goes out as `max` on Astra and the
  GPT-5.6 models, and on `gpt-6.1-sol`, `gpt-6-sol` and `gpt-6-luna` current
  Hermes sends `max` and `ultra` as `xhigh`. The live model catalog
  lists no retirement date for these GPT-5.6 values. Ordinary reinstall and
  update preserve existing configured model and effort settings, while
  `--reconfigure-model` is the explicit selection reset. An explicit GPT-5.6
  lead reset applies the existing 372,000 context length and 0.9 compression
  threshold; GPT-6 resets do not add either value when absent.
  Hermes has no per-task model override and no per-subagent model override. The
  named reviewer and `litwork-reviewer` routes are unavailable. Hermes also
  exposes no TUI route visibility surface. A configured route is not execution
  proof; an execution receipt is required. A route whose effort the model does
  not list, such as `gpt-5.6-luna` at `ultra`, stops before installation; both
  Luna generations accept `xhigh`. A `minimal` effort from the Hermes menu counts as `low`,
  since Hermes sends it as `low` on these routes. Existing Astra routes with a missing or unsupported effort
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
- `/review-work` has two named modes: plan review (after `lit-plan`, before `start-work`) and
  work review (after `lit-loop` or `start-work`). It auto-picks from what exists (a diff, changed
  files outside `plans/` or ticked plan rows mean work; an unticked plan alone means plan; neither
  means ask), `plan` or `work` after `lit review` or `/review-work` forces one, and the first report
  line names the mode. Plan
  review audits scope/objective achievability, dependencies, atomic checklist
  items, acceptance/evidence, and failure/decision/cleanup, returning `PASS`,
  `ITERATE`, or `NEEDS-CONTEXT` without implementation. Work review remains
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
  `.hermes/lithermes/runs/<run>/` and forwards the task. The route stays under
  4,000 bytes so Hermes delivers it whole on every turn (it caps a turn that also
  carries the static rules at 4,096 bytes and spills later hook results above
  10,000 characters). It names the ledger, the mode rules and the loop, and loads
  the `litwork` and `lit-code` skills through `skill_view` when they are needed.
- Repeating `lit`: the first `lit` of a session sends the full activation above. While the
  same discipline stays active, `lit ...` sends a note under 600 bytes (no skill reload, no new
  run, plan file or goal). `lit <other discipline>` switches with that discipline's full
  activation. A bare `lit` or `lit continue` continues whichever discipline is active, or with none
  active resumes an unfinished start-work run or bounded work, and `lit new ...` or `lit restart ...` starts over. Only a bare `lit` with nothing active asks
  what to start. The session record is in memory (`lit_reentry.py`); a missing, stale or
  compacted record falls back to the full activation.
- `lit plan`: planning-only. Do not implement or start work; create/refine a
  proportionate objective-achievable plan first. The route keeps the planning
  guard and plan path in view and loads `lithermes:lit-plan` through `skill_view`.
- `lit review [plan|work]`: review-work audits a draft plan with `PASS` / `ITERATE` /
  `NEEDS-CONTEXT` (plan review), or verifies completed work through the existing 5-lane
  all-or-nothing gate (work review). The wrapper states `Review mode: plan|work (forced by the
  user)` or the auto-pick rule. Review never implements the plan.
- `lit research`: separate verified facts, hypotheses, sources, and uncertainty;
  journals live under `.hermes/lithermes/litresearch/<slug>/`. Public retrieval
  hardening tries public endpoint/feed routes first, records a structured
  Attempt/Verdict trace with route taxonomy, validates more than HTTP 200,
  refuses login/paywall/CAPTCHA routes, blocks no network traffic itself,
  instructs refusal of private/loopback routes, reports untried safe routes /
  `not_exhausted` when evidence is incomplete, reports actionable diagnostics,
  uses A/B checks, and keeps a claim/source/confidence/uncertainty graph. The
  acquisition procedure loads from `lithermes:litresearch` through `skill_view`.
- `lit-crucible`, `lit-init`, `lit-recap`, `lit-handoff`,
  `lit-scientific-visualization`, `lit-diagram-drawer`, `lit-schematic`, `lit-hijack`, and `lit-adhd`: bounded bare or exact natural routes load the bundled
  skill body for the matching explicit skill; they do not fall back to generic
  Litwork.
- `lit goal`: litgoal sets and keeps the finish line; lit-loop and start-work run toward it.
  Bind one objective plus checkable criteria in `.hermes/lithermes/litgoal/`.
- `lit brainstorm` / `lit ideation` / `lit idea`: brainstorm-only. Diverge into many different
  options, cluster, score against stated criteria, converge to a short list, ask the user to
  pick or combine, then hand off to `deep-interview` (pick still vague) or `lit-plan` (pick
  concrete). It never implements, creates no run or plan file, and keeps optional notes under
  `.hermes/lithermes/brainstorm/<slug>/`. The route loads `lithermes:lit-brainstorm` through
  `skill_view`.
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

## Observed evidence, resume, handoff card and Desktop pane

These surfaces sit on the litgoal runtime (`litgoal/`). A session's state lives in
`<workspace>/.hermes/lithermes/litgoal/sessions/<session>/`, and every item below reads or
writes only there, plus the `handoff/` folder named in its own bullet.

- Observed evidence. `post_tool_call` records each finished `terminal` call as a run
  (`R001`, `R002`, ...) in the session's `runs.jsonl`: a SHA-256 of the command, a redacted
  preview of at most 100 characters, the exit code, the time and a workspace fingerprint.
  A call that only started a background process is not a run: Hermes answers `exit_code: 0`
  the moment it spawns one (`{"output": "Background process started", "session_id", "pid"}`,
  plus `auto_backgrounded` for a command it converted), so a result with `background` set in
  the arguments, a `session_id`, `pid` or `auto_backgrounded`, or a `started` or
  `yielded_to_background` status is never recorded, and a long suite that Hermes moved to the
  background stays unproven until a foreground run finishes. Run numbers only grow within a
  process, so truncating `runs.jsonl` does not reissue an id.
  `goal_evidence` of kind `green` counts only when its ref is `run:<id>` and that run exited 0
  and was signed by this process for this workspace and session. Any other green is stored as
  `claimed` and the quality gate stays closed. `goal_complete` with no active goal returns a
  refusal and no longer raises. After each run, evidence add, status change, blocker change and
  gate evaluation the runtime saves the verdict to `gate.json` beside the goal.
- Signed run receipts. Each record carries an HMAC-SHA256 over its workspace, session, id,
  tool, command hash, preview, exit code, time and fingerprint. The key is 32 random bytes
  generated when the module is imported. It lives in memory and is never written to disk.
  A line added to `runs.jsonl` by hand, a line copied from another session or workspace, an
  edited exit code, and a record written by an earlier process (a gateway restart ends the
  old key) all fail verification, and evidence that cites such a run is reported as
  unverifiable until the tests are run again. A valid signature shows that this plugin process
  saw Hermes finish that terminal call with that exit code, in that workspace and session,
  and that the record is unchanged since. It does not show that the command tested anything
  useful (a command that exits 0 without testing still exits 0), that the code is correct,
  or that the test files were left alone (the test guard below covers that). It gives no
  protection against code that runs inside the gateway process or a process that can read
  its memory. The dashboard route lives in a different process, cannot re-verify a signature,
  and labels the gate it shows `"source": "session"`.
- Stale evidence. A run stores a fingerprint of the workspace at the time it ran. Inside a
  git work tree that is `HEAD` plus a content tag for every file that differs from `HEAD` or is
  untracked; outside git it is a capped walk over path, size and modification time. When the
  fingerprint at gate time differs, the green no longer counts, and the gate names the changed
  files and asks for a new run. A run whose fingerprint could not be taken counts as stale, and
  so does a work tree of more than 40,000 files. The fingerprint never runs `git diff` or
  `git status`, because those apply the repository's `filter.<driver>.clean` programs (set by
  `.gitattributes` and `.git/config`) to modified files, and no command-line flag switches off
  drivers git has not been told by name. It uses only `rev-parse`, `ls-tree` and `ls-files`
  (with `core.fsmonitor` forced off), which read names and object ids and start no repository
  program, and hashes the files itself in Python against the object ids `HEAD` records. Its
  `git` calls receive `PATH`, `HOME`, `LANG` and `LC_ALL` only and share a 2 second budget with
  the file reads. A filter-converted file (CRLF conversion, for example) always counts as
  changed, which is stable and only costs it a name in the list.
- Visible refusal. When the last 20,000 characters of a reply contain a completion claim
  (`done`, `completed`, `finished`, `fixed`, `shipped`, `ready to ship`, `all tests pass`,
  `all green`, `완료`, `다 했`, `끝났`, `끝냈`, `마쳤`, `고쳤`) while the active goal's gate is
  closed, `transform_llm_output` appends one line, `⛔ LIT: not done — <first two reasons>`.
  The reply keeps its own words and nothing is blocked. The claim test is a short word
  pattern, so a reply can trigger it without meaning to claim completion, and a claim in other
  words ("LGTM") goes unmarked. The line is skipped only when the reply already carries that
  exact line on a line of its own, outside code fences and HTML comments; the same text in a
  comment or in the middle of a sentence does not suppress it. A goal whose `complete` status
  is not backed by this install (see the seal below) is not treated as finished, so writing
  `"status": "complete"` into `goals.json` by hand leaves the gate in force. Delegate children
  and sessions without a work route are skipped. If the gate cannot be evaluated, no line is
  added: the hook fails open, as the host's 30 second hook limit does.
- No goal opened. When a work route (`lit`, `lit-loop` or `start-work`) is active in the
  session, the reply carries a completion claim as above, and the session holds no litgoal goal
  at all, `transform_llm_output` appends `⛔ LIT: not done — no goal was opened, so nothing was
  verified (type lit to start one)`. It reads the plugin's own per-session record of the
  activated route, so ordinary chat without `lit` never gets it, and neither do the planning
  and review routes (`lit-plan`, `review-work`, `lit-brainstorm`, `litresearch`). Opening a goal
  later hands the session to the gate line above. The same fencing and idempotence rules apply,
  and a state file that cannot be read adds nothing.
- Finish hold. The plugin registers `pre_verify`, which Hermes calls once per turn when the
  agent edited code and is about to deliver its answer (in `VALID_HOOKS` since Hermes 0.18.0,
  wired in `agent/turn_stop_gates.py` of the 0.21.3 floor). When the active goal's gate is
  closed and the draft answer contains a completion claim, the hook returns
  `{"action": "continue", "message": <first three gate reasons>}` and the turn runs once more.
  It returns nothing for a delegate child, for a session without an active or unfinished
  goal, for a draft that makes no claim, and when the gate cannot be evaluated. Hermes caps
  consecutive holds per turn with `agent.max_verify_nudges` (default 3), and only edits made
  through Hermes' file tools count as "edited code", so a change made with a shell command
  does not trigger the hook. The `⛔` line above stays the backstop for a reply that goes out.
- Test guard. `goal_set` snapshots every test file in the workspace (`test_*.py`,
  `*_test.py`, `*.test.*`, `*.spec.*`): the number of test functions, assertions and skip
  markers (`skip`, `xfail`, `only`), counted line by line. At every gate evaluation a file
  that lost tests or assertions, gained a skip marker or was deleted raises a review blocker
  whose source is `testguard`, and the gate closes. The blocker clears by itself when the
  file is restored. No tool the model can call resolves it. Only the user's slash command
  `/lit-accept-tests <reason>` accepts the change and re-baselines the files; the redacted
  reason goes into the litgoal ledger. `/lit-accept-tests` accepts the session that most
  recently ran a turn in this process; `/lit-accept-tests --all-sessions <reason>` accepts every
  session of that workspace, and with no known session the plain form asks for the flag.
  A new goal inherits the stricter of the old and the current counts per file (more tests and
  assertions, fewer skips). The scan is bounded to 2,000 files, 50,000 directory entries,
  1 MiB per file and a 5 second wall-clock budget. A baselined file that still exists but can
  no longer be scanned (replaced by a symlink, grown past 1 MiB, unreadable, or not reached
  before the budget ran out) counts as weakened and raises the same blocker, which clears
  only when the file can be scanned again. Known limit: the baseline is `testguard.json` in the
  session's folder inside the workspace, so a model with a raw shell can empty or rewrite
  it. With no baseline the guard has nothing to compare and raises no blocker. The count is a
  line pattern, so a rewrite that keeps the counts passes it.
- Goal resume offer. On the first `pre_llm_call` of a session that holds no goal of its own,
  the plugin looks through the other `litgoal/sessions/*` folders of the same workspace (the
  newest 50) for an unfinished goal. If it finds one, the model gets its title and the number
  of open criteria, plus the saved time and path of its handoff card, and is told to mention
  the offer once and to start nothing. Only goals this install wrote are candidates: every
  `goals.json` the runtime saves carries a `seal`, an HMAC-SHA256 over its content and session
  id, keyed by a random per-install key in `<Hermes home>/lithermes/litgoal.key` (mode 0600,
  created on first use). A file that is unsealed, edited after it was saved, copied from
  another session or written under another key (for example one committed to a cloned
  repository) is neither offered nor adopted. The same seal decides whether a `complete`
  status is believed. The key is readable by anything running as the user, the model's shell
  included, so the seal stops foreign and casually edited state and not an agent that
  deliberately reads the key; if the key cannot be read or created nothing is sealed, and
  state saved over an unsealed file stays unsealed. Goals saved before this release carry no
  seal and are not offered. A bare `lit` or `lit resume` adopts the goal: the
  goal state, ledger, brief, test baseline and evidence files are copied into the new
  session, which records where they came from, and the other session is only read. Runs are
  not copied, so green evidence must be earned again in the new session. `lit new ...` starts
  over. `LITHERMES_GOAL_RESUME=0` turns the offer and the adoption off.
- Handoff card. `on_session_finalize` writes `<workspace>/.hermes/lithermes/handoff/<session
  id>.json`, `latest.json` (the same card) and `latest.md` for a session that holds a litgoal:
  the goal, each criterion's status, whether the gate is open and why not, the last three
  runs and the next step. It is built from files on disk with no model call, network or
  subprocess, and a session with no goal writes nothing. The card is written when the host
  closes the session, which is the host's decision. On `hermes -z` and Desktop chat the
  gateway closes a session after a grace period once nothing is attached to it, so the card
  can appear minutes or longer after the last turn. A gateway restart before that loses the
  plugin's memory of the session's folder, and that session gets no card.
- Workspace resolution (`workspace.py`). Since Hermes 0.23 runs `hermes -z` and Desktop chat
  through one shared gateway process whose own cwd is the Hermes home, hooks cannot use the
  process cwd. The folder is taken from the first of these that names an existing absolute
  directory: a `workspace` or `cwd` hook argument; the turn's pinned folder
  (`agent.runtime_cwd.scoped_session_cwd`); the task override cwd
  (`tools.terminal_tool.resolve_task_overrides`); the folder this plugin saw earlier in the
  session; the session's last terminal cwd (`tools.terminal_tool.get_session_cwd`); the
  profile's `TERMINAL_CWD` (`agent.runtime_cwd.scope_terminal_cwd`, or the environment
  variable on hosts without that module); and finally the process cwd. These host helpers are
  private to Hermes and may be renamed in a release. They are read from `sys.modules` and
  never imported, each call is wrapped so a failure only drops that source, and outside a
  host (tests, the `hermes lithermes` CLI) only the process cwd remains. None of these is
  used as a workspace, and the plugin logs the refusal once: a Hermes home, any folder inside
  one or inside `~/.hermes` (symlinks followed), the user's own home folder, and a folder
  whose `.hermes` is a Hermes home. The plugin writes no workspace state there; its own files
  in the Hermes home are the ones listed under Disclosures.
- Dashboard route and Desktop pane. `dashboard/manifest.json` and `dashboard/plugin_api.py`
  add one route, `GET /api/plugins/lithermes/goal?cwd=<workspace>`, mounted by Hermes. It only
  reads. `cwd` must be an absolute path that resolves, with symlinks followed, to a place
  inside the user's home directory, otherwise the answer is HTTP 400. A state file that
  resolves outside the workspace is ignored. Free text is redacted and length-capped. The
  answer holds the goal, its criteria, the evidence, the gate verdict and a six-stage
  timeline (plan, runs, review, gate, handoff, resume). Missing or unreadable state returns
  `{"goal": null}`. The route sets no CORS headers, adds no authentication of its own and
  opens no port; who can reach it is whatever Hermes allows for plugin routes. `desktop/plugin.js`
  is plain ESM that imports only `@hermes/plugin-sdk` and `react/jsx-runtime`; it polls that
  route every 5 seconds for the folder the app has open and registers a right pane and a
  status-bar chip. In Hermes Desktop 0.23 the desktop half stays off until the user turns it on
  under Capabilities > Plugins, and Desktop copies it into an app-level folder
  (`desktop-plugins/`) that every profile shares.

## Disclosures

- Hermes version. `plugin.yaml` declares `requires_hermes: ">=0.21.3"`, a SemVer floor that
  the catalog entry repeats. The floor is set by the Desktop half. Unified agent and desktop
  packages, the `ctx.rest` call, the pane and `statusBar.right` areas and `useQuery` in
  `@hermes/plugin-sdk` are all in 0.21.3 (checked against the Hermes source tagged
  `v2026.9.14`), and so are all twelve hooks listed in `plugin.yaml`. Workspace
  resolution reads newer host helpers when they exist and works without them.
- Processes the plugin starts. The plugin builds every argument list itself and no call uses
  a shell. The one caller-supplied value is the base ref of a review diff, and it goes after
  `--`. `git` runs for review diffs and the fingerprint (20 second limit). The prose detector
  runs under the plugin's own interpreter (`-B -I`) with the text on stdin. `pdftotext` reads
  PDF bytes on stdin (8 seconds). `agent-browser --version` is the browser probe. Each gets an
  allowlist environment built by `child_env.py`: `PATH`, `HOME`, `USER`, locale, `TMPDIR`,
  `SHELL`, `TERM`, `HERMES_HOME`, the `XDG_*` base directories and, on Windows, the system
  variables the OS needs. Provider keys and tokens in the parent environment are not passed
  down. The npm install channel's self-update uses its own allowlist and is absent from the
  catalog copy. Skill scripts the model runs through Hermes' own terminal tool go through
  Hermes' approval flow and are outside this list.
- Private Hermes imports. `auto_handoff.py` imports `agent.context_compressor`,
  `hermes_cli.config_defaults`, `agent.model_metadata` and `hermes_cli.commands`, and
  `diagnostics.py` imports `hermes_cli`. They are read-only lookups of the compaction
  defaults, the model's context window and the compact command's name, so the handoff
  percent can be compared with Hermes' own compaction point and the right command named.
  Hermes has no public interface for these. Each lookup is wrapped (the context-window lookup
  has a 3 second limit) and falls back to a plain default or a "window unknown" notice, so a
  Hermes release that moves one of them costs a missing comparison and breaks nothing else.
  `hermes plugins validate` lists these imports as a caution under catalog rule 9, and
  `workspace.py` (above) reads host modules the same way, through `sys.modules` where a
  static check does not see them.
- Local state. The files above live in the user's workspace under `.hermes/lithermes/`
  (`litgoal/sessions/<session>/`: `goals.json`, `ledger.jsonl`, `runs.jsonl`, `gate.json`,
  `testguard.json`; and `handoff/`). They hold redacted command previews, goal text and file
  names, and should stay out of public commits. One file lives outside the workspace: the
  seal key `<Hermes home>/lithermes/litgoal.key`, 32 random bytes in hex, which holds no
  user content and should not be shared. Deleting it makes this install stop recognising
  the goals it saved earlier.

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
