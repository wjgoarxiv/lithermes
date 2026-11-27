# LitHermes operating guide


`@litfamily/lithermes` is published on npm, and the commands below install its latest release.

[Start here](../README.md) · [한국어](./guide.ko.md)

## What it is

LitHermes is the Hermes Agent plugin distributed as `@litfamily/lithermes`. It keeps planning, execution, review, evidence, and handoff as separate modes so a task can stop safely and resume with a visible record.

The plugin is reversible. It installs into `~/.hermes`, does not contact Telegram during installation, and does not claim a native Hermes team mode. Gateway aliases map to Hermes' existing dispatch surface.

```mermaid
flowchart TD
    R["a request<br/>make it better"] --> DI["<b>deep-interview</b><br/>turn it into a decision-complete brief"]
    DI --> P["<b>lit-plan</b><br/>objective · non-goals<br/>action / output / <b>binary verification</b>"]
    P --> GATE{"user approves?"}
    GATE -->|no| P
    GATE -->|yes| SW["<b>start-work</b><br/>execute one slice"]

    subgraph LOOP["each slice: RED to GREEN to SURFACE to CLEAN"]
        SW --> RED["failing test first"]
        RED --> GREEN["smallest change that passes"]
        GREEN --> SURF["exercise the <b>real surface</b><br/>not just the test"]
        SURF --> CLEAN["tear down · cleanup receipt"]
    end

    CLEAN --> EV{"evidence complete?"}
    EV -->|"tests only"| SW
    EV -->|"artifact + receipt"| RW["<b>review-work</b><br/>scope · evidence · payload<br/>security · real surface"]
    RW -->|findings| SW
    RW -->|clean| HO["<b>lit-handoff</b><br/>resumable packet"]

    style GATE fill:#fff3cd,stroke:#856404
    style EV fill:#fff3cd,stroke:#856404
    style SURF fill:#d4edda,stroke:#155724
    style RW fill:#d1ecf1,stroke:#0c5460
```

> **How to read the loop:** plan approval is a real gate, with a binary check named for every item. A slice closes only after the Hermes surface produces evidence and temporary QA resources are torn down; passing tests alone is not a handoff.

## Quick start

Run a read-only check first:

```sh
npx --package @litfamily/lithermes -- lithermes doctor
npx --yes --package @litfamily/lithermes@latest -- lithermes doctor
bunx --package @litfamily/lithermes lithermes doctor
```

Install the plugin:

```sh
npx --package @litfamily/lithermes -- lithermes install --yes
```

For a non-interactive first install, approve both layers:

```sh
npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes
```

The first `--yes` approves `npx` package execution. The second approves LitHermes writing Hermes configuration. The npm package is `@litfamily/lithermes`; `lithermes` is the installed binary name.

Useful variants:

```sh
bunx --package @litfamily/lithermes lithermes install --yes
npx --package @litfamily/lithermes -- lithermes install --dry-run
npx --package @litfamily/lithermes -- lithermes install --yes --no-spinner
npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes
```

