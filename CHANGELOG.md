# Changelog

All notable changes to LitHermes are documented here. Older entries are kept as
neutral summaries so release history remains useful without carrying retired
identity or source-provenance tokens in tracked files.

## [Unreleased]

## [1.0.31] - 2026-10-28

- After `lit-plan` saves a plan, type `go` in the same session within 30 minutes and Hermes shows the `/start-work` command for that plan. It only shows the command; it never starts the work for you.
- When a plan step touches a folder outside the project, `lit-plan` asks for a `Scope roots: <path> (<actions>)` line, and `/start-work` lists any outside folder no line covers. On Hermes this is a reminder only: bounded work still writes only inside its own worktree.
- While one session owns bounded work in a gateway, other sessions there can now run read-only commands, such as `herdr pane list` or `grep` and `rg` searches. Anything that changes files is still refused for them.
- The `lit-adhd` brief now opens with three lines: what is done, what is in progress, and what comes next. Plans with every box ticked and finished start-work runs count as done, only plans changed inside the time window are read, skipped plans are named, and the `## Next` item in this worktree's HANDOFF.md is used when nothing else suggests a step. In a linked worktree, the brief reads that worktree's own state.
- The repository now has a short `TRADEMARK.md`: the code is MIT, while the LitHermes and LitFamily names and logos are not part of that licence.

## [1.0.30] - 2026-10-27

- New `lit-schematic` skill for drawings of real equipment: detailed P&IDs with ISA tags and control loops, PFDs and layouts, apparatus figures for papers and isometric cutaways, saved as editable SVG with PDF and a 600 dpi PNG and checked by a QA gate before delivery. Ask for one by name, with `/lit-schematic <brief>`, or in a `lit` request. Abstract boxes-and-arrows stay with `lit-diagram-drawer`, and plots of measured data stay with `lit-scientific-visualization`.
- Diagrams and scientific figures are now rich by default: denser diagrams with a few colour families tied to roles, and figures with a light grid, direct labels, insets and multi-panel context.
- New `lit-adhd` skill (also `lit-rewind`) gives a short brief across your recent Hermes sessions, plans, goals, handoffs and git history, with progress gauges and one suggested next step. It only reads; finished sessions fold into a short table. Run it with `/lit-adhd`, `/lit-rewind` or `lit adhd`, and answer a bare `go` within 30 minutes to take the suggested step.
- New `lit-hijack` skill turns published know-how into a skill of your own without copying it: it records where the material came from, checks the licence, writes a spec free of source text, builds through `delegate_task` and proves the result matches. Run it with `/lit-hijack <brief>` or `lit hijack`.
- `lit-pptx` adds five looks (computational brutalism, neo-brutalism, Bauhaus, risograph and newsroom), each with its own sheet and example deck. `frontend-ui-ux` ships a component kit and a design lock, and its probe flags pages that drift from the locked fonts, colours and spacing.
- Design skills (`lit-pptx`, `frontend-ui-ux`, `lit-schematic`) now ask which look you want before they build, with the recommended choice first. Name a look in the request or say "you choose" to skip the question; non-interactive runs take the recommendation.
- The motion skill gains house styles, a storyboard board you can review before the full render, a layered original score and a reading-time check that no longer fails a line for its exit slide.
- Security fixes: web fetches in `lit-hijack` and the motion font loader follow redirects only to public addresses, cap size and time, and connect to the exact address that passed the check, so a name that changes its answer mid-request cannot reach a private host. The session brief removes secrets before shortening lines, strips terminal control codes, and its state files refuse symlinks.
- The README shows a gallery of real output: a P&ID, a session brief, a deck slide and a landing page.

## [1.0.29] - 2026-10-26

- The README studio's HyperFrames and Remotion templates pin newer `hono` and `fast-uri` in their lockfiles, picking up upstream fixes. A fresh template setup installs these versions; nothing else about how the skills run changes.

## [1.0.28] - 2026-10-22

- Typing `lit` again in the same session now continues the active mode instead of starting over. The first `lit` still sends the full activation; the next ones send a note under 600 bytes and open no new run, plan file or goal. `lit plan` while a loop runs switches with the full plan activation, a bare `lit` continues the active mode, or with none active resumes an unfinished start-work run or bounded work, and `lit new ...` or `lit restart ...` starts fresh. A bare `lit` with nothing active now asks what to start. After a context compaction the full activation is sent again.
- Film renders need `lithermes motion-runtime install` once after you update. The motion runtime's pinned fonts changed, so the cache from an earlier release no longer matches and `cover` and `stage` renders stop with exit 14 until it is warmed again. `lithermes install` and the automatic update warm it for you; run the command yourself if the install reported `pre-warm incomplete`.

- Add `lit-brainstorm` for shaping a request before planning, clearer goal checks and separate plan and finished-work reviews. A lone plan now receives a plan review.
- Make seamless animated covers with `cover`, including decoded-file checks and a choice of any machine as the hero. Cover contract errors now stop before the browser starts.
- Fix Windows npm launches, preserve failed document-command exit codes and find `ffmpeg.exe`. Office and motion audio choose a supported Python; audio dependencies now support Python 3.13 and 3.14.
- Expand the prose guard's tested pledge cases and refresh the README covers for the seven-member family.

## [1.0.27] - 2026-10-19

- The humanizer now catches a paragraph that explains a number or a thing only by saying what it is not, such as `18,420회는 주민 수가 아님. 고유 방문자 수도 아님.` When one paragraph, list or table column holds two such Korean negations, or three in any language, `write_file` and `patch` refuse the write and say how to rewrite it: state what the thing is first, then give a needed caveat once. Rewordings such as `~로 읽을 수 없음` and `does not mean` count the same. Exactly two that are not both Korean only draw a `negation-cluster` warning, and the write goes through. Code, inline code and `>` quotes are skipped, so a bad example you need to show can sit there. A plain `~와 다른` no longer counts; only the contrastive `~와는 다릅니다` does.
- A `patch` edit is now judged against the file as it will read after the patch, so an edit inside a code fence is allowed and two edited paragraphs are read as separate blocks. A long-standing pledge line elsewhere in the file no longer blocks an edit that does not touch it.
- Reader files outside the working directory are checked when they sit inside the folder Hermes was launched from or its git repository, and relative paths follow the directory a terminal `cd` moved the session to. Host settings, memory and scratch notes outside that project are still left alone.
- A flood of findings can no longer hide a refusal: the guard caps its warnings and its output size, and a write that would produce too many blocking findings is refused rather than let through.

## [1.0.26] - 2026-10-18

- The English and Korean READMEs are rewritten around what a reader gets from `lit`: a quicker start, who LitHermes is for, and a sketch of a real session. The pictures are unchanged.
- `hermes lithermes doctor` drops its leftover note about the retired skill hint and no longer looks for files it once wrote. The test that no external skill-hint service is called and no switch for one is read stays.
- `lithermes doctor` no longer fails after you use Hermes. Hermes writes Python import caches (`__pycache__/*.pyc`) into the installed plugin, and doctor reported each one as an unexpected file until you deleted them. Caches for modules LitHermes ships are now expected; any other file in the plugin folder, including bytecode for a module LitHermes does not ship, still fails the check. Uninstall now removes those caches too, so a later install no longer finds a leftover plugin folder.

## [1.0.25] - 2026-10-18

- A failed automatic update no longer slows every new session. When npm could not fetch the new release, each new Hermes CLI session waited about 70 seconds on its first reply and tried again the next time. After a failed install the same release now waits 24 hours; a newer release ends the wait. Each first-turn check is recorded in `auto-update-attempt.json`.
- A route saved with `minimal` reasoning effort no longer blocks automatic updates. Hermes sends `minimal` as `low`, but the installer refused it with status 10 on every update, so the user stayed on the old version. The installer and the plugin diagnostics now read `minimal` as `low`; `none` and unknown efforts still stop the install.
- `hermes lithermes doctor` gains update lines: the installed version and how it arrived, a gateway that started before the install and needs a restart, the last check with one remedy per cause, and a note that it cannot see what a running Hermes has loaded.
- Each lit route now fits in what Hermes shows the model. A lit turn used to send about 100 KB, so the model saw only the route's first line and the run's ledger path, goal gate and workspace rules never arrived. The litwork route is now one block under 4,000 bytes, ordered by importance, and lit-plan and litresearch load their skill through `skill_view` instead of inlining it. Slash commands are unchanged.
- The model can now pick a LitHermes skill for a plain request. Hermes leaves plugin skills out of its own skill list, so a plain request such as "find out why the save hangs and fix it" never loaded `lithermes:debugging`. Each new session now carries a short list of every LitHermes skill in its system prompt, with the `skill_view` call that loads one. The `debugging`, `review-work`, `litwork` and `litresearch` entries now say when to use them. Hermes releases without plugin prompt sections still load each skill by name, as before.
- The optional Jev skill hint is removed. In testing it did not change which skill the model used, so it no longer sends prompts to TypeSafe, adds a hint line or prints a banner, and status no longer reports it. `LITHERMES_JEV`, the other `LITHERMES_JEV_*` settings and `TYPESAFE_API_KEY` are now ignored, and you can delete them. Files an earlier release wrote under Hermes home `lithermes/jev-*` are not used any more; `hermes lithermes doctor` mentions them once as safe to delete and leaves them in place.
- New tests cover update, install and write-hook paths that a deliberate break used to leave green.

