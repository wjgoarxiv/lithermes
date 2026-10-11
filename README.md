<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="./docs/assets/cover-motion-still.webp" /><img src="./docs/assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: five armored robots power on one by one, the LitHermes robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

# LitHermes

**Keep the work lit.**

LitHermes is a plugin for [Hermes Agent](https://github.com/NousResearch/hermes-agent). Put `lit` in front of a request, and Hermes plans the task, does it, checks what it did and leaves a note that the next session can pick up.

<p align="center">
<a href="https://www.npmjs.com/package/@litfamily/lithermes"><img src="https://img.shields.io/npm/v/%40litfamily%2Flithermes?style=flat-square&label=npm&labelColor=080d14&color=ff6337" alt="npm version" /></a>
<a href="https://www.npmjs.com/package/@litfamily/lithermes"><img src="https://img.shields.io/npm/dm/%40litfamily%2Flithermes?style=flat-square&label=downloads&labelColor=080d14&color=ff6337" alt="npm downloads per month" /></a>
<a href="./LICENSE"><img src="https://img.shields.io/github/license/wjgoarxiv/lithermes?style=flat-square&labelColor=080d14&color=d7f75b" alt="MIT license" /></a>
<a href="https://github.com/wjgoarxiv/lithermes/stargazers"><img src="https://img.shields.io/github/stars/wjgoarxiv/lithermes?style=flat-square&labelColor=080d14&color=f2efdf" alt="GitHub stars" /></a>
</p>

<p align="center"><a href="#install">Install</a> · <a href="#your-first-task">First task</a> · <a href="#what-you-get">What you get</a> · <a href="#learn-more">Learn more</a> · <a href="./README_Ko-KR.md">한국어</a> · <a href="https://www.npmjs.com/package/@litfamily/lithermes">npm</a></p>

<p align="center"><img src="./docs/assets/demo.webp" width="960" alt="A short film of a real Hermes session in a small Node project, with the waiting shortened. Hermes starts with the LitHermes mark and &quot;LIT ready&quot;, and the prompt &quot;lit add a --shout flag that prints the greeting in capitals, with a test&quot; is typed and sent. The agent says it will add --shout and a test, adds the test, runs npm run test and sees it fail, patches greet.js and checks the output, then answers: Added --shout in greet.js, npm run test pass 2 fail 0, node greet.js Ada --shout prints HELLO, ADA!. The LIT mark and &quot;🔥 LIT IGNITED · litwork 🔥&quot; close the turn." /></p> <!-- demo-gif -->

<p align="center"><sub>A real Hermes session with LitHermes installed, recorded in a terminal. Waiting time is shortened, and the project folder and the home folder are shown as ~/greet and ~; the rest is as Hermes printed it. More screens are in <a href="./docs/tour.md">the tour</a>.</sub></p>

## Why LitHermes

Hermes Agent does what you ask in the moment. The trouble starts when a task outlives one session. The conversation gets compacted, the terminal closes, and the next time you sit down you have to piece together what was decided, what was really tested and what was left half done.

LitHermes gives that work a record. Add `lit` to a request and the task gets checkable criteria, a test that fails before the change and passes after it, a check against the running result, and a handoff note in your project. Goals, plans and evidence stay on disk, so the next session can read where things stand and carry on.

```text
Plan → Make → Check → Leave the next step
```

## Quick start

### Install

You need Hermes Agent, Node.js 18 or later, and write access to your Hermes home (normally `~/.hermes`). This page describes `@litfamily/lithermes@1.0.18`.

```sh
npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes --no-style
```

This puts the plugin into your Hermes home and updates the Hermes configuration so the plugin loads, without stopping to ask. `--no-style` skips the picker for how replies are worded. If you would like to try LitHermes before it touches your everyday setup, point `HERMES_HOME` at a new, empty directory first and start Hermes with the same value. The first install also downloads the film helpers, so it can take a minute. The report may list some model routes as unavailable when Hermes cannot be verified; `lithermes doctor --offline` is the check that matters. The [install page](./docs/install.md) explains each flag, the trial profile and installing from a reviewed `.tgz`.

### Your first task

Restart the Hermes CLI or gateway so it loads the plugin. Then give it a task with `lit` in front:

```text
lit Build a to-do list in one HTML file without external dependencies. Implement add, complete, and delete; record what you checked and what remains.
```

`/lit <request>` does the same thing as a command. On a Telegram gateway, use `/lit_loop` and `/lit_plan`.

### What you will see

The reply opens with one line of its own, `🔥 **LIT IGNITED · <discipline>** 🔥`. The name after the dot is the route that took the request: `litwork` for a plain `lit`, `lit-plan` for a plan. That line only tells you the work has started; whether it went well is for you to judge from the result.

When it finishes, open the HTML file and try each action yourself. Ask Hermes to separate the checks it actually ran from anything still unverified. Then type `/lit-handoff`, and the result and the next step are written to `HANDOFF.md` in the project. Next time, open a new session in the same project and ask Hermes to read the handoff before it continues. When the session closes, the work stops, and the handoff file is what the next session reads to continue.

Long sessions can do this for you. Automatic handoff is off by default. `/lit-handoff auto on 60` (any whole number from 1 to 99) asks the model for a handoff once a call passes that share of the context window, and then you run `/compact`. [Automatic handoff](./docs/automatic-handoff.md) explains who does each step.

## What you get

LitHermes installs 36 skills. These six are a good place to start.

**A task that ends checked.** A plain `lit` keeps a notepad and takes each criterion through the same loop: a failing test, a passing one, a check against the running result, then cleanup. You get the change and a list of what was verified.

```text
lit fix the failing login test
```

**Plan first, then build.** `lit plan` writes a plan file with numbered task rows and edits nothing. Once you approve it, `/start-work` runs the plan row by row and checks a box only after all five gates pass.

```text
lit plan add CSV export to the reports page
```

**A review with five readers.** `lit review` hands the same change to five reviewers who read it separately. Each one leads with what it found.

```text
lit review the changes on this branch
```

**Research with sources.** `lit research` splits a question, sends searchers out in parallel and follows every lead before it answers. Each claim comes back with its source, and anything fetched is read as plain data.

```text
lit research how do popular CLIs migrate old config files?
```

**Reports, slides and diagrams.** Ask for a report or a deck with `lit` and you get an editable Word or PowerPoint file with its Markdown source beside it. The skill picks a look for your reader, tells you which one and why, and checks the finished file before handing it over. `lit-diagram-drawer` does the same for diagrams.

```text
lit make a 10-slide deck from notes.md for Monday's team meeting
```

**Korean and English prose.** `humanizer` rewrites stiff model prose so it reads like a person wrote it. It keeps the facts, hedges and register, shows you a before/after comparison and edits no file on its own.

```text
humanizer 이 문단을 자연스러운 한국어로 다듬어줘: …
```

The other 30 cover debugging, refactoring, browser work, films, interfaces, scientific figures and more. [Skills and commands](./docs/skills.md) shows each one with a picture. Any skill also loads by name as `lithermes:<name>`.

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

It keeps itself up to date. When you run `install`, `check` or `doctor` in a terminal, or send the first message of an interactive Hermes CLI session, it looks for a newer stable release. If there is one, it backs up your plugin and settings, installs the new version, runs `doctor --offline`, and puts the backup back if anything fails. Set `LITHERMES_NO_AUTO_UPDATE=1` if you would rather install updates yourself. [Updates](./docs/install.md#updates) lists every step and switch.

LitHermes keeps its records on your machine: goals, plans and evidence under `.hermes/lithermes/` in your project, and its install record, update cache and backups in your Hermes home. Its own network use is the npm version check, which `LITHERMES_NO_UPDATE_CHECK=1` switches off, and pinned helper tools: `install` downloads the film helpers once (skip it with `--offline`), and the Office tools download the first time you make a Word or PowerPoint file. Your prompts still go to whichever model provider Hermes is set up with. [Privacy and local records](./docs/privacy.md) lists every file it writes.

To check an install without going online, and to remove it:

```sh
npx --package @litfamily/lithermes -- lithermes doctor --offline
npx --package @litfamily/lithermes -- lithermes uninstall --yes
```

If the installer made compatibility edits to your Hermes installation, add `--rollback-patches` when you uninstall. [When something goes wrong](./docs/install.md#when-something-goes-wrong) covers missing skills, name clashes and import errors.

## Learn more

- [Install, update and remove](./docs/install.md): every install option, how updates work, troubleshooting and limits
- [A tour of LitHermes](./docs/tour.md): screens from a first run, the short film, the Ignition skin and the LIT marks
- [Skills and commands](./docs/skills.md): all 36 skills with pictures, the command list, and what the document, film and prose skills make
- [Automatic handoff](./docs/automatic-handoff.md): handing work across a compaction, step by step
- [Optional Jev skill hint](./docs/jev.md): an opt-in feature that sends eligible prompts to a third-party service
- <a href="./docs/guide.md"><img src="./docs/assets/readme/lucide-book-open.svg" width="16" alt="" /> Operating guide</a>: commands, natural routing, models, skins and safety in full
- <a href="./docs/assets/readme/ignition-film.mp4"><img src="./docs/assets/readme/lucide-play.svg" width="16" alt="" /> Ignition film</a> (MP4)
- [Python plugin contract](./packages/lithermes-installer/assets/lithermes-plugin/README.md) · [npm package page](./packages/lithermes-installer/README.md) · [Changelog](./CHANGELOG.md) · [Privacy](./docs/privacy.md) · [Migration](./docs/migration.md)

LitHermes belongs to [LitFamily](https://github.com/wjgoarxiv/litfamily), the same `lit` workflow ported to five coding agents. Each one installs on its own.

## Contributing

If LitHermes saves you from re-explaining a project to a fresh session, a star helps other Hermes users find it.

Bug reports and pull requests are welcome. Start with [Contributing](./CONTRIBUTING.md), and see [Security](./SECURITY.md), [Conduct](./CODE_OF_CONDUCT.md) and [Support](./SUPPORT.md).

<a href="./LICENSE"><img src="./docs/assets/readme/lucide-shield-check.svg" width="16" alt="" /> MIT License</a>