Without `--yes`, an install in a terminal asks its questions on cards: the provider and model for the agents, the same for the helpers, a last look at that route, then the HUD accent, the reply style and the finish bell. Each card says what the answer changes and marks the default. Use the arrow keys or `j`/`k` to move, a number to jump, `Enter` to take the highlighted choice, and `y` or `n` on the yes/no card. Nothing is written until you confirm the model route; Ctrl+C or Ctrl+D before that leaves your Hermes home untouched. After an answer the card folds to one line, and a closing card lists what was installed, with warnings first, then the settings and what to do next, or says `INSTALL STOPPED`, at which stage and why. Pills, buttons and the highlighted row have round ends when your terminal can draw them and square ends otherwise, by the same rule as the [goal card](#the-goal-card-in-hermes---tui).

`--yes` shows `PREPARING INSTALL` and finishes with an `INSTALL RECEIPT` or an actionable `INSTALL STOPPED` panel. With `NO_COLOR` the cards stay, without colour. For plain numbered prompts, for example with a screen reader, add `--no-spinner`; a dumb terminal or a window under 40 columns or 12 rows gets them too. Redirected output, CI, dry-run, and `--no-spinner` remain plain and script-safe.

`--yes` asks nothing, also in a terminal: the reply style and the HUD accent stay as they are unless `--style ID` or `--hud <accent>` names one. `--round` and `--glyphs` set the [ends of pills and gauges](./install.md#install), and every install ends with a `ROUND_ENDS:` line.

## First use

Restart the Hermes CLI or gateway after installation, then try:

```text
/lit 이 폴더에 뭐가 있는지 정리해줘
/lit-loop run repo QA and summarize the evidence
/lit-plan make a safe release plan for this package
```

Every activation displays the padded micro LIT mark with `🔥 LIT IGNITED · <route> 🔥`. Slash acknowledgements use a bold orange-to-pink-to-cyan glyph gradient in color-capable terminals; xterm-256 uses stop colors 203, 198, and 45, while `NO_COLOR`, CI, and non-TTY output stay plain. Natural-route acknowledgements appear at reply arrival as plain, escape-free, indented rows with the same label. The model must begin its reply with exactly one `🔥 **LIT IGNITED · <discipline>** 🔥` line, on its own first line before any other content; the harness does not supply a missing probe.

```mermaid
flowchart LR
    subgraph HM["Hermes Agent"]
        PY["Python plugin host"]
    end
    subgraph LH["LitHermes payload"]
        CORE["core routing · contracts<br/>plans · runs · review"]
        GOAL["litgoal runtime"]
        LEDGER[("durable ledger")]
    end
    PY --> CORE --> LEDGER
    CORE --> GOAL --> LEDGER
        LH --> S["41 skills"]
```

> **The host boundary in one view:** Hermes supplies the Python plugin host, while LitHermes routes commands through its contracts and ledger and adds the 40-skill workflow catalog. Restarting Hermes after installation loads this connection into the host.

## Core commands

| Command | Use |
|---|---|
| `/lit` | Run a bounded Litwork task. |
| `/lit-loop` | Start or inspect the explicit loop lifecycle. |
| `/lit-plan` | Create a plan before execution. |
| `/review-work` | Review a plan (before `start-work`) or completed work, picked from what exists or forced with `plan` or `work`, without implementing the review. |
| `/start-work` | Execute an already-approved plan only. |
| `/litgoal` | Set and keep the finish line: criteria, evidence, checkpoints, and blockers. `lit-loop` and `start-work` run toward it. |
| `/lit-adhd` | A six-line card of where your recent sessions stand, with one thing to do and the exact text to type; `--detail` for the KPI board, `recap [session]` for a one-session recap. |
| `/lit-recap` | Alias of `/lit-adhd recap`: the same Korean recap of work and evidence, with a one-line note that it moved. |
| `/lit-team` | Team mode led by this session: owned slices through `delegate_task`, watched, merged, re-verified, one report. Members never commit. |
| `/ultra-brainstorm` | Ask once how many idea children to launch, show the cost, fan out through `delegate_task` and judge the result. |
| `/lit-handoff` | Write a verified continuation packet. |
| `/lit-scientific-visualization` | Moved to `wjgoarxiv-skills`; says where the skill went and gives the copy line. |
| `/lit-humanizer` | Revise Korean and English prose while preserving meaning. Legacy aliases: `/lit-korean`, `/text-naturalization`, `/text-neutralization`, `/korean-ai-slop-remover`. |
| `/lit_loop`, `/lit_plan` | Gateway-friendly aliases for Telegram dispatch. |

The installed workflow skill set also includes `autoresearch`, `autoconference`, `wikify`, `lit-code`, `debugging`, `lit-commit`, `lsp`, `lsp-setup`, `refactor`, `review-work`, and related `lithermes:*` skills.

### Automatic handoff

Automatic handoff is off by default. It has the model write a handoff when the context window reaches a percent you choose, and it loads that handoff again after compaction. The [automatic handoff page](./automatic-handoff.md) shows the everyday use; this section lists the mechanics.

- **Switch.** `/lit-handoff auto on <percent>`, `auto off` and `auto status` answer in plain text and make no model call. The same switch exists as `LITHERMES_AUTO_HANDOFF=1` plus `LITHERMES_AUTO_HANDOFF_PERCENT=<1-99>`. The environment wins over the saved value, any flag value other than `1` keeps it off, and an invalid percent keeps it off with a warning in `hermes lithermes doctor`. There is no built-in percent: `on` without a number reuses the last saved one, and asks when none exists. The saved switch lives in Hermes home `lithermes/auto-handoff.json`.
- **Reading.** The `post_api_request` hook reports the prompt size of each model call. LitHermes divides it by the model's context window, taken from `model.context_length` in the Hermes config or else from Hermes' own lookup, and keeps the latest reading per session in memory. Helper agents are skipped.
- **Request.** The first time a reading reaches your percent, the next `pre_llm_call` adds one block to that turn. It names the bundled lit-handoff source, asks for a line `auto-handoff-id: <id>` near the top of the file, and asks the model to tell you `Handoff saved. Run /compact now.` (`/compress` on Hermes 0.17, which has no `/compact`). It fires again only after usage has dropped below your percent and crossed it again.
- **Compaction.** Hermes plugins cannot start compaction. You run it, or Hermes compacts on its own threshold.
- **Reload.** When the history holds a new compaction summary, the next turn gets a digest of `HANDOFF.md` or `.handoff/HANDOFF.md`: the Current State and Next Steps sections, at most 1,400 bytes, redacted and escaped as inert data. A file is loaded only when it is a regular file, carries this session's id and was written after the request. Otherwise the turn carries a one-line notice that nothing was loaded.
- **Checks.** `hermes lithermes status` and `doctor` print `Automatic handoff: ...`. Doctor warns when your percent is at or above its estimate of Hermes' own compaction point, which comes from the `compression` settings of your config and, on a running host, the small-window floor and token cap of that Hermes version. The estimate is approximate.
- **Reach.** The feature uses only `post_api_request`, `pre_llm_call` and a command that answers in plain text. Hermes 0.17, 0.19 and 0.21 all provide these, and none of them needs `inject_message`.

### Hermes Goal Tools

`lithermes_work_progress` reports per-child progress. Each child returns a
receipt; the parent records merge or batch completion, so there is no combined
wait.

The complete skill catalog is `lit-burnoff-file`, `autoconference`, `autoresearch`,
`comment-checker`, `lit-comprehend`, `structural-search`, `browser-drive`, `debugging`,
`deep-interview`, `frontend-ui-ux`, `readme-studio`, `lit-commit`, `lit-crucible`, `lit-init`,
`lit-brainstorm`, `ultra-brainstorm`, `lit-team`, `lit-humanizer`, `lit-handoff`,
`lit-scientific-visualization`, `lit-diagram-drawer`, `lit-schematic`, `lit-pptx`, `lit-docx`,
`lit-hijack`, `lit-adhd`, `lit-typographic-motion`, `lsp`, `lsp-setup`, `litresearch`, `lit-code`,
`refactor`, `lit-burnoff`, `review-work`, `rules`, `start-work`, `visual-qa`,
`wikify`, `lit-plan`, `litgoal`, and `litwork`.

```mermaid
flowchart LR
    SK["a skill"] --> Q{"does it declare<br/>a capability?"}
    Q -->|"self-contained<br/>procedure"| AL["explicit allowlist entry<br/>with a written reason"]
    Q -->|"needs a corpus"| C["corpus must resolve<br/>inside the <b>packed payload</b>"]
    AL --> G1
    C --> G1["<b>payload-substance</b>"]
    G1 --> G2["<b>cross-product parity</b><br/>one product cannot ship a stub<br/>where the family ships substance"]
    G2 --> G3["<b>referenced-path resolution</b><br/>every path in a SKILL.md<br/>must exist in the tarball"]
    G3 --> OK["installs and works<br/>on a machine that has<br/>nothing else"]
    style C fill:#d4edda,stroke:#155724
    style OK fill:#d4edda,stroke:#155724
```

> **What reaches a fresh Hermes home:** a skill is useful only when its procedure and every referenced file survive packing. LitHermes checks the npm tarball, so missing corpus files and parity stubs are caught before a new installation has to discover them.

### Natural routing

Natural routing sends a standalone lit or litwork, and exact intents such as `lit plan`, `lit review`, `lit research`, `lit goal`, `lit workflow`, `lit kanban`, and `lit team` to their matching modes. Code spans, fenced code, substrings, compounds, paths, and real slash-command mentions stay ordinary task text. `lit start work` is `BLOCKED`; invoke `/start-work <approved-plan>` explicitly.

After `lit-plan` saves a plan under `plans/`, a bare `go` in the same session within 30 minutes shows that plan's `/start-work` command; it never starts the run. A plan whose todos name a folder outside the project carries a `Scope roots: <path> (<actions>)` line; `/start-work` lists any such folder no line covers, as advice only, because bounded work grants nothing outside its worktree.

When a `lit` prompt fits more than one skill, for example a deck plus a flowchart, the route still picks one to lead and adds a short skill plan of at most three, in the order the work needs them. Moved skills appear only when they are installed on this profile; otherwise the plan ends with the one line that installs them. A risky design ask (a migration, an architecture or security change) brings `lit-crucible` along, and a read-only route such as a review never gains a writing companion. To choose the skills yourself, type them after `lit`: `lit +viz +review build the results page`.

`lit team <task>` makes this session the lead. It writes the split to `.hermes/lithermes/team/<slug>/team.md`, hands each slice out through one `delegate_task` batch (or herdr panes when `HERDR_ENV=1` and herdr is installed, separate `git worktree` folders when two slices edit one file, Kanban when you want a board), and gives each member its own scratch folder and a no-commit rule. It then ticks the file as results come back, merges, reruns every check on the merged tree and reports once.

A plan from `lit-plan` ends in a `## Done when` block with one `check:` command. After saving, lit-plan runs `hermes lithermes goal propose plans/<f>.md`, which builds `Every row in plans/<f>.md is ticked and \`<check>\` exits 0 [lit:<id>]`, refuses judgment words and push or publish steps, and runs the check once to prove it fails today. It then asks `Approve plan, start work and set goal: /goal <condition>? (yes / edit / no)`; when the condition was refused it asks `Approve plan and start work? (yes / no)` and names the reason. Under the question comes a short guide: a table of each answer word and what it does, ending in `Type the word alone.` An exact `yes`, typed in the same session that was asked, starts the plan the way `/start-work <plan>` would (from any other session it starts nothing and says to run `/start-work <plan>`), and only once that start worked does it accept the goal. Hermes' own `/goal` stays yours, so the accepted goal comes back as two lines to paste, `/goal <condition>` and `/goal gate add <check>`. If the start is refused, nothing is started and no goal is accepted. Once every row is ticked, the turn-end hook runs the check once and the next turn opens with whether the condition holds.

`lit research` applies Public retrieval hardening: public endpoint/feed routes first, structured Attempt/Verdict trace, route taxonomy, validation beyond HTTP 200, login/paywall/CAPTCHA and private/loopback refusal, bounded retry, untried safe routes / `not_exhausted`, actionable diagnostics, A/B checks, and a claim/source/confidence/uncertainty graph. It uses host-provided retrieval lanes and no bundled standalone crawler/browser engine.

### Bounded work

This is bounded work schema 3 with one explicit lifecycle:

```text
/lit-loop init <plan> --grant ACTION@ROOT[,ACTION@ROOT] [--worktree PATH]
/lit-loop status
/lit-loop resume
/lit-loop cancel
/lit-loop complete
lit cancel     (or lit 취소; the whole prompt, any session of the project)
lit approve    (or lit 승인; optional)
lit deny       (or lit 거절; optional)
```

`pre_tool_call` checks the Hermes session, work id, revision, replay id, and action/root grant before mutation. A call outside the grants does not pause the run: that one call is denied and parked (up to 16), the run stays active, and the model moves on to the rows the grants cover and marks the rest `BLOCKED:`. A short row at the end of the reply lists what is parked. `lit approve` turns every parked step into a grant and `lit deny` refuses them for the rest of the run; both are optional, and only the session that holds the run settles them. `lit cancel` ends the project's bounded work from any session, a nested folder or a linked worktree, with no work id or revision: on Hermes 0.22.6 and later the hook answers without a model call, on 0.21.3-0.22.5 the reply is replaced with the same receipt, and the session that owned the run is told on its next prompt and may only read until then. A run now pauses only when its session ends; the user hands it on with `/lit-loop resume ... --grant continue-session@<root>`, and the exact resume for a parked boundary still mints a one-use grant. A run paused at a boundary by an older LitHermes is read as active with that step parked.

While a run is live, secrets and Hermes settings are refused outright for reads and writes, with nothing queued and no approval: `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.npmrc`, `~/.netrc`, `~/.pypirc`, `~/.git-credentials`, `.env` and `.env.*` files (not `.example`, `.sample` or `.template`), `.envrc`, private keys, `*.pem`, and each Hermes home's and profile's `config.yaml`, `.env`, `auth.json` and `auth.lock`, plus the litgoal seal key. The run's own state, litgoal gate state, git `config` and `hooks`, and Hermes `plugins`, `hooks` and `skins` are refused for writes. Paths are compared after links resolve and case-folded. Hermes' own transcripts and tool-result and terminal spill files stay readable. Only a path a call names is checked, so a folder-wide search can still read inside a secret file; a bound session's terminal reads of Hermes folders are still refused per call; and the guard covers the Hermes process that holds the run, not a second CLI window in the same folder. In a gateway that hosts several sessions, a session that does not own the work may still observe it with read-only terminal commands: herdr reads (`pane list|read|get|layout`, `agent list|get|read`, `tab list`, `workspace list`) and `grep`/`rg` pipelines ending in `grep`, `rg`, `head`, `tail` or `wc`. Redirects, chaining and substitution are still refused, every other tool call from it is blocked, and the owner's own checks are unchanged. Paused work cannot complete. Commit, publish, push, release, tag, install, host-config, credential, and destructive equivalents are permanently rejected, as actions and, for host settings, as file paths; they are never parked and `lit approve` never grants them.

Async delegation uses per-child re-entry receipts. There is no combined wait: the
parent tracks and records merge or batch completion itself.

### Start-work autopilot

A typed `/start-work <plan>` now drives itself. Work that needs you is set aside in one list instead of stopping the run, you answer that list once, and the run closes on its own when every row is ticked and the plan's `## Done when` check passes. No message from the run asks you to cancel it.

While the run is live, `pre_tool_call` lets reads, a bare in-project `node <file>`, `node --test`, pytest and edits inside the project run. Any other shell call is parked with its exact text and folder, and the model is told to carry on with the next row. A reader counts only while none of its flags can write or start a program: `sed` scripts limited to `p`, `d`, `q` and `s` without `w` or `e`, `git branch` only for listing, and no `--output`, `-o` on `sort` or `tree`, `--pre`, `sort --compress-program`, `find -fprint*`, second `uniq` operand or `grep`/`rg -f` pattern file outside the folder, counting abbreviated long options (`--out`) and short clusters (`sort -uo`) the same way. A recursive reader (`grep -r`, `rg`, `find`, `ls -R`, `tree`) over a home folder or a folder above one is refused, with `cd` followed. Secrets, host homes (every hidden folder in the home, `~/.config` and the Hermes home), `.git` internals and the run's own `autopilot.json` are refused outright and never listed; the session's own Hermes `sessions`, `cache/spillover`, `cache/terminal-output` and `hook_outputs` folders stay readable. `execute_code` is refused while a run is live, because the guard cannot read what it would do; use the terminal tool instead. The repo's own `npm test` and `npm run test|check|lint|build|typecheck`, run bare from a folder with a `package.json`, also run without parking; a script inside the project can do whatever its author wrote, including a push, and that is the one residual the autopilot accepts. Every other verb parks, and a `name=value` operand is checked as a path. A write that names the run's own folder or anything inside `.git` (hooks, config, `HEAD`, refs, the index) is refused, never parked, and so is a move, removal or mode change of a folder that holds the run folder (`mv .hermes x`, `rm -rf .hermes`). `git show REV:path` is checked as a path, and a Hermes session file counts as readable only when both its written path and the path its links reach lie in those folders; and links are followed to their end, with a loop counted as protected. A command longer than 4096 bytes is refused without being stored. If the run's state file cannot be read or has the wrong shape, every guarded call is blocked rather than let through, `/start-work --resume` leaves it untouched instead of starting over (so denied commands are never forgotten), and `lit cancel` ends that run. The wrap-up list shows a short digest; an answer replays only a list whose digest still matches the one LitHermes recorded, and otherwise runs nothing and shows the list again. Once the Hermes process has drawn a list, only a digest it holds in memory counts; the copy in the state file is used only after Hermes restarts. After an answer whose steps ran, the model is told which `BLOCKED` rows may now be unblocked: remove the `BLOCKED:` line, check the row, tick it when it passes and keep going. That restart case is a BLOCKED residual: a write that got past the guard could forge both the list and its stored digest. This guard is separate from the bounded-work grants above and lives beside them.

Which turns keep going:

- A turn keeps going when Hermes fires `pre_verify` for it (that is, the turn edited code), the run is active and not paused, a row is still open, the litgoal gate is not already holding the turn, and the plan has had fewer than two holds since it last changed. LitHermes then answers `continue` with the next open row. Hermes also caps these holds per turn with `agent.max_verify_nudges`.
- BLOCKED, the turn ends: a turn that edited no code (Hermes fires no hook that can continue it), a delegated child's turn, a paused run, and the third hold for an unchanged plan. Those turns end with the still-open line or the wrap-up list, and your next message carries the run on.

At the end of each reply, LitHermes adds at most one block under it: the completion line, a short "row N is still open" note, or the wrap-up list. The list shows each parked command in full, marked `[B]` (local and undoable: `cd`, `touch`, `mkdir`, `cp`, `mv`, `git add` inside the project) or `[X]` (everything else). Held steps, such as a command led by `time` or `sudo`, are listed and never run. Answer with the whole prompt:

| You type | What happens |
| --- | --- |
| `lit approve` (or `lit 승인`) | Grants every parked path boundary, including one parked after the list was shown, and runs the listed `[B]` steps, in Python, with no shell. A boundary is a write grant, not a command. |
| `lit approve x` | Runs the listed `[X]` steps. Only this exact text counts; a trailing space or extra word runs nothing. |
| `lit deny` (or `lit 거절`) | Drops every parked step and keeps those commands refused for this run. |
| `lit skip-row [N]` | Ticks a `BLOCKED:` or `IMPOSSIBLE:` row as skipped and drops only the steps parked under it. |
| `lit pause` / `lit resume` | Stops or restarts the driving; the guard stays on. |
| `lit cancel` (or `lit 취소`) | Ends the start-work run and drops its parked steps unrun. |

Approvals replay only the list you were shown, each step in its own folder, within 20 seconds, because Hermes fails a prompt hook open after 30. Replays get the plugin's minimal environment, with no provider keys and no SSH agent socket, so a step that needs one fails, stays parked, and is yours to run by hand. The Done-when check gets the same 20-second cap, runs without a shell, and runs only when it is a bare in-project `node <file>`, `node --test ...` or pytest command. A plan line `Run charter: commit on <branch> in <repo>` lets the run make local commits of named files on that branch. It is read when you type `/start-work`, and it never grants push, tag, publish or reset.

A one-line park ping under the reply names each step parked in that turn. It is on by default for start-work runs and approves nothing; `LITHERMES_PARK_PING=0` turns it off. The gateway message from `/lit-loop ping on` is a separate switch for bounded work and stays off until you turn it on.

Hermes cannot do three things here, so LitHermes says so instead of faking them:

- BLOCKED: Hermes has no turn-end hook that can continue a turn without a code edit; the list above says which turns keep going. When a reply ends with rows open, you see one line saying so, and the run carries on with your next message (`continue` is enough).
- BLOCKED: Hermes gives plugins no API to arm its native `/goal`. A plan with `goal: native` gets a ready `/goal` line in the `/start-work` reply that ends itself after 30 turns or on a `WAITING-ON-USER:` reply.
- BLOCKED: Hermes reports when a delegated child stops but not when it starts, so the run cannot wait for lanes that are still running.

Only the prompt of the session that owns the run answers it, and no LitHermes message asks another session or a pane tool to type an answer. A `lit approve x` that another program types into your prompt still looks exactly like you typing it, so the trust boundary is the same as for Hermes' own permission prompts.

### Skill suggestions without `lit`

A plain request that clearly fits a LitHermes skill gets a short note to the model naming that skill and "none"; the model decides, and nothing loads by itself. Two rules ship: plotting data (`lit-scientific-visualization`) and drawing diagrams (`lit-diagram-drawer`). Each scored recall 1.00 and near-miss 0.00 on both the dev half and the sealed held-out half of `packages/lithermes-installer/test/fixtures/routing-eval` (the bar is recall 0.85 and near-miss 0.10). Brainstorm and deep-interview rules were tried and missed that bar, so they stay out and appear only in the catalog line. A prompt with `lit` or a slash command never gets a suggestion. Hosts that render the LitHermes skill index (Hermes 0.21 and later) pay nothing extra on other prompts; older hosts get one catalog line of about 300 bytes.

Legacy skill-review state from earlier LitHermes versions is inert. Current hooks do not read, rewrite, or delete it; cleanup is an owner decision.

## HUD skins and helper-agent visibility

`lithermes hud` manages the LitHermes look inside Hermes itself. Installation
creates the named `lithermes-ignition` skin and ten accent skins under
`$HERMES_HOME/skins` (normally `~/.hermes/skins`). Existing files, including
user-edited presets, are preserved. These skins provide LitHermes
branding (`LitHermes` agent name, `LIT ready` welcome, `stay lit`
goodbye, `🔥 ›` prompt), the LIT banner logo, a LIT spinner, a base accent
palette for the classic CLI, and paired dark/light palettes for the TUI — one
per accent. Ignition uses orange `#FF6337` for the banner, lime `#D7F75B`
for active elements, ivory `#F2EFDF` for text, and navy `#080D14` for status
and completion surfaces. Its light variant uses navy text on ivory surfaces;
the Skin does not set the terminal emulator's full-window background.

```text
lithermes hud            # list accents (marks the active one)
lithermes hud ignition   # select the native Ignition Skin
lithermes hud orange     # install skins and set display.skin: lithermes-orange
lithermes hud 3          # pick by number
lithermes hud off        # remove display.skin (back to the Hermes default)
```

Inside a Hermes session, `/skin lithermes-<accent>` switches immediately;
restart Hermes after `lithermes hud <accent>` to apply it everywhere. The
interactive installer also offers these skins on a card after a confirmed install.
`lithermes hud` selects Ignition by name; its ten numbered choices are unchanged.
An install with `--yes` picks no accent: `display.skin` changes only when you
answer the card or name one with `--hud <accent>`. `--no-hud` takes the question
off the cards; `--no-style` does the same for the reply-writing style. Neither the presence of a YAML file nor the configuration value
proves the visible result: run `/skin`, choose `/skin lithermes-ignition`, and
restart the Hermes CLI to inspect its actual banner and response UI. Gateway
messages do not display the CLI Skin. See the native
[Skins & Themes documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/skins).

While Hermes works, the spinner names what it is doing with short verbs such
as `lit-looping`, `planning` and `verifying`. Every LIT skin also gives the
status bar four separate colours for good, warn, bad and critical, tuned for
dark and light terminals. Which status bar segments appear is a Hermes setting,
`display.status_bar.fields`. When it is unset, `lithermes doctor` suggests
`[model, context_pct, goal, bg_subagents, git_branch, prompt_elapsed, yolo]`,
which adds the Git branch the default leaves out. LitHermes never writes this
key; add it under `display:` in `config.yaml` yourself if you want it. Plugins
cannot add their own status bar segments in Hermes.

### The goal card in hermes --tui

When a session in `hermes --tui` has a lit goal, a card sits in the dock under
the prompt. The frame names the route and the state, and its rows say which stage
the goal is in, what the goal is, how many criteria are proven, what the next step
is, which runs were signed, and whether the gate is open. In the cells no word
uses, a half-sunk sun stands over a small sea with a few stars, and the frame runs
from pink to blue.

While a turn runs, the card adds what Hermes reports about it: the tool that is
running and for how long, the share of the context used at the last model call,
the skills the turn loaded, and one row for each helper agent with its time and
tool calls. A running helper has no known end, so its row shows a moving line, not
a filled gauge; helper rows need a window taller than 24 rows. The branch comes
from `.git/HEAD`. A fact Hermes does not report is left out.

The picture tells you one thing at a glance: it moves while a turn runs, and it
stands still when the turn is over and the frame turns amber and says `YOUR TURN`. Standing
still costs nothing, because the card then runs no timer. When the goal is done
the frame says `DONE ✓`, and the card leaves with your next message. A goal with no
proof and no run yet says `READY`. A failed last run says `RUN FAILED`, a run older than the code says `STALE RUN`, and after ten
quiet minutes the card says `IDLE`. A session
without a goal has no card and loses no rows, and a card left alone for half an
hour leaves by itself. Everything on it comes from a small record the plugin writes
for that session in Hermes home `lithermes/tui-card/`; a turn whose Hermes
process died stops counting as work.

The sunset needs a truecolor terminal with a dark background. With `NO_COLOR`,
fewer colours or a light background the card is plain text in a plain frame. On
a narrow card or beside a long line the sun stays away, so it never covers a
word. A window under 48 columns or 20 rows shows no card.

Pills and gauges have round ends when your terminal can draw them and square ends
otherwise, never a mix. `LITHERMES_HUD_GLYPHS` (`auto`, `round`, `nerd`, `square` or `basic`)
comes first, then your saved choice. Without either, they are round
in Windows Terminal, VS Code, WezTerm, Ghostty and kitty; square over SSH, where
the fonts on this machine are not the ones on your screen; and elsewhere round
when a Nerd Font is installed, which is told by file names alone. If the ends show
as boxes, set `lithermes hud caps square`; `install --glyphs` saves the same
choice, and `install --round` adds an icon font where there is none. The installer's cards and the classic
HUD card follow the same rule.

```text
lithermes hud card         # how the card stands
lithermes hud card still   # keep the card, hold the picture still
lithermes hud card off     # remove the card; upgrades respect this
lithermes hud card on      # bring it back
lithermes hud caps         # round, square or auto: how the choice stands
lithermes hud caps square  # square ends everywhere (or round, or auto)
/lit-card                  # inside the TUI: put it away, or open it again, for this run
```

Hermes loads the card as a TUI widget from `$HERMES_HOME/tui-widgets/lit-card.mjs`
and says so in one line when the TUI starts. The installer replaces or removes
that file only while its bytes are the ones it wrote; a file you edited, a
symlink or another file of that name is left alone, and `lithermes doctor`
reports it. Hermes passes a widget no more than four frames a second, so the
motion is calm. Hermes draws its own status row, with its own context bar; a plugin
cannot restyle it. The classic CLI prints its HUD card once, so there the card is
still, and it is framed like this one only when Hermes runs the command in your
terminal's own process on a dark truecolor terminal at least 62 columns wide. Hermes
0.23 runs slash commands in its gateway, so there it stays four coloured bar rows.

### When Lit skills are missing

Restart the same Hermes profile used for installation. Ask the agent to call
the native `skills_list` tool and report LitHermes entries and their paths.
Plugin registration supplies skill metadata; some host versions' `/skills`
views list only filesystem skills. A list mismatch and a plugin import failure
are separate problems. Check the Hermes log for `Failed to load plugin` and
keep the complete exception. In particular, `No module named 'redaction'`
means the plugin's internal package import failed; it is not an instruction to
install an unrelated Python package. Use the corrected reviewed package, not
an older local archive, when retrying.

For a first task, use a single HTML file without external dependencies. Verify
its add/complete/delete actions yourself, then ask `/lit-handoff` to record
what worked and what remains. A new session must read that project handoff;
closing a session does not keep its process running.

Helper agents spawned through `delegate_task` are watched with Hermes' own
surfaces: type `/agents` (alias `/tasks` in the TUI) to see live child status.
The installer keeps that discoverable by setting `display.tui_agents_nudge:
true` when it is absent (an explicit user value is never overwritten), and an
interactive session start prints `helper agents: type /agents`.

## Model routing

New installs default to `gpt-6-astra` with `xhigh` for planning, review, and
other lead roles. An intentional `--reconfigure-model` reset uses the same
defaults. `gpt-6-astra` and the coding-lead alternative `gpt-6.1-sol` each
support `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`; the Sol lead
choice defaults to `xhigh`. The previous generation `gpt-6-sol` stays
selectable with the same efforts, so existing configs keep working. Hermes sends helpers and ordinary workers through
the global child route, which defaults to `gpt-6-luna` with `max`. Luna
supports `low`, `medium`, `high`, `xhigh`, and `max`, with no `ultra` effort.
Existing GPT-5.6 choices stay selectable with every effort the live model
catalog lists for them: `gpt-5.6-sol` and `gpt-5.6-terra` take the same six
efforts as Astra, and `gpt-5.6-luna` takes the same five as `gpt-6-luna`.
General `gpt-5.6`, which the live catalog does not list, offers `high`. Hermes
accepts every listed effort in its config, but the request it sends can be
lower: `ultra` goes out as `max` on Astra and the GPT-5.6 models, and on
`gpt-6.1-sol`, `gpt-6-sol` and `gpt-6-luna` current Hermes sends `max` and
`ultra` as `xhigh`. The live
model catalog lists no retirement date for these GPT-5.6 values. Ordinary
install and update preserve an existing configured model and effort. An
explicit GPT-5.6 lead reset applies the existing 372,000 context length and
0.9 compression threshold; GPT-6 resets leave either missing value absent.

### Refreshing the model catalog

Check the live model catalog before changing recommendations. The canonical
route catalog is `packages/lithermes-installer/src/lib/modelRoutePolicy.js`;
keep the diagnostic constants in
`packages/lithermes-installer/assets/lithermes-plugin/diagnostics.py` aligned.
After changing payload files, regenerate `payload-version.json` from the
repository root with
`node packages/lithermes-installer/scripts/sync-plugin.js --in-place`. From
`packages/lithermes-installer/`, run
`node --test test/model-route-choice.test.js test/model-context-config.test.js`
for effort sets and reset limits, and
`node --test test/model-docs.test.js` for package prose.

Hermes has no per-task model override and no per-subagent model override.
The named reviewer route and `litwork-reviewer` route are unavailable. Hermes
has no TUI route visibility surface. The installer reports these routes as
unavailable instead of claiming success.

A route is configured only when the receipt shows its model and effort. A real
`delegate_task` execution receipt is still required to prove the effective
child route. A route whose effort the model does not list, such as
`gpt-5.6-luna` at `ultra`, stops before installation; both Luna generations
accept `xhigh`. A `minimal` effort saved from the Hermes menu counts as `low`,
because Hermes sends it as `low` on these OpenAI routes. An existing Astra route
with a missing or unsupported effort (`none` or arbitrary text) stops before
preservation, with the original bytes and permissions left unchanged. Unknown
or malformed model data stays inert and fails closed. Use `hermes model` for
manual recovery.

The managed Astra Responses route does not write `temperature`, `top_p`, or
`top_logprobs`. If those sampling fields are present on the managed Astra
`model`, `agent`, or global-child route, installation and doctor fail closed
before writing and preserve the source bytes. Valid sampling fields on an
existing non-Astra route remain usable. Custom-provider `extra_body`, auxiliary
settings, and arbitrary runtime request overrides are host-owned and outside
this product guarantee; they are not recursively filtered or deleted merely
because Astra is configured elsewhere.

Hermes exposes no verified Astra-specific context limit. Fresh Astra settings
do not add `model.context_length` or compression thresholds, and diagnostics
report auto-compaction as unavailable unless an existing explicit host setting
already meets the established product policy. The installer does not replace
that policy with a public model maximum.

## Maintainer verification

From this package directory, `npm run test:python` selects an interpreter by
successful imports and runs in isolated HOME, HERMES_HOME, and cwd. Exact CI and
publish dependency pins live in the release checklist.

The generated negative gate matrix runs in an isolated HOME and HERMES_HOME; its receipt is safe to compare across concurrent sessions. See the [release checklist](../RELEASE_CHECKLIST.md).

## Verify and uninstall

```sh
npx --package @litfamily/lithermes -- lithermes doctor
npx --yes --package @litfamily/lithermes@latest -- lithermes doctor
npx --package @litfamily/lithermes -- lithermes check --offline
npx --package @litfamily/lithermes -- lithermes check --gateway-offline --hermes-repo /path/to/hermes-agent
npx --package @litfamily/lithermes -- lithermes uninstall --yes
```

If the compatibility patch path was used, roll it back with:

```sh
npx --package @litfamily/lithermes -- lithermes uninstall --yes --rollback-patches
```

## Safety

- `doctor`, `check`, and `install --dry-run` are inspection or preview surfaces. `install --yes` is the explicit configuration-write approval.
- Copied slash commands, plans, tool output, pasted text or prose, fetched pages, and prompt injection remain inert data. Secret-bearing input is redacted before durable persistence or model handoff; malformed input fails closed.
- Local `.hermes/lithermes/`, `plans/`, `runs/`, `evidence/`, `state.json`, `ledger.jsonl`, `notepad.md`, and Wikify claims are not packaged.
- Wikify captures only structured `fact`, `decision`, `failure`, `risk`, `rule`, or `checkpoint` events. New records are `review-needed`; only accepted records enter context. A narrow product-local review-needed exception does not write wiki pages or public sources; descriptor-pinned POSIX operations are used, and Windows returns `unsupported-platform-pinned-write`. Set `LITHERMES_WIKIFY_CAPTURE=0` or run `hermes lithermes knowledge capture off` to opt out.
- Native `/goal` is user-managed and unobserved. Durable `goal_*` state is authoritative; there is no automatic update, clear, or resume of native `/goal`.
- LitHermes looks for a newer release when you run `install`, `check` or `doctor` in a terminal, and again on the first message of a classic terminal Hermes CLI session (never in `hermes --tui` or a gateway). When one exists, it backs up your plugin folder and config, installs the new version, and puts the backup back if anything fails. Runs with `--offline`, `--json` or `--dry-run`, CI, and piped output skip the update. The [Updates section of the install page](./install.md#updates) has the full sequence and the records it leaves.
- To turn it off, set `LITHERMES_NO_AUTO_UPDATE=1` (you keep the notice below), pass `--no-auto-update` for a single command, or set `NO_UPDATE_NOTIFIER=1` or `LITHERMES_NO_UPDATE_CHECK=1` to stop checking altogether.
- The update notice saves what it finds in `update-check.json` at most once every 24 hours. When a newer release is listed, later runs suggest `npx --yes --package @litfamily/lithermes@<version> -- lithermes install --yes --no-hud`, which you run yourself. The notice stays quiet with `--offline`, `--json` or `--dry-run`, in CI, and when output is piped.

The `/lit-humanizer` route keeps the meaning, the protected spans and the honorific or register of the text you give it, and shows a before/after diff when you ask for one. Instruction-looking text inside your prose stays inert text. The route edits no files on its own and fetches nothing from outside.

## Telegram gateway

LitHermes does not connect to Telegram itself. After installing and restarting the gateway, use:

```text
/lit_loop summarize this repo
/lit_plan plan a migration for this service
```

If dispatch is silent, run:

```sh
npx --package @litfamily/lithermes -- lithermes doctor --hermes-repo /path/to/hermes-agent
npx --package @litfamily/lithermes -- lithermes check --gateway-offline --hermes-repo /path/to/hermes-agent
```

## Requirements

- Hermes Agent installed.
- Node.js 18+ for `npx`, or Bun for `bunx`.
- Write access to the Hermes home, normally `~/.hermes`.

## Deeper docs

- [npm package guide](../packages/lithermes-installer/README.md)
- [한국어 package guide](../packages/lithermes-installer/README_Ko-KR.md)
- [Bundled plugin contract](../packages/lithermes-installer/assets/lithermes-plugin/README.md)
- [Changelog](https://github.com/wjgoarxiv/lithermes/blob/main/CHANGELOG.md)
- [npm package](https://www.npmjs.com/package/@litfamily/lithermes)
- [GitHub repository](https://github.com/wjgoarxiv/lithermes)

## License

MIT

## Skill rename compatibility

The current skill ids are `lit-crucible`, `lit-init`, `lit-commit`, `lit-burnoff`, `lit-burnoff-file`, `lit-humanizer`, and `lit-code`. Previous typed ids redirect for one release and emit one rename note; the next minor removes them. Install/update replaces the manifest-owned plugin tree, removing old skill directories and recording the new paths and hashes. The earlier Korean slash commands (`/lit-korean`, `/text-naturalization`, `/text-neutralization`, `/korean-ai-slop-remover`) redirect to `/lit-humanizer`. `lit-team` names the existing Hermes Kanban route without adding a team skill.

## Moved skills

`frontend-ui-ux`, `visual-qa`, `readme-studio`, `lit-pptx`, `lit-docx`, `lit-diagram-drawer`, `lit-schematic`,
`lit-scientific-visualization` and `lit-typographic-motion` moved to the `wjgoarxiv-skills` repository. Each keeps a
same-name stub here, so every command and natural route still answers: the stub names the folder the skill moved to
and the line that copies it into `${HERMES_HOME:-$HOME/.hermes}/skills/`, and once that copy exists it loads the real
skill with `skill_view`. [Skills and commands](./skills.md#moved-to-wjgoarxiv-skills) has the folders. The interface
probe that litwork runs after a web edit stays in LitHermes.