## [1.0.24] - 2026-10-17

- The pledge rules catch more of the lines that tell a reader what a document is not for, such as `This table is not a ranking.` or `이 문서는 제품을 비교하려는 것이 아닙니다.` These forms came from real sessions. Bold-label callouts such as `> **주의:** ...` are now read too; ordinary quoted text is still skipped, and lines from manuals and lab reports that only look similar stay allowed.
- A report that a script writes from a terminal or `execute_code` call is now checked after the call. Hermes cannot block at that point, so the model gets a warning naming the rule and the line, and is asked to rewrite it.

## [1.0.23] - 2026-10-15

- A report or deck no longer fills up with lines that tell the reader what the document is not for. When the model writes a sentence such as `동일 조건의 독립 성능 비교로 쓰지 않음.` into a Word, PowerPoint or other deliverable file, LitHermes refuses the write and the model rewrites the line. Three new rules cover Korean sentences that pledge about the document itself, the same disclaimer repeated, and the English forms. Legal and financial notices, safety warnings and real negative findings are left alone, and the rules still finish in milliseconds on a very long run of spaces.
- The lit-docx and lit-pptx skills now ask for a real limit once, written as a fact about the data beside the number it affects, such as `샘플은 한 공정 조건만 포함한다`. Anything about what the document is not for belongs in the reply, not in the file.

## [1.0.22] - 2026-10-13

- The README demo film is new. It follows one real Hermes session: `lit plan` writes the plan and the reply ends with the workflow map at PLAN, `/start-work` loads the test-first and verification skills, runs the new tests red, fixes the code and runs them green, and `lit recap` closes with the map showing plan, work, review and done all checked.

## [1.0.21] - 2026-10-13

- While a plan is being worked through, a LIT reply now ends with one line that shows where the work stands, for example `🔥 LIT · lit-loop — 📝 plan ✓ › 🔨 WORK ▰▰▰▱▱▱▱ 3/7 › 🔍 · › 🏁 ·`. LitHermes reads it from the plan, the run and the litgoal criteria saved in the project, leaves out a step that has nothing saved for it, and never puts a file name or a command in it. A terminal that cannot draw the LIT mark does not get the line either.
- The LitHermes skins now turn their spinner in flame faces, such as `(🔥 lit)`, while Hermes works. Installing again upgrades a skin only when its spinner is still exactly what an earlier release wrote; a spinner you edited, and the rest of every skin file, stay as they are.
- Hermes can ring the terminal bell when a turn finishes, and the installer now offers it. It stays off unless you add `--bell` or answer yes when an interactive install asks; `--no-bell` skips the question, and a `display.bell_on_complete` value you already set is kept. When `config.yaml` does not parse, or the edit would touch anything else, the file is left unchanged and the installer tells you how to set it by hand.

## [1.0.20] - 2026-10-12

- The GitHub README now walks through automatic handoff: how to switch it on with your own percent, what Hermes shows when the handoff is written, when to run `/compact`, and how to set it from the environment. Three terminal pictures show each command and reply exactly as LitHermes prints them.
- The install section has a prompt you can paste into a coding agent. The agent checks your setup, shows its plan and waits for your yes, installs only `@litfamily/lithermes`, runs `lithermes doctor --offline`, reports what it found and leaves the Hermes restart to you.
- The demo at the top of the GitHub page is a new short film. Numbered steps name what LitHermes adds to a real session, from the `lit` word to the closing LIT mark, and the note about how it was recorded is gone.
- The installer's model menu now offers every reasoning effort each model accepts. `gpt-5.6-sol` gains `low`, `medium`, `max` and `ultra`, `gpt-5.6-terra` gains `low`, `medium` and `ultra`, `gpt-5.6-luna` gains `low`, `medium` and `xhigh`, and each Grok model offers `low` and `medium` beside `high`. The OpenAI sets follow the live model catalog and the Grok sets follow what Hermes sends to Grok. `lithermes doctor` and `hermes lithermes status` accept the same sets, so a `gpt-5.6-luna` / `xhigh` helper is no longer refused. The recommended routes are unchanged, and a model chosen without an effort still gets the effort it got before. Hermes may still send a lower effort than the one you pick: `ultra` goes out as `max`, and on `gpt-6.1-sol`, `gpt-6-sol` and `gpt-6-luna` current Hermes sends `max` and `ultra` as `xhigh`.
- The lit-pptx runtime and the README Studio templates pin `sharp` 0.35.5 and `source-map-js` 1.2.2. The Office tools download again the first time you make a Word or PowerPoint file after updating.

## [1.0.19] - 2026-10-11

- The GitHub README is shorter and written for someone meeting LitHermes for the first time: what it does, how to install it and what to type first. The detail moved into pages under `docs/` (install, tour, skills, automatic handoff, Jev) in English and Korean, and the npm page is shorter too.
- The GitHub page now opens with a short film of a real Hermes session with LitHermes installed.
- In every LIT skin, the spinner names the work while Hermes is busy (lit-looping, planning, verifying and more). The status bar also gives its four levels (good, warn, bad and critical) their own colours in the dark and light palettes.
- `lithermes doctor` shows how `display.status_bar.fields` is set. When it is unset, doctor suggests a set of fields that adds the Git branch. LitHermes never writes that setting itself.
- An automatic update started inside Hermes now has 90 seconds to finish. It used to be stopped after 30 seconds, so a slow first download could end halfway. The docs now say that inside Hermes the update runs only on the first message of the classic terminal CLI (`hermes` or `hermes chat`), and never in `hermes --tui` or a gateway.
- The installer edits `config.yaml` without dropping or breaking keys. Indentless lists, `plugins: {}`, `plugins:` followed by a comment and `display: {}` stay valid YAML, turning the plugin off keeps your own `disabled` list, and files with CRLF line endings keep them. Every edit is parsed before it is written; if the result would not parse, the file stays as it was and the installer tells you what to add by hand.
- A dot inside a file name no longer ends the request, so "lit notes.md 메모 파일로 … 슬라이드 10장 만들어줘" reaches the slide skill. A dot ends a sentence only before a space or at the end of the text.
- `lithermes` now refuses an option a command does not take, a short option such as `-n`, or a stray word, and changes nothing. Before, `install --yes -n` or `uninstall --yes --bogus` ran for real, and `--home` was ignored while the default profile was used.
- `--dry-run` (or `--dry-run=true`) now previews `uninstall`, `hud <accent>`, `hud off` and `motion-runtime install` as well as `install`: each prints what it would change and changes nothing. `--dry-run=false` runs the command normally. Before, `uninstall --yes --dry-run` really uninstalled.
- `lithermes help` lists every option each command accepts, and `--help` after any command prints help instead of running it.

## [1.0.18] - 2026-10-09

- The deck and document looks no longer list settings the engines never applied, such as Latin letter case, figure style, chart annotations, image bleed and crop, and a page-fill target. Their reference pages no longer promise those settings either, so what a look describes is what you get.
- The deck check now ships its placeholder word list, so placeholder text such as "Lorem ipsum" or "Click to add text" fails a deck again; before, the list was missing and the check found nothing.
- The deck check reads a one-word placeholder term such as "todo", "tbd", "fixme" or "placeholder" as a word. A word that only contains one, like "Mastodon", no longer fails a deck, while "TODO:", "TODOs" and "(TBD)" still do.
- The install and update-notice pictures on the GitHub page show the new version again.

## [1.0.17] - 2026-10-08

- `lit-pptx` now works out how a deck should look before it builds anything. It picks one of eight looks (Ledger, Signal, Atlas, Chalk, Paper, Gazette, Studio and Night), each with its own colours, title placements, slide layouts and cover, section and closing pages. The reply opens with the look it chose, why it suits your reader and material, and the two looks that came next; name one of those and the deck is rebuilt.
- `lit-docx` does the same for documents with six looks: Report, Brief, Manual, Proposal, Memo and Journal. They differ in structure. A memo opens with its To and From lines, a brief leads with numbered conclusions, and a proposal gets a typographic cover and a budget table. Pages stay restrained, with near-black headings, ruled tables and Korean conventions. A journal profile you name is still used as is.
- New checks read every slide and every rendered page, and the build fails until the layout is fixed. They catch empty areas, a column much shorter than its neighbour, a heading stranded at the foot of a column or page, a short list split across pages and unbalanced columns on the last page.
- Decks and films now ship the official, unmodified Pretendard font files.

