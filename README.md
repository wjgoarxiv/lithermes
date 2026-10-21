<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="./docs/assets/cover-motion-still.webp" /><img src="./docs/assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: seven armored robots power on one by one, the LitHermes robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

# LitHermes

**Keep the work lit.**

LitHermes is a plugin for [Hermes Agent](https://github.com/NousResearch/hermes-agent). Put `lit` in front of a request, and Hermes plans the task, does it, checks the result and writes down where things stand, so the next session can pick up where this one stopped.

<p align="center">
<a href="https://www.npmjs.com/package/@litfamily/lithermes"><img src="https://img.shields.io/npm/v/%40litfamily%2Flithermes?style=flat-square&label=npm&labelColor=080d14&color=ff6337" alt="npm version" /></a>
<a href="https://www.npmjs.com/package/@litfamily/lithermes"><img src="https://img.shields.io/npm/dm/%40litfamily%2Flithermes?style=flat-square&label=downloads&labelColor=080d14&color=ff6337" alt="npm downloads per month" /></a>
<a href="./LICENSE"><img src="https://img.shields.io/github/license/wjgoarxiv/lithermes?style=flat-square&labelColor=080d14&color=d7f75b" alt="MIT license" /></a>
<a href="https://github.com/wjgoarxiv/lithermes/stargazers"><img src="https://img.shields.io/github/stars/wjgoarxiv/lithermes?style=flat-square&labelColor=080d14&color=f2efdf" alt="GitHub stars" /></a>
</p>

<p align="center"><a href="#install">Install</a> · <a href="#your-first-task">First task</a> · <a href="#what-you-get">What you get</a> · <a href="#learn-more">Learn more</a> · <a href="./README_Ko-KR.md">한국어</a> · <a href="https://www.npmjs.com/package/@litfamily/lithermes">npm</a></p>

<p align="center"><img src="./docs/assets/demo.webp" width="960" alt="A short silent film of a real Hermes session with LitHermes, in seven numbered steps. It opens on the LitHermes mark and &quot;The lit workflow for Hermes Agent&quot;. 1, start with &quot;lit plan&quot;: the request &quot;lit plan add a --shout flag that prints the greeting in capitals, with a test&quot; is typed in. 2, the workflow map at PLAN: the reply ends with the LIT mark, &quot;🔥 LIT IGNITED · lit-plan 🔥&quot;, and under it the map row &quot;🔥 LIT · lit-plan — 📝 PLAN › 🔨 · › 🔍 · › 🏁 ·&quot;. 3, /start-work runs the plan: the test-first and verification skills, test-driven-development and verification-before-completion, load before any code. 4, a failing test first: it runs npm run test on the new tests and checks that the run fails before greet.js changes. 5, then the fix and real tests: greet.js gains the toUpperCase line and npm run test runs again. 6, done, with a review: the lit answer box says the tests and the final review pass, and node greet.js --shout Ada prints HELLO, ADA!. 7, the map, all done: after &quot;lit recap&quot;, the LIT mark &quot;🔥 LIT IGNITED · lit-recap 🔥&quot; and the row &quot;🔥 LIT · lit-recap — 📝 plan ✓ › 🔨 work ✓ › 🔍 review ✓ › 🏁 done ✓&quot;. It closes on the LitHermes mark and the install command." /></p> <!-- demo-gif -->

## Why LitHermes

Hermes Agent is good at the task in front of it. Work that runs longer than one sitting is harder. The conversation gets compacted, the terminal closes, and the next time you sit down you first have to work out what was decided, what was really tested and what was left half done.

LitHermes keeps a record of that work for you. With `lit` in front, a request gets criteria you can check, a test that fails before the change and passes after it, a look at the running result, and a handoff note in your project. Goals, plans and evidence stay on disk, so a fresh session reads them and carries on.

Here is what that looks like across two sessions:

```text
lit fix the failing login test           → a failing test, the fix, the test passing, a list of what was checked
/lit-handoff                             → HANDOFF.md with the result and the next step
(next day) read the handoff and continue → the new session picks up from that note
```

It is for anyone who uses Hermes on work that has to hold up: code that must keep passing its tests, reports and decks that go to other people, research you want sources for. One word at the start and one command at the end, and the next session knows what the last one did.

## Quick start

### Install

You need Hermes Agent, Node.js 18 or later, and write access to your Hermes home (normally `~/.hermes`). This page describes `@litfamily/lithermes@1.0.28`.

```sh
npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes --no-style
```

The command copies the plugin into your Hermes home and switches it on in the Hermes configuration. `--yes` lets it run through without stopping to ask, and `--no-style` skips the question about how replies should be worded. The first install also fetches the helper tools for making films, so give it a minute.

Want to try LitHermes before it touches your everyday setup? Point `HERMES_HOME` at a new, empty directory before you install, and start Hermes with the same value. If the install report marks some model routes as unavailable, that happens when Hermes cannot be verified; run `lithermes doctor --offline`, which is the check that tells you the plugin is in place. The [install page](./docs/install.md) covers every flag, the trial profile and installing from a reviewed `.tgz`.

You can also hand the install to a coding agent by pasting the prompt below. The agent checks what you have, shows you its plan and waits for your yes, installs the official npm package, runs the offline check and tells you what it found. The restart stays with you, because a running Hermes gateway picks up a new plugin only when it starts again.

```text
Install LitHermes, the lit workflow plugin for Hermes Agent, on this machine.

1. Check first: Hermes Agent is installed (hermes --version), Node.js is 18 or later
   (node --version), and I can write to my Hermes home (~/.hermes, or $HERMES_HOME if set).
2. Show me your plan and the exact commands, and wait for my yes before you change
   anything. You may preview the install first; it changes nothing:
   npx --yes --package @litfamily/lithermes@latest -- lithermes install --dry-run
3. Use only the official npm package @litfamily/lithermes. Do not clone a repository,
   copy plugin files by hand or install any other package. Install with:
   npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes --no-style
4. Verify with:
   npx --package @litfamily/lithermes -- lithermes doctor --offline
   Report the result to me, including every line that is not PASS. "loaded plugin:
   PARTIAL" is expected offline, and model routes may show as unavailable.
5. Do not restart Hermes or its gateway yourself. Remind me to restart the Hermes CLI
   and any running Hermes gateway (Telegram, Discord and so on) so the plugin loads,
   and then to start a task with lit in front.
```

### Your first task

Restart the Hermes CLI or gateway so it loads the plugin, then give it a small task with `lit` in front:

```text
lit Build a to-do list in one HTML file without external dependencies. Implement add, complete, and delete; record what you checked and what remains.
```

If you prefer commands, `/lit <request>` does the same. On a Telegram gateway, use `/lit_loop` and `/lit_plan`.

### What you will see

The reply opens with a line of its own, `🔥 **LIT IGNITED · <discipline>** 🔥`. The name after the dot is the route that took the request: `litwork` for a plain `lit`, `lit-plan` for a plan. When you see it, the lit workflow has started; judge how it went from the result.

While a plan is being worked through, the reply also ends with a line that shows where the work stands, for example `🔥 LIT · lit-loop — 📝 plan ✓ › 🔨 WORK ▰▰▰▱▱▱▱ 3/7 › 🔍 · › 🏁 ·`. LitHermes builds it from the plan, the run and the litgoal criteria saved in the project. A step with nothing saved yet is left out, and file names and commands stay out of it.

Two smaller touches come with it. With a LitHermes skin active, the spinner turns in flame faces such as `(🔥 lit)` while Hermes works. Hermes can also ring the terminal bell when a turn finishes; that one is yours to switch on, by adding `--bell` to the install or answering yes when the installer asks, and a `display.bell_on_complete` value you already chose is kept.

When the task is done, open the HTML file and try each action yourself, and ask Hermes to separate the checks it actually ran from anything still unverified. Then type `/lit-handoff`. The result and the next step go into `HANDOFF.md` in the project. Closing the session stops the work, and that file is how it continues: next time, open a new session in the same project and ask Hermes to read the handoff before it carries on.

### Automatic handoff

A long session fills the model's context window. When it is full, Hermes compacts the conversation and older detail is lost. Automatic handoff has the model write the handoff before that point. Once it is saved, you run `/compact`, and the rest of the session starts from a written record. It is off by default, and you pick the percent yourself, since LitHermes has no built-in value. The choice is saved in your Hermes home at `~/.hermes/lithermes/auto-handoff.json`, so it follows you from project to project.

To switch it on, type `/lit-handoff auto on 60` inside a Hermes session, with any whole number from 1 to 99 in place of 60. The reply says what will happen and compares your percent with the point where Hermes would compact on its own. Later, `/lit-handoff auto status` shows the latest reading for the session, and `/lit-handoff auto off` switches it off and remembers your percent for next time.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/handoff/auto-handoff-switch-dark.webp" /><img src="./docs/assets/handoff/auto-handoff-switch-light.webp" width="690" alt="A terminal with a Hermes session. &quot;/lit-handoff auto on 60&quot; answers &quot;Automatic handoff is ON at 60%. Once a model call passes 60% of the context window, your next message carries a request to write a handoff, and you then run /compact. It starts with your next message.&quot; and &quot;Hermes' own compaction point is about 64% of the window, above yours.&quot;. Later in the session, &quot;/lit-handoff auto status&quot; answers &quot;Automatic handoff: ON at 60% (percent from your saved setting)&quot;, &quot;Last reading in this session: 41% (164,000 of 400,000 tokens)&quot; and &quot;Hermes' own compaction point is about 64% of the window, above yours.&quot;. Then &quot;/lit-handoff auto off&quot; answers &quot;Automatic handoff is off. Your last percent, 60%, is remembered for the next time you turn it on.&quot;." /></picture></p>

Once a model call passes your percent, your next message carries a short request to write a handoff. The model saves `HANDOFF.md` with the lit-handoff procedure, tells you `Handoff saved. Run /compact now.` and carries on with what you asked. Run `/compact` when it suits you. After the compaction, your next message brings a short digest of that handoff back to the model, and the work picks up where it stopped.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/handoff/auto-handoff-turn-dark.webp" /><img src="./docs/assets/handoff/auto-handoff-turn-light.webp" width="690" alt="A terminal with a Hermes session, after the last model call used 61% of the window, past the chosen 60%. The message &quot;add the CSV export to the reports page&quot; gets the reply &quot;Handoff saved. Run /compact now.&quot;, and the work goes on. Then the user types &quot;/compact&quot;, and after the compaction the next message, &quot;carry on with the CSV export&quot;, brings the handoff back." /></picture></p>

To have it on in every session, set `LITHERMES_AUTO_HANDOFF=1` and `LITHERMES_AUTO_HANDOFF_PERCENT=60` in the environment Hermes runs in, for example in your shell profile; these values win over the slash command. `hermes lithermes status` and `hermes lithermes doctor` each print one line about it. Keep your percent below Hermes' own compaction point, so the handoff is written before Hermes compacts; doctor warns you when it is at or above that point.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/handoff/auto-handoff-shell-dark.webp" /><img src="./docs/assets/handoff/auto-handoff-shell-light.webp" width="690" alt="A terminal. &quot;export LITHERMES_AUTO_HANDOFF=1 LITHERMES_AUTO_HANDOFF_PERCENT=60&quot;, then &quot;hermes lithermes status | grep 'Automatic handoff'&quot; prints &quot;Automatic handoff: on at 60%&quot;, and &quot;hermes lithermes doctor | grep 'Automatic handoff'&quot; prints &quot;[OK] Automatic handoff: on at 60% (Hermes compacts at about 64% of the window)&quot;." /></picture></p>

[Automatic handoff](./docs/automatic-handoff.md) goes through each step and says who does it.

## What you get

LitHermes installs 37 skills. These six are a good place to start.

### A task that ends checked

A plain `lit` keeps a notepad and takes each criterion through the same loop: a failing test, a passing one, a check against the running result, then cleanup. You get the change and a list of what was verified.

```text
lit fix the failing login test
```

### Plan first, then build

`lit plan` writes a plan file with numbered task rows and leaves your code alone. Once you approve it, `/start-work` runs the plan row by row and ticks a box only after all five gates pass.

```text
lit plan add CSV export to the reports page
```

### A review with five readers

`lit review` has two modes. A plan review checks a plan after `lit plan` and before `start-work`. A work review hands the finished change to five reviewers who read it separately, and each one leads with what it found. It picks the mode from what exists in your project, says which one it picked on its first line, and `lit review plan` or `lit review work` forces one.

```text
lit review the changes on this branch
```

### Research with sources

`lit research` splits a question, sends searchers out in parallel and follows every lead before it answers. Each claim comes back with its source, and anything it fetches is read as plain data.

```text
lit research how do popular CLIs migrate old config files?
```

### Reports, slides and diagrams

Ask for a report or a deck with `lit` and you get an editable Word or PowerPoint file with its Markdown source beside it. The skill picks a look for your reader, tells you which one and why, and checks the finished file before handing it over. `lit-diagram-drawer` does the same for diagrams.

```text
lit make a 10-slide deck from notes.md for Monday's team meeting
```

### Korean and English prose

`humanizer` rewrites stiff model prose so it reads like a person wrote it. It keeps the facts, hedges and register, shows you a before/after comparison and leaves your files as they are until you decide.

```text
humanizer 이 문단을 자연스러운 한국어로 다듬어줘: …
```

The other 30 cover debugging, refactoring, browser work, films, interfaces, scientific figures and more. [Skills and commands](./docs/skills.md) shows each one with a picture, and any skill also loads by name as `lithermes:<name>`.

## How it works

LitHermes is a Python plugin. When Hermes loads it, `register(ctx)` adds hooks, commands, skills and work tools. The hooks step in just before and after each model or tool call. The `goal_*` tools write your goals, and the evidence gathered for them, to local records in your project.

```mermaid
flowchart TD
    H["Hermes Agent"] --> P["Python plugin · register(ctx)"]
    P --> K["Hooks · before and after model and tool calls"]
    P --> S["Commands and skills · SKILL.md"]
    P --> T["goal_* work tools"]
    T <--> R["Project records · .hermes/lithermes/litgoal/"]
    R --> K
```

Before the next model call, the context hook reads those records and hands the model the current goal and how far it has got. The plugin decides where a request goes, and Hermes Agent still runs the model. Permissions, sign-in, model access and anything that needs a real screen stay with Hermes.

## Requirements, updates and removal

LitHermes needs Hermes Agent, Node.js 18 or later, and write access to your Hermes home.

It keeps itself up to date. When you run `install`, `check` or `doctor` in a terminal, or send the first message of an interactive Hermes CLI session, it looks for a newer stable release. If there is one, it backs up your plugin and settings, installs the new version and runs `doctor --offline`; if anything fails, the backup goes back in place. If you would rather install updates yourself, set `LITHERMES_NO_AUTO_UPDATE=1`. [Updates](./docs/install.md#updates) lists every step and switch.

Its records stay on your machine. Goals, plans and evidence live under `.hermes/lithermes/` in your project; the install record, update cache and backups live in your Hermes home. LitHermes goes online for two things of its own. It asks npm whether a newer version exists, which you can switch off with `LITHERMES_NO_UPDATE_CHECK=1`. And it downloads pinned helper tools when a skill first needs them: the film helpers during `install` (add `--offline` to skip it) and the Office tools the first time you make a Word or PowerPoint file. Your prompts go to whichever model provider Hermes is set up with, as before. [Privacy and local records](./docs/privacy.md) lists every file it writes.

To check an install without going online, or to remove it:

```sh
npx --package @litfamily/lithermes -- lithermes doctor --offline
npx --package @litfamily/lithermes -- lithermes uninstall --yes
```

If the installer made compatibility edits to your Hermes installation, add `--rollback-patches` when you uninstall so they are undone too. [When something goes wrong](./docs/install.md#when-something-goes-wrong) covers missing skills, name clashes and import errors.

## Learn more

- [Install, update and remove](./docs/install.md): every install option, how updates work, troubleshooting and limits
- [A tour of LitHermes](./docs/tour.md): screens from a first run, the short film, the Ignition skin and the LIT marks
- [Skills and commands](./docs/skills.md): all 37 skills with pictures, the command list, and what the document, film and prose skills make
- [Automatic handoff](./docs/automatic-handoff.md): handing work across a compaction, step by step
- <a href="./docs/guide.md"><img src="./docs/assets/readme/lucide-book-open.svg" width="16" alt="" /> Operating guide</a>: commands, natural routing, models, skins and safety in full
- <a href="./docs/assets/readme/ignition-film.mp4"><img src="./docs/assets/readme/lucide-play.svg" width="16" alt="" /> Ignition film</a> (MP4)
- [Python plugin contract](./packages/lithermes-installer/assets/lithermes-plugin/README.md) · [npm package page](./packages/lithermes-installer/README.md) · [Changelog](./CHANGELOG.md) · [Privacy](./docs/privacy.md) · [Migration](./docs/migration.md)

LitHermes belongs to [LitFamily](https://github.com/wjgoarxiv/litfamily), the same `lit` workflow ported to seven coding agents, each installed on its own.

## Contributing

If LitHermes has saved you from explaining a project all over again to a fresh session, a star helps other Hermes users find it.

Bug reports and pull requests are welcome. Start with [Contributing](./CONTRIBUTING.md), and see [Security](./SECURITY.md), [Conduct](./CODE_OF_CONDUCT.md) and [Support](./SUPPORT.md).

<a href="./LICENSE"><img src="./docs/assets/readme/lucide-shield-check.svg" width="16" alt="" /> MIT License</a>