## [1.0.16] - 2026-10-01

- Automatic handoff now finds the handoff it asked for after compaction even when the model formats the marker line, for example as a bullet, in backticks or in bold. A handoff from another session is still ignored.

## [1.0.15] - 2026-09-30

- `gpt-6.1-sol` is now the recommended coding-lead alternative, because OpenAI lists `gpt-6-sol` as the previous generation. You see it in the installer's lead-model menu, in `hermes lithermes doctor` and in the guide. `gpt-6-sol` still works for anyone who already chose it.
- Automatic handoff now loads the saved handoff after compaction, even though Hermes starts a new session id when it compacts.

## [1.0.14] - 2026-09-30

- Add automatic handoff, off until you turn it on with `/lit-handoff auto on <percent>` (or `LITHERMES_AUTO_HANDOFF=1` with `LITHERMES_AUTO_HANDOFF_PERCENT`). The percent is yours to choose; LitHermes has no built-in value.
- On Hermes the steps are split. LitHermes reads the context use of every model call, asks the model for a handoff on the first message after your percent is passed, and loads a short digest of that handoff after compaction. You run `/compact` yourself (`/compress` on Hermes 0.17), because a plugin cannot start compaction. `hermes lithermes status` and `doctor` show the state and warn when your percent is at or above the point where Hermes compacts on its own.
- The README no longer shows the A/B comparison; one run per side was too little to support its verdicts.
- The GitHub pages now show terminal pictures of what LitHermes prints, and a new motion film in Pretendard with a Korean version.

## [1.0.13] - 2026-09-30

- The GitHub pages now have a short motion film, "Watch it in motion", in English and Korean.
- The GitHub pages now show what Jev looks like when it is on, off or unavailable. Jev stays off unless you turn it on.
- The guide is brought up to date and has a short Jev section.
- The English and Korean READMEs are rewritten again in plainer language.

## [1.0.12] - 2026-09-29

- The README now explains the automatic update step: when LitHermes looks for a new version, what it backs up before installing, when it rolls back, which files record the result, and how to turn it off (`LITHERMES_NO_AUTO_UPDATE=1`, `--no-auto-update`, `NO_UPDATE_NOTIFIER=1` or `LITHERMES_NO_UPDATE_CHECK=1`).
- The English and Korean READMEs use plainer language, with the reason given before the switches. The npm page links to the full guide on GitHub.

## [1.0.11] - 2026-09-29

- The Jev skill hint now keeps its last hint per session, so two concurrent sessions no longer see each other's hint. Run `hermes lithermes status` or `doctor` inside a session to see that session's last hint; outside any session they report `on — no session`. Each session's small last-hint file is removed when the session ends.
- Loading the plugin on Python 3.12 or later no longer prints an invalid escape sequence `SyntaxWarning`.

## [1.0.10] - 2026-09-28

- Add an optional Jev skill hint, off by default. Turn it on with `LITHERMES_JEV=1` and your own `TYPESAFE_API_KEY`; a plain prompt can then get one advisory line naming the LitHermes skill that likely fits. The Hermes model still decides whether to load that skill.
- While the hint is on, each eligible prompt is sent to TypeSafe, cut to 2,000 characters, with home paths, email addresses and token-shaped strings redacted. Text without a token shape is sent as written. Nothing else from the session is sent, and TypeSafe bills your account.
- The first reply of each session starts with `✦ Jev skill hint ON` while the hint is enabled. `hermes lithermes status` and `doctor` show whether it is on and name the last hinted skill with its latency.
- A failed or slow hint request never blocks the turn: it gives up after 1.5 seconds without retrying, follows no redirects, and leaves one short note per session. The local last-hint and trace files hold no prompt text or key and are never written through a symlink.

## [1.0.9] - 2026-09-28

- Add the `lit-humanizer` workflow, detector, and always-on rule. It replaces `lit-korean`: the legacy Korean prose commands now route to it, and upgrades keep any old skill copy you modified.
- Check changed text before supported `write_file` and `patch` operations; block-tier findings can deny those writes, while warnings and post-create DOCX/PPTX/PDF checks remain advisory.
- Add `lit-pptx` and `lit-docx`, which build PowerPoint decks and styled Word reports from a Markdown source you can edit. Both render their pages for review and check craft, such as repeated text-only slides, prose line length, and left-aligned numeric table columns.
- Add the Hermes-native `lit-diagram-drawer` skill, with exact routes, local Python verification, craft checks, import parsers, Korean-ready templates, and optional export.
- Route bare-Lit diagram requests, including headed English and Korean briefs, to the installed diagram skill while preserving explicit workflow modes.
- Add a measured interface probe to `frontend-ui-ux`. It renders a served page at seven isolated viewports, reports craft and responsive findings with screenshots, and drives the new build, polish, audit, and harden modes. Without a verified browser it reports `BLOCKED: browser unavailable` instead of installing one. Litwork web builds now go through the probe before visual review.
- Add a frontend motion guide for page choreography, section reveals, scroll effects, and animated media.
- browser-drive now records the `agent-browser` source it was verified against. It accepts version 0.38.1 or later, blocks malformed or older version banners, and lists optional setup commands for you to run yourself.
- Add `lit-typographic-motion`, which directs a film from a validated treatment: a drawn stage page for films that show things, or the WebGL2 type engine when the words are the film. Every film carries a soundtrack, either your track or a generated sound bed, and is done only after it passes the gate and a look round on the final stills. `lithermes motion-runtime install|status` prepares and reports the render runtime, and `lithermes doctor` checks it.
- Open every README with one looping motion cover, in which the five robot panels power on and the LitHermes robot wakes, replacing the orbital-signal motion hero and the static robot cover beneath it; the npm package no longer ships that unused static cover.
- Add a skills-at-a-glance table with one snapshot per skill to every README, and show the maintainer's final A/B verdicts beside the blind judge's, including the later UI and office rounds; the earlier A/B captures leave the repository and the npm package.
- Keep a natural route whole on the first turn of a session, so its installed commands are no longer cut off.
- Treat `lit` alone on the last line of a prompt as activation and keep the task written above it, even when a line break follows.
- Litwork keeps files in the current workspace unless you name another destination, writes user-facing text in the request's language, protects saved user data, and tests each confirmed failure mode of a bug fix. Its final reply answers the original task before any checks.

## [1.0.8] - 2026-09-25

- Keep loaded-plugin model capability checks available when credential-like keys contain empty values, environment references, flags, or mappings, while continuing to block secret strings.

## [1.0.7] - 2026-09-25

- Accept Hermes config schemas from 30 onward and mark versions above the verified 45 ceiling, so current hosts can configure routes, concurrency, and runtime instead of falling back on an unknown-schema result.
- On schema 33 and later, report `max_concurrent_children` as the shared per-batch and background cap, replacing the obsolete 60-child estimate with the actual cap of 20.
- Let in-Hermes status and doctor parse well-formed host releases beyond the verified matrix and show a read-only note instead of reporting an unsupported Hermes host version.

## [1.0.6] - 2026-09-24

- Show the static robot cover as a visible image directly under the motion hero in every README instead of a hidden "View the static family cover" link; the cover now appears exactly once per page.
- Ask about competing visual directions a brief leaves open, instead of silently defaulting, in `frontend-ui-ux` and `readme-studio`; correct the per-turn frontend hot context that had overridden this on the live host.
- Warn in `lithermes doctor` when a bare skill name is shadowed by another same-named skill in Hermes's own `skills.external_dirs` or local skills directory, naming the skill and the shadowing path without changing doctor's pass/fail exit status.

## [1.0.5] - 2026-09-23

- Add README Studio and its bounded multi-round design interview to the shipped workflow family.
- Route new LitHermes planning and review through the GPT-6 model defaults.
- Align both README languages with the family layout and pin package asset URLs for npm rendering.
- Keep version-lockstep drift tests on temporary repository mirrors so concurrent tests never edit live source files.

## [1.0.4] - 2026-09-22

- Switch activation replies to the exact model line `🔥 **LIT IGNITED · <discipline>** 🔥`; keep harness banners unformatted and preserve existing discipline names.
- Render slash acknowledgements with a bold orange-to-pink-to-cyan glyph gradient and the `🔥 LIT IGNITED · <discipline> 🔥` label. The xterm-256 stop mappings are `#FF6337` → 203, `#FF2D95` → 198, and `#00E5FF` → 45; natural-reply acknowledgements stay plain and escape-free.

## [1.0.3] - 2026-09-19

- Add an animated README cover with a still image for reduced-motion preferences.
- Remove automatic skill review. It never completed a review in practice. Leftover `.lit*/pending-review.json` and `skill-loop-state.json` files are inert and may be deleted; no other state is affected.
- Keep the catalog at 11 tools and 10 hooks.
- Refuse publishing when either test suite fails.

## [1.0.2] - 2026-09-18

- Declare the plugin's eleven native tools and ten hooks in `plugin.yaml`, with
  registration-drift tests that exercise the native Hermes surface.
- Make automatic updates channel-aware: an npm installer receipt may update,
  while a catalog or direct-copy payload fails closed without a registry fetch
  or child process.
- Remove private checkout references from public-facing probes and make family
  freshness layouts explicitly configurable. Harden the catalog-facing payload
  so the upstream validator reports no dangerous findings.

## [1.0.1] - 2026-09-17

- Route LitHermes command results through Hermes 0.21's native
  `PluginContext.inject_message` API so CLI commands queue agent turns without
  leaking Python dictionary representations. Preserve the structured source
  patch path for older Hermes hosts and report the gateway opt-in boundary
  explicitly when native injection is unavailable.

## [1.0.0] - 2026-09-16

- Prepare the full-product scoped package `@litfamily/lithermes` with aligned
  installer, lockfile, plugin manifest, and current documentation versions.
  This candidate has not been published; no registry or remote release is claimed.
- Retain the `lithermes` and `lithermes-ai` executables, Hermes plugin identity,
  owned-file migration, Python cache preservation, and unsafe-path refusal guards.
- Use an Ignition SVG README cover with authored vector geometry and outlined
  type, plus a matching WebP fallback for npm. Keep scoped install commands in
  editable README text and preserve native activation behavior.

- Refuse unsafe or replaced product state directories before installer/update work, preserve recovery bytes on path changes, and reject symlinked state receipts.

- Prepare the local `@litfamily/lithermes` npm identity using the full product name with explicit executable selection, scoped registry validation, and safe old-package migration guidance. CLI aliases and Hermes registration remain stable.
- Add community and source-grounded privacy guidance while preserving manual release safeguards.
- Refuse default plugin replacement when unrecorded, modified, or symlinked files are present; preserve user additions during uninstall and reject escaping manifest paths. Retain source-linked Python cache bytes outside the replaced payload so normal imports permit repeat installation. Unsafe parent paths stop both installation and automatic-update rollback.
- Retry one pinned-directory metadata comparison after a demonstrated competing-writer log-creation interleaving, retaining identity checks and bounded unsafe-state refusal.


### Changed

- Shorten the bilingual repository and npm entry guides, preserving the canonical
  ASCII hero and linking detailed operating, model, and safety reference from
  repository docs. Add the Ignition Hermes vector cover under `docs/assets/`
  with an interlocking orange, lime, and ivory symbol. Keep README covers and release
  artifacts out of npm while retaining all installer and Python plugin payload files.
- Replace installer, update, doctor, help, and README wordmarks with the canonical
  Ignition B banner and product lockup. The welcome skin uses the standard mark;
  command and natural-route acknowledgements use the micro mark. JS and Python
  share exact geometry and flat per-cell orange, lime, and ivory colors, with
  fixed 256-color approximations and plain `LIT` for non-UTF-8 or dumb terminals.
- Require the model to begin activated replies with one `▲ LIT · <discipline>`
  probe. The harness renders the mark separately and preserves model text so a
  missing probe remains observable. Natural routes acknowledge at reply arrival.

- Rename `hyperplan` → `lit-crucible`, `init-deep` → `lit-init`,
  `git-master` → `lit-commit`, `remove-ai-slops` → `lit-burnoff`,
  `ai-slop-remover` → `lit-burnoff-file`, `korean-ai-slop-remover` → `lit-korean`,
  and `programming` → `lit-code`. Old typed ids remain aliases for exactly one
  release, emit one deprecation note, and are removed in the next minor. The old
  Korean slash command redirects to `/lit-korean`; canonical catalogs show the
  new ids. `lit-team` names the existing Hermes Kanban route, with `teammode`
  retained for the same alias window; no team skill is installed.
- Reinstall/update replaces the manifest-owned plugin tree and removes old-named
  skill directories, including their nested resources, while recording the new
  payload paths and hashes. Modified managed skills still require explicit
  overwrite approval; unrelated user skills are preserved.

## [0.9.9] - 2026-09-03

### Added

- Add request-scoped `reader`, `technical`, and `audit` output modes across
  native command and natural-route prompts. `reader` is the default and asks
  parent and child synthesis to omit routine execution metadata.

### Changed

- Keep evidence, ledgers, handoffs, status/debug output, and structured
  artifacts detailed and available. Natural-language compliance remains
  advisory at the prompt layer because Hermes exposes no supported generated-
  response interception hook.

## [0.9.8] - 2026-09-02

### Changed

- Move the bundled handoff and scientific-visualization corpora into the
  plugin `vendor/` layout. Skill wrappers now point at those files instead of
  nesting a second original tree.
- Count vendor license and provenance companions in family payload-parity so
  packed skills keep the material they name.

## [0.9.7] - 2026-09-01

### Changed

- Release verification now checks the canonical SHA-256 for
  `plans/references/review-contract.md` instead of reading an absent CI path.

### Fixed

- On Linux, observation-lock cleanup now accepts an immediately recreated lock
  after inode reuse only when the replacement carries a valid, different token.
  Equal, unreadable, and absent tokens still fail closed, so `record_observation`
  no longer reports a committed record as failed under lock contention.

## [0.9.6] - 2026-08-31

### Added

- `npm run check:version` proves that every version-bearing file agrees with
  `package.json`. The release version is threaded through fifteen tracked files
  carrying thirty-seven occurrences, and those files are mutually referential —
  the tests assert README content and the READMEs document what the tests
  expect — so a partial bump previously failed in places unrelated to the file
  that was missed. `scripts/version-manifests.json` classifies every site:
  `history` (the changelog, never rewritten), `derived` (the lockfile,
  regenerated by npm), and `pinned` with an exact expected count. Pinned files
  are additionally scanned for a stale `lithermes-ai@X.Y.Z` left beside a
  current one, because a correct occurrence count alone does not prove freshness.
- Human-facing installer output now opens with a shared five-row stacked ASCII
  wordmark for `lit` and `hermes`. The root English and Korean READMEs lead with
  the same version-free wordmark, while their release pins remain in the surrounding
  documentation.

### Changed

- Interactive installs now show the model-route picker by default, including for
  an already-configured home. The current lead/helper provider, model, and effort
  choices are pre-selected, so confirming the defaults leaves the existing route
  unchanged; non-interactive paths remain unchanged.
- The package CI workflow now runs the credential-free negative-gate matrix,
  negative-control self-check, behavior-replacement probe, and real-surface
  sequence on every push with disposable `HOME` and `HERMES_HOME` directories,
  followed by a named release-command placeholder guard.

- A Hermes host newer than this release's verified matrix is now configured
  rather than silently degraded. The host gate was an exact-membership set of
  two versions, which turned every future Hermes release into a capability
  outage — the shape of the July 2026 defect where the set held 0.17.0 while the
  host had moved to 0.19.0 and the plugin went inert. The gate is now a floor
  (0.17.0) plus a verified matrix: a well-formed release at or above the floor is
  accepted whether or not this release has seen it, and the receipt distinguishes
  a matrix-verified host from one beyond the matrix.

  This does not weaken the gate. A host below the floor is refused by version.
  The banner shape stays strict, so `-beta`, `_beta`, ` stable` and four-part
  builds such as `0.19.0.1` remain malformed. The source and runtime marker
  checks are unchanged and still decide the outcome; a newer host with a failing
  marker still falls back.

### Fixed

- Interactive test helpers now clear `CI` from the synthetic environments they
  pass to the installer. CI therefore exercises the intended TTY prompt and
  summary-card paths again without weakening the product's deliberate refusal to
  prompt in a real CI environment.

## [0.9.5] - 2026-08-31

### Fixed

- The install-time credential guard no longer refuses to write model configuration
  because of a key's NAME alone. It previously matched any key containing `token`,
  `password`, `secret` or `credential` anywhere in the host config, so ordinary
  settings such as `show_token_analytics: false` (a display preference) and
  `access_token_env: HERMES_TOKEN` (the NAME of an environment variable) tripped it.
  A single match disabled model routing, concurrency, recursion, every delegation
  route, and the runtime, which is why a normal install reported eleven capabilities
  as `unavailable (credential-risk host config)`. The guard now also inspects the
  value: booleans, numbers, empty strings, environment-variable names and `${VAR}`
  references cannot leak a secret and no longer block the write. A real credential
  value still blocks it.
- When the guard does fire, the receipt now names the key that triggered it. The key
  name only — never the value or any fragment of it.

## [0.9.4] - 2026-08-31

### Added

- Added packed-payload substance, cross-product parity, and referenced-path gates
  so the installed plugin retains the skill material it names.

### Changed

- Refreshed the canonical legal attribution metadata without changing the four
  upstream attributions it records. This is a local release candidate only; no
  publish, tag, or push was performed.

## [0.9.3] - 2026-08-30

### Added

- Added installer provider choice with explicit lead and child model routes,
  including the xAI key warning and fail-closed unsafe route combinations.
- Added full LitHermes accent skins with branding, flame spinner, banner logo,
  and light/dark palettes, plus honest helper-agent visibility guidance and a
  set-if-absent SessionStart nudge.

### Changed

- Updated packaged READMEs, contract transcripts, and release fixtures to the
  coordinated `0.9.3` candidate.
- This is a local release candidate only; no publish, tag, or push was performed.

## [0.9.2] - 2026-08-29

### Added

- Added a model-free `lithermes skill-loop` review, proposal, decision, and rollback
  CLI. Pending proposals remain inert until an explicit foreground apply, which may
  mutate only marker-owned skills under the Hermes user skill root.

### Changed

- Kept `record_observation` and `read_observations` as the observer module's only
  callable surface while connecting successful skill consultations and bounded
  correction evidence to pending notices. The separate installer CLI owns proposal
  import and explicit decisions; no Hermes plugin tool or hook applies a proposal.

### Release order

- This patch candidate is stacked on the still-unpublished `0.9.1` candidate; publish
  `0.9.1` before `0.9.2`. Both versions remain pending, and this preparation performs
  no publish, tag, push, or release action.

## [0.9.1] - 2026-08-28

### Changed

- Exposed the already-supported `variance`, `motion`, and `density` taste dials from
  the `frontend-ui-ux` entrypoint and routed readers to the carried
  `references/taste-direction.md` guidance.
- Regenerated the payload hash manifest so the taste-direction reference is included
  and byte-pinned.
- This is a `0.9.1` patch candidate only; publication and release dispatch remain
  explicitly human-approved steps.

## [0.9.0] - 2026-08-27

### Added

- Added a standalone `## #contract.output_channels` declaration across all 54
  bundled skill entrypoints. The bounded `frontend-ui-ux` and `visual-qa`
  entrypoints keep the same declaration in `references/complete-contract.md`.
- Added a structural skill-port gate that requires every declaration, restricts
  `artifact_genre` to the five supported values, and enforces the corresponding
  `limitations_channel`.
- Added a declaration-driven Python deliverable hedge guard. Hermes
  `post_tool_call` observes completed file writes, while `pre_llm_call` supplies
  findings on the next model turn because observer-hook return values are ignored.
  The guard flags leaking reader-facing artifacts and leaves the identical text
  alone when its declared genre is `working_note`.

### Evidence boundary

- Two isolated A/B experiments found no measurable behavior change from the
  output-channel prose. This release therefore treats the declaration as
  machine-readable metadata consumed by the guard; it does not claim that the
  prose itself makes model-authored documents cleaner.

## [0.8.49] - 2026-08-26

### Changed

- Aligned the installer package, plugin manifest, bundled contract transcripts,
  release fixtures, and public package references at `0.8.49` for G20 slice 19.

## [0.8.48] - 2026-08-23

### Added

- Added the `frontend-ui-ux` contract with `litfamily.design-contract/v1beta2` as the
  canonical schema and valid `v1beta1` compatibility input.
- Added browser-drive capability measurement with external-driver identity checks,
  bounded process cleanup, and session and state blockers.
- Added the proposal-only `skill-observer` persistence contract with bounded records
  under `.hermes/lithermes/skill-observer/observations.jsonl`.

### Changed

- Updated model configuration and diagnostics to accept exact Hermes `0.17.0` and
  `0.19.0` host versions with verified source markers.
- Expanded package and release coverage for the changed skills, plugin manifest,
  installer version, and bundled payload files.

### Fixed

- Hardened observer and redaction boundaries against secret-shaped, obfuscated, and
  malformed text before persistence. Complete and unterminated PEM payloads and URI
  user information are redacted without echoing their contents.
- Browser-drive routing now blocks fetch-shaped aliases with nested HTTP URLs while
  leaving ordinary local alias calls allowed. It does not substitute a host browser,
  fetch, cached page, or screenshot when the external driver is unavailable.

## [0.8.47] - 2026-08-15

### Changed

- Simplified the English and Korean README surfaces and pinned packaged asset
  links to the exact release version.
- Kept the installer, plugin manifest, release fixtures, and contract examples
  aligned at `0.8.47`.

## [0.8.46] - 2026-08-14

### Added

- Added provider-free activation and cache measurement contracts with payload and
  isolated-surface coverage.

## [0.8.45] - 2026-08-12

### Fixed

- Preserved managed-provider `gpt-5.6-terra` parent routes at `max` no longer stop
  the installer. Inherited global child model routes now use the effective parent
  model before applying the effort floor.
- Installer capability output now reports the current config after a write-boundary
  drift instead of reporting the discarded plan.
- Added model-config, install, doctor, and isolated real-surface regression coverage.

## [0.8.44] - 2026-08-12

### Added

- Added advisory evidence review guidance to the bundled `frontend-ui-ux` reference.
- Added skill-port coverage for the shipped evidence review guidance.

## [0.8.43] - 2026-08-11

### Added

- Added review-gated, product-local Wikify knowledge capture through the Hermes
  `pre_tool_call` hook and the `lithermes_knowledge_capture` tool. Capture accepts
  only bounded `fact`, `decision`, `failure`, `risk`, `rule`, and `checkpoint`
  events. Capture is enabled by default and supports the
  `hermes lithermes knowledge capture off` command and
  `LITHERMES_WIKIFY_CAPTURE=0` opt-outs.
- Added explicit knowledge review transitions. New claims start as `review-needed`.
  `hermes lithermes knowledge save <id>` and
  `hermes lithermes knowledge review <id> accepted|rejected|stale` manage review
  state. The `pre_llm_call` query injects only relevant accepted claims with
  provenance and evidence, emits no block on a no-match query, and uses a
  2048-byte normal budget with a 4096-byte hard limit.
- Added fail-closed knowledge boundaries. The capture surface rejects raw chat,
  source bodies, fetched text, credentials, secrets, tokens, and
  instruction-shaped input. Local storage uses descriptor-pinned POSIX operations
  with a cooperative append lock. The feature adds no network, watcher, daemon,
  embedding, vector database, dependency, or external service. Windows returns
  `unsupported-platform-pinned-write` without mutating local knowledge.

## [0.8.42] - 2026-08-09

### Added

- Added a default-on foreground update barrier at the first eligible interactive
  `pre_llm_call`. It installs an exact stable `lithermes-ai` version only after
  a cache candidate, uses a credential-free npm environment and isolated lock,
  verifies with Hermes doctor, and records a receipt with rollback evidence.
- Added `--no-auto-update` and `LITHERMES_NO_AUTO_UPDATE=1` opt-outs while
  retaining the detached notifier as a cache-only advisory path.

## [0.8.41] - 2026-08-06

### Added

- Output-style injection: a new `output_styles.py` module reads `outputStyle` from
  `~/.hermes/config.yaml` and appends the matching style-file block (ASD-STE100,
  ASD-STE100 Korean, ELI5, ELI5 Korean) to the `pre_llm_call` context on the first
  turn of a session and after a context compaction — alongside the existing rules
  block, not replacing it. The hook fails open: missing config, missing YAML library,
  malformed YAML, unknown style id, and missing style file all silently return `""`.
- `readOutputStyleConfig` / `setOutputStyleConfig` / `clearOutputStyleConfig` in
  `src/lib/config.js` — flat top-level `outputStyle: <id>` key operations using the
  existing `writeFileAtomic` / `writeConfig` plumbing.
- `maybePickOutputStyle(flags)` in `src/cli.js` — called after `maybePickHudAccent`
  during `lithermes install`; supports `--style <id>` and `--no-style` flags, or
  an interactive TTY prompt with a numbered menu (0–4); persists via
  `setOutputStyleConfig` unless 0 (keep current) is chosen.

## [0.8.40] - 2026-08-05

### Changed

- Re-routed the managed parent and global child model from `gpt-5.6-sol` / `high`
  and `gpt-5.6-terra` / `high` to `gpt-5.6-luna` / `max` on both routes, following
  price/performance data showing Luna at max effort matches Sol at high effort on
  pass rate at roughly a quarter of the cost. The safety guard that previously
  rejected every Luna variant now rejects Luna below `high` effort instead —
  the floor moved with the model, it was not removed.

## [0.8.39] - 2026-08-04

### Fixed

- Unified `/lit-plan` and `/start-work` on the same column-zero implementation and
  final-verifier row grammar. `/start-work` now rejects malformed plans before
  creating run state, excludes nested, fenced, and incidental checkboxes from open
  execution items, and redacts secrets from malformed-plan diagnostics.

### Changed

- Documented two HUMAN-ONLY publication paths. Local macOS/general npm publication
  is protected by the `prepublishOnly` source-only guard, but its inspected preflight
  tarball is not byte-identical to the published bytes because npm repacks; after a
  nonzero result maintainers must query the exact registry version, never blind-retry,
  and inspect the published artifact after success. The existing workflow remains the
  stronger Linux descriptor-sealed exact-artifact option and still requires `NPM_TOKEN`.

## [0.8.38] - 2026-08-02

### Fixed

- `lit-recap` now declares which source wins when the durable ledger and the live
  session disagree: current session and repo facts take precedence, and the recap
  must say so, marking stale ledger or handoff entries instead of presenting them
  as current. It previously only said to combine the two sources, which gave no
  precedence and no obligation to surface a conflict — and the runtime pre-renders
  durable `pass` criteria into context already labelled as completed work, so
  silence read as confirmation.

## [0.8.37] - 2026-08-02

### Added
- `lit-comprehend` skill for when understanding, not status, is the bottleneck: after a long
  agent session it builds one self-contained explainer artifact a person can reason with, rather
  than the chronology `lit-recap` already provides. It anchors on what the reader already knew,
  orders the walkthrough conceptually instead of by file, ships an interactive micro-world,
  discloses what is not verified, and closes with a quiz framed as a speed regulator.
- Execution gate on that skill: activation is not permission to build. An invocation naming a
  path or git range proceeds; a bare invocation or a prose question gets a one-screen scope
  proposal (target, exclusions, estimate) and waits for approval, with the cheaper one-sentence
  answer offered when the request deserves it. The proposal is derived from `git status`,
  `git diff --stat`, and durable state, never by reading the tree.
- Bundled `scripts/verify-explainer.py`, an HTML scaffold, and authoring references. The verifier
  fails an artifact for a phantom code quote, a quote attributed to a missing file, code quoted
  with no attribution, an external resource reference, a missing canonical section, an artifact
  written inside the worktree, a quiz option without feedback, a positional tell, collapsed code
  blocks, and ASCII-art diagrams.
- Routing accepts `lit-comprehend`, bare `comprehend`, and `lit comprehend`; `comprehension`,
  `incomprehensible`, `설명해줘`, `이해가 안 돼요`, and `explain this function to me` are proven
  by negative-control tests not to activate.

## [0.8.36] - 2026-07-30

### Fixed
- Install now enables the plugin in `config.yaml` on every model-plan path, including the
  unsupported-host fallback: enablement is written on its own while model keys stay untouched,
  so fresh installs on newer Hermes hosts (for example 0.19.x) load the plugin instead of
  completing inert. Doctor's `enabled config` and `loaded plugin` checks pass on such hosts.

### Changed
- Release publication is bound to one reviewed commit through the HUMAN-ONLY sealed
  `publish.yml` dispatch; release docs and tests pin the dispatch identity guard.

## [0.8.35] - 2026-07-29

### Added
- Bundled the pinned exact frontend reference corpus behind `frontend-ui-ux`, with
  deterministic path, size, digest, legal-file, scanner, doctor, and pack
  verification from a fail-closed canonical manifest.
- Added Hermes-native `autoresearch`, `autoconference`, and `wikify` families with
  10, 7, and 5 nested modes respectively. Direct skills and exact leading natural
  routes use bounded authority, root-only conference delegation with packet-only
  child output, and inert task-local wiki input and review states.

### Changed
- Documented nested conference workflows as root-family mode selections rather
  than callable colon skills, and made both family scaffolders declare UTF-8 for
  every generated text artifact.

### Fixed
- Derived canonical scanner exclusions and pack projections from exact inventory
  captured by a single verified manifest pass, pruned exact generated state for
  removed researchers during forced conference re-scaffolding, and isolated QA target
  import and registration before probing shipped plugin handlers.
- Hash-check every nested mode SKILL.md in bundled and installed payloads while
  retaining the separate verification pass for the 29 root `SKILL.md` files.
- Restricted semantic-family `lit <family>` routing to a first visible token;
  quoted, blockquoted, embedded-prose, inline-code, and fenced examples stay inert.

## [0.8.34] - 2026-07-28

### Added
- Added canonical v1beta1 design-contract and material evidence schemas with
  executable validation, authorized-root capture paths, SHA-256 binding, and
  freshness checks while retaining v1alpha1 as diagnostic-only compatibility.

### Changed
- Kept the complete UI/UX and visual-QA contracts in lazy references while
  bounding combined UI-shaped model context below 3840 UTF-8 bytes.
- Made installer doctor report generated Python bytecode without deleting package
  files; payload cleanup now runs only on explicit test and pack preparation paths.

### Fixed
- Hardened material PNG inspection and release QA so malformed, stale,
  out-of-root, hash-mismatched, or unverifiable captures fail closed with
  deterministic diagnostics and real-surface coverage.

## [0.8.33] - 2026-07-26

### Added
- Added a bounded rules engine with documented project, user, and bundled-rule
  discovery; once-per-session always rules; edit-matched glob rules; deterministic
  precedence; and a documented glob subset rather than unsupported parity claims.
- Added the bundled `structural-search` skill and named route with executable
  identity checks, safe fallbacks, and package enrollment.

### Changed
- Registered `on_session_start` and `post_tool_call` observers for rule discovery
  and post-edit skill selection, with delivery deferred through `pre_llm_call`
  because Hermes ignores observer-hook return values.
- Expanded durable litgoal state with session-scoped storage, review-blocked and
  user-decision statuses, schema-specific ledger vocabularies, evidence-backed
  steering, retries, and attempt-scoped evidence that preserves prior attempts.
- Expanded UI/UX and visual-QA coverage with reference routers, explicit
  permission-state inventory, and deterministic completion contracts.
- Added plan scaffolding and structural checks, claim-graph attribution guards,
  isolated emitter protection, package path scanning, and focused release-prep
  coverage for the staged workflow changes.

### Fixed
- Corrected release QA documentation to the generated 18-row matrix and disclosed
  that the isolated behavior probe performs read-only live-profile `stat` and byte
  comparisons while refusing live-profile writes.
- Made retries require fresh current-attempt `green` and `scenario` evidence,
  wired model tools and snapshots to host-session state, and entity-escaped rule
  bodies and metadata before envelope rendering.
- Made real-surface QA fail closed on BLOCKED rows, added a mechanical renderer-
  ownership capability verdict, derived live-profile receipts from read-only byte
  and SHA-256 fingerprints, and enforced the QA command in the publish workflow.
- Made visual-QA tier verdict precedence deterministic: any BLOCKED diagnostic
  outranks FAIL while blocked and failure codes remain distinct.

## [0.8.32] - 2026-07-25

### Added
- Added Hermes-native `frontend-ui-ux` design intelligence with pinned offline
  source provenance, deterministic import and search, and a schema-valid Design
  Contract for implementation and review handoff.
- Added strict `visual-qa` Evidence and Review receipts, tiered fidelity,
  accessibility, and interaction checks, plus bounded PNG and terminal-grid
  probes with isolated install and scenario coverage.

### Fixed
- Made nested, shared, unreadable, and unlisted plugin payload state fail closed
  across installer doctor and package-integrity checks.

## [0.8.31] - 2026-07-24

### Added
- Added an advisory Node installer update notice for successful interactive
  `install`, `check`, and `doctor` commands, with canonical timestamps and a
  24-hour atomic cache reservation in the parent, a non-reclaiming transition
  mutex, current-owner mutation fencing, detached bounded npm-registry refresh,
  strict response validation, a credential-isolated worker environment,
  automation/offline opt-outs, failed-doctor suppression, and no automatic
  installation or credential use.

### Fixed
- Made installer doctor verify every required bundled and installed skill
  entrypoint as a regular, non-empty file whose SHA-256 matches the existing
  payload or install manifest. Missing, empty, mutated, malformed-manifest, and
  bundled source-hash failures now produce distinct diagnostics and a nonzero
  exit instead of presence-only success.

## [0.8.30] - 2026-07-23

### Added
- Added code-owned bounded work schema 3 with canonical approved plans,
  exact-session mutation authority, monotonic revisions, replay-safe progress,
  one-use resume grants, terminal lifecycle commands, and bounded durable state.
- Added Hermes-native `pre_tool_call` enforcement for real mutation tools while
  preserving read-only calls and permanently refusing release, credential,
  host-config, and destructive authority classes.

### Changed
- Added an isolated, dependency-complete Python test gate and aligned plugin
  registration, diagnostics, command metadata, skills, package docs, and payload
  integrity coverage with the bounded-authority lifecycle.

## [0.8.29] - 2026-07-22

### Fixed
- Removed automatic native `/goal` mutation. Native goals remain user-managed
  and unobserved, while durable `goal_*` state remains authoritative for
  LitHermes completion.

## [0.8.28] - 2026-07-19

### Added
- Expanded LitResearch with a parent-owned, append-only claim and evidence graph,
  DOI normalization, and distinct metadata, PDF acquisition, conversion, and
  human-review states. Bounded parallel waves degrade to a documented sequential
  fallback when delegation is unavailable.
- Added guarded GPT-5.6 routing for verified Hermes 0.17.0 hosts: the parent uses
  SOL/high and the global child route uses TERRA/high. Luna and under-high TERRA
  routes fail closed, while custom provider settings remain byte-preserved.

### Changed
- Split the plugin core into cohesive Hermes-native modules without changing the
  installed command surface, and made asynchronous child re-entry receipts and
  configured-versus-effective model truth explicit in status, doctor, and docs.
- Tightened direct and natural LitResearch route contracts, scientific artifact
  provenance, safe non-port boundaries, installer tests, and payload validation.

## [0.8.27] - 2026-07-18

### Added
- Embedded the exact four-file handoff source behind the Hermes-native
  `lithermes:lit-handoff`, `/lit-handoff`, and exact bare `handoff` surfaces,
  with byte-parity, provenance, isolated-install, and package guards.
- Embedded the exact 16-file scientific-visualization source behind
  `lithermes:lit-scientific-visualization`,
  `/lit-scientific-visualization`, and the exact bare routes
  `lit-scientific-visualization` and `lit scientific visualization`. The
  response transform guarantees the named banner as the first line exactly
  once, while generic, quoted, code, mixed, and near-miss prompts stay inert.

### Changed
- Added immutable-source integrity, palette import-root, dependency-preflight,
  package, and isolated-install guards. Missing scientific Python packages are
  non-fatal `DEGRADED`; no dependency is installed silently, and generated
  bytecode is excluded.

## [0.8.26] - 2026-07-12

### Changed
- Reworked interactive npx/bunx installation output into a persistent,
  Hermes-native TUI: a preparation summary, numbered stages with purpose
  and target context, animated progress, and explicit success/failure receipts.
- Preserved plain output and existing install semantics for CI, redirected
  streams, `NO_COLOR`, dry-run, and `--no-spinner` workflows.

## [0.8.25] - 2026-07-11

### Changed
- Made `/lit-plan` produce proportionate objective-achievable checklists with a
  bounded objective, explicit non-goals, atomic action/output/verification items,
  evidence commands, decision branches, and a falsifiable DoneClaim.
- Added a draft-plan mode to `/review-work` with `PASS`, `ITERATE`, and
  `NEEDS-CONTEXT` verdicts while preserving the existing five-lane
  post-implementation completion review.
- Enforced flat delegation on fresh or explicitly reconfigured managed settings,
  suppressed orchestration reactivation in child contexts, documented asynchronous
  batch re-entry, and made doctor fail when preserved settings still allow nesting.

## [0.8.24] - 2026-07-10

### Fixed
- Recognized the legal indentless YAML sequence emitted by Hermes for
  `plugins.enabled`, so offline doctor now reports the same enabled-config state
  as the native enabled-user plugin registry.

## [0.8.23] - 2026-07-10

### Changed
- Added explicit verified reconfiguration for `model.context_length: 372000` and
  `compression.threshold: 0.90`, reporting the effective 334800-token target as
  hard while preserving asynchronous delegation.
- Kept fresh installs, ordinary preservation, malformed schemas, unknown hosts,
  and credential-risk config on their existing no-write paths.

## [0.8.22] - 2026-07-10

### Added
- Added safe SOL/TERRA and medium/high/xhigh onboarding behind exact Hermes 0.17.0
  source/runtime markers, credential-risk checks, atomic writes, and drift revalidation.
- Added loaded-plugin status and doctor receipts for model, effort, normal Responses runtime,
  hard synchronous concurrency 20, and ratio-only 650K unavailability.

### Changed
- Preserved custom model, compression, context, async delegation, and credential-bearing config
  unless the user explicitly opts into a verified supported migration.

## [0.8.21] - 2026-07-09

### Changed
- Tightened no-trace hygiene across tracked history, release docs, scanner tests,
  and bundled skill surfaces. Stale tracked plan artifacts were removed.
- Deepened Hermes-native readiness guidance for Hyperplan, review-work,
  litresearch, start-work, litwork, litgoal, init-deep, and repo-rule docs.
- Prepared `lithermes-ai@0.8.21` after aligning resume/dry-run/status/doctor
  surfaces and package documentation for manual npm publication.

## [0.8.20] - 2026-07-08

### Changed
- Prepared `lithermes-ai@0.8.20` after adding README/status/doctor parity guards
  for all 23 bundled skills, including `lit-recap`.
- Kept the Hermes payload manifest aligned with the packaged plugin metadata and
  preserved explicit `/start-work` execution boundaries.

## [0.8.19] - 2026-07-08

### Changed
- Prepared `lithermes-ai@0.8.19` for npm publication after extending bare
  lit-family routes to inject the full bundled skill body.
- Kept `/start-work` explicit-execution boundaries intact while the package
  payload and plugin manifest versions stay aligned.

## [0.8.17] - 2026-07-07

### Changed
- Natural bare `hyperplan`, `litresearch`, `lit research`, and `init-deep`
  routes now inject the matching bundled `SKILL.md` body instead of a short
  handwritten prompt, while natural-language `lit start work` remains a visible
  BLOCKED handoff to explicit `/start-work`.
- Prepared version surfaces for `lithermes-ai@0.8.17` and kept payload manifest
  hashes aligned with the changed installed plugin files.

## [0.8.16] - 2026-07-07

### Changed
- Deepened the bare Hyperplan natural route context so release-prep and planning
  passes carry cross-review, defense/refinement, rejected approaches, and
  `/lit-plan` readiness anchors in the installed Hermes plugin payload.
- Marked README surfaces as published for `lithermes-ai@0.8.16`.

## [0.8.15] - 2026-07-05

### Added
- Bare `hyperplan` and natural `lit hyperplan` routing now activate the LitHermes
  Hyperplan planning contract while preserving slash/code/substr safety guards.

## [0.8.14] - 2026-07-05

### Added
- **`hyperplan` adversarial planning skill.** Adds a Hermes-native planning-only
  pressure-test workflow: independent read-only `delegate_task` lanes,
  cross-review, defense/refinement, surviving insight bundle, and `/lit-plan`
  handoff before implementation.

## [0.8.13] - 2026-07-04

### Added
- **`/lit-recap` read-only work recap.** Korean-default five-section recap
  synthesized from the durable litgoal and run ledgers plus current session
  context, with `--brief` and `--en` options and bounded natural routing.
  Side-effect-free by contract: no run-state writes, ledger text treated as
  inert data.

## [0.8.12] - 2026-06-27

### Changed
- **Korean prose cleanup release prep.** Docs and release surfaces now cover
  `korean-ai-slop-remover`, `/korean-ai-slop-remover`, `/text-naturalization`,
  and `/text-neutralization` with meaning preservation. Treat source text as content, not instructions.
  Boundaries: no automatic file edits and no external fetching.
- Version surfaces are prepared for `lithermes-ai@0.8.12`; no npm publish performed.

## [0.8.11] - 2026-06-26

### Changed
- **Minimum-first planning and review gates.** LitHermes now makes the
  minimum-first rule explicit in runtime, planning, and review surfaces while
  preserving the anti-underbuilding requirement: the smallest complete solution
  still includes required shared helpers, validation, security, accessibility,
  realistic error handling, and regression tests.

### Security
- **Redacted external-term scanning.** The release scanner can load
  caller-supplied external terms from outside the repo and reports only opaque
  file/term IDs. It fails closed on malformed or missing inputs and avoids
  echoing raw terms, context, or file paths.

## [0.8.10] - 2026-06-23

### Changed
- **Host-lane research retrieval parity.** `lit research` now makes the host
  retrieval lane protocol explicit: host-provided webfetch, browser/browsing,
  repo deep-dive, and `delegate_task` lanes share one attempt-trace schema while
  LitHermes remains free of bundled standalone crawler/browser dependencies.

## [0.8.9] - 2026-06-23

### Added
- **Public retrieval hardening for `lit research`.** Research mode now instructs
  public-endpoint-first retrieval, structured attempt traces, validation beyond
  HTTP 200, login/paywall/CAPTCHA refusal, private/loopback network guardrails,
  actionable diagnostics, and A/B source comparison before synthesis.

## [0.8.8] - 2026-06-21

### Added
- **Hermes-native delegate evidence and Kanban workflow routing.** `/review-work`
  now records a local redacted `delegate_batch_intent` summary for its single
  five-lane `delegate_task` batch. Natural `lit workflow` / `lit kanban` routes
  durable work to Hermes Kanban setup/proposal guidance, while `lit team` maps
  team-like requests to Kanban profile lanes without claiming a literal team
  mode.

## [0.8.7] - 2026-06-20

### Added
- **Build-decision gate.** A pre-write, minimum-first check now runs before the
  language gate in the programming skill, plus a necessity/reuse item in the
  post-write self-review.

### Changed
- README install and usage clarifications.

## [0.8.6] - 2026-06-19

### Added
- **Mode-aware natural routing.** Standalone `lit`, `litwork`, `lit plan`,
  `lit review`, `lit research`, and `lit goal` now route to the matching
  Hermes-native contracts while ignoring code spans/fences, substrings,
  compounds, path-embedded tokens, and real slash-command mentions. Path-like
  task arguments such as `/tmp/repo` and `/api/v1/users` remain valid.
- **Safety tests for activation and package state.** Added regression coverage for
  natural routing, slash false positives, path-like arguments, code span and
  fence suppression, secret redaction, malformed input, stale hook state, and
  package payload exclusion of local runtime state.

### Changed
- **`/start-work` is execution-only.** It now blocks when no approved plan exists
  instead of bootstrapping a plan from a brief; natural-language `lit start work`
  also blocks and instructs the user to invoke `/start-work <approved-plan>`.
- **Docs and skills clarify mode contracts.** `lit-plan` is planning-only,
  `review-work` covers behavior/tests/docs-package/security/cleanup,
  `litresearch` journals under `.hermes/lithermes/litresearch/`, and `litgoal`
  remains the `.hermes/lithermes/litgoal/` durable criteria/evidence layer.

### Security
- **Secret-bearing prompt redaction.** Common bearer-token, key/value,
  provider-key, and access-key shapes are redacted before model-facing handoff or
  durable persistence in run state and litgoal artifacts.

## [0.8.5] - 2026-06-16

### Added
- **Management / diagnostics CLI surface.** Added `hermes lithermes version`,
  `status`, `doctor`, and `--help` reporting for plugin version, Hermes host
  version, registered hooks, slash commands, skills, and goal tooling.

## [0.8.4] - 2026-06-14

### Added
- **Three skills brought to Hermes-native parity:** `visual-qa`, `lsp-setup`, and
  `litresearch`, each re-authored around Hermes command names, `delegate_task`,
  and local package surfaces.

### Changed
- **`debugging` skill regained runtime discipline:** reproduction standards,
  root-cause discipline, common LitHermes failure classes, and patch rules.

## [0.8.3] - 2026-06-14

### Fixed
- **`npx lithermes-ai ...` resolves the package bin reliably.** Added a matching
  `lithermes-ai` bin alias and clarified README troubleshooting for command-name
  mismatches.

## [0.8.2] - 2026-06-14

### Fixed
- **Installer status lines now distinguish fresh install, same-version install,
  and real upgrade.** A pure helper compares the installed version against the
  package version instead of relying on manifest-integrity checks.

## [0.8.1] - 2026-06-14

### Fixed
- **The LITBURN banner now fires deterministically on the bare `lit` keyword path.**
  A `transform_llm_output` hook prepends the banner once for the flagged turn,
  with a dedupe guard.

## [0.8.0] - 2026-06-14

### Added
- **LITBURN banner.** LitHermes slash commands prepend a visible activation
  banner to their display channel, and the bare keyword path injects matching
  model-facing guidance.

### Fixed
- **Legacy native-goal bridge (subsequently removed).** Objective-carrying
  commands embedded a marker that older builds converted into native goal binding;
  current builds keep native `/goal` user-managed and unobserved.

## [0.7.0] - 2026-06-14

### Added
- **`git-master` skill.** Added git-history guidance for atomic commits, history
  forensics, and publish boundaries.
- **`init-deep` skill.** Added the hierarchical `AGENTS.md` knowledge-base
  generator re-authored for Hermes `delegate_task` and `lsp` surfaces.

## [0.6.0] - 2026-06-14

### Added
- **`deep-interview` skill + `/deep-interview` command.** Added requirements
  clarification with ambiguity scoring, non-goal boundaries, and handoff to
  `/lit-plan` or `/lit-loop` without direct implementation.

### Fixed
- **`rules` skill rewritten to match reality.** Repo-rule loading is provided by
  Hermes native context files. Removed false hook claims from docs.

## [0.5.1] - 2026-06-14

### Fixed
- **`plugin.yaml` version tracks the package version.** Added a release test
  asserting `plugin.yaml` version equals `package.json` version.

## [0.5.0] - 2026-06-14

### Changed
- **Current command vocabulary adopted.** The command family moved to the `lit`
  vocabulary across commands, skills, hook markers, trigger constants, and local
  state directories.
- **Neon HUD.** The 10 accents received a higher-saturation palette and a branded
  `hud --list` render with graceful plain-text fallback.

### Migration
- Historical per-workspace state was not auto-migrated because it is regenerable.

## [0.4.0] - 2026-06-14

### Changed
- **Clean-break identity migration.** The package, bin, plugin id, install dir,
  hook markers, config plugin id, local runtime state, HUD skins, docs, and URLs
  moved to the current LitHermes identity. No compatibility shims were added.
- Neutralized cross-product palette attribution in shipped CLI surfaces.

### Added
- **Durable state writes.** Goal-store and installer file writes now use atomic
  temp-file, fsync, and rename patterns.
- **Bounded natural trigger.** Direct run-context task text is clamped before it
  enters run state (and, in legacy builds, the subsequently removed native bridge).
- **Fail-closed token scanner.** The scanner gates tracked, package, and npm-pack
  surfaces for denied provenance terms.
- **CI guardrails.** Added no-publish push/PR checks and a manual-dispatch-only,
  version-guarded publish workflow. Top-level `LICENSE` added.

## [0.3.0] - 2026-06-07

### Removed
- **Bundled mirror removed.** The plugin no longer ships the old mirror payload;
  installer restore logic for that mirror was removed with it.

### Changed
- **Every skill, plan handoff, and doc surface is Hermes-native.** Delegation maps
  to `delegate_task`, state paths map to LitHermes directories, and plan handoff
  prose references only Hermes-real goal surfaces.
- **Richer delegation guidance** in goal handoffs: worker conduct,
  self-verification, read-only codebase search, and external-research patterns.

### Added
- **Planning skill for the current plan command.** Added classify, explore-first
  grounding, interview, approval gate, gap-analysis, and plan-review passes.
- **`start-work` executor skill.** Added resume-from-artifacts execution with
  per-checkbox test, manual-QA, cleanup, and independent verification gates.
- **Structured `goal_steer`.** Added evidence-backed steering with a
  completion-weakening guard.
- **Hardened forbidden-token scanner.** Added encoded denied-token detection with
  identifier-boundary matching, binary skip, and source self-clean tests.

## [0.2.5] - 2026-06-04

### Changed
- **HUD accent palette aligned across the family.** Accent names, order, and
  terminal-color behavior were updated for consistent display.

## [0.2.4] - 2026-06-04

### Added
- **HUD skins.** Added 10 accent presets that drive Hermes native skin selection,
  installer writing, command-line listing, application, and clearing.

## [0.2.2] - 2026-06-04

### Fixed
- **Model-facing goal tools accept Hermes-injected keyword context.** All goal
  handlers accept `**kwargs`, fixing tool dispatch from Hermes' registry.

## [0.2.1] - 2026-06-04

### Fixed
- **Legacy native `/goal` bridge (subsequently removed).** Older builds used
  `pre_llm_call` and the session manager; current builds perform no automatic
  native-goal mutation.

### Changed
- Goal handoff prose documented the then-current bridge plus durable `goal_*` tools.
- Delegation guidance names the `delegate_task` batch parameter for review lanes.

## [0.2.0] - 2026-06-04

### Added
- **litgoal durable runtime.** Persistent goal state under
  `<workspace>/.hermes/lithermes/litgoal/` with goals, criteria, evidence,
  checkpoints, steering, review blockers, model-facing goal tools, CLI access,
  command activation, and `pre_llm_call` snapshots. `goal_complete` is
  evidence-gated: every criterion needs RED to GREEN evidence, manual-QA scenario
  evidence, and no unresolved review blocker.
- **5-lane review orchestrator.** `/review-work` gathers scope, diff, and run
  command context, then dispatches goal, QA-by-execution, code-quality, security,
  and context lanes via native `delegate_task`, with an all-or-nothing gate.
- **Litwork loop runtime.** Plan templates, durable notepad, parsed criteria, and
  criterion ledger events support RED/GREEN/scenario/cleanup evidence.
- **ANSI step-TUI installer.** Install phases render as terminal-safe progress in
  interactive terminals and remain plain in non-TTY runs.

### Changed
- review-work and litgoal skills target Hermes runtime surfaces: `delegate_task`,
  goal tools/CLI, and `.hermes/lithermes/litgoal/`.
- Litwork context injection documents the PIN to RED to GREEN to VERIFY to SURFACE
  to CLEAN loop, manual-QA channels, cleanup receipts, and reviewer gate.
- `plugin.yaml` declares the hooks the plugin registers.

## [0.1.12]

- Installer spinner, sanitized bundled workflow payload, and packaging hardening.
