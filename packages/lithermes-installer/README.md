<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.48/readme-assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.48/readme-assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: seven armored robots power on one by one, the LitHermes robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

<p align="center">
<a href="#install"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.48/readme-assets/badge-version.svg" alt="1.0.48" /></a>
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.48/readme-assets/badge-license.svg" alt="MIT license" /></a>
</p>

<p align="center">
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.md"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.48/readme-assets/lucide-book-open.svg" width="16" alt="" /> Guide</a> &nbsp;
<a href="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.48/readme-assets/ignition-film.mp4"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.48/readme-assets/lucide-play.svg" width="16" alt="" /> Ignition film</a> &nbsp;
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.48/readme-assets/lucide-shield-check.svg" width="16" alt="" /> MIT</a>
</p>

# LitHermes

**Keep the work lit.**

LitHermes is an add-on for [Hermes Agent](https://github.com/NousResearch/hermes-agent). It makes Hermes check its own work before it says "done", and leaves a note so the next session starts where this one stopped.

You ask Hermes for a feature. It writes the code and says it is finished, and a day later you find the tests never ran. You open a new session and explain the whole project again. With LitHermes you add `lit` to the same request. Hermes first writes down what "finished" means for this task, adds a test that fails, makes it pass, and ends by telling you what it checked and what it could not. When the session closes, it leaves a handoff note, and the next session in that project reads it and carries on.

**[README and docs on GitHub](https://github.com/wjgoarxiv/lithermes#readme)** · [한국어](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.48/README_Ko-KR.md)

## Install

You need Hermes Agent 0.21.3 or later, Node.js 18 or later, and write access to your Hermes home (normally `~/.hermes`).

```sh
npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes --no-style
```

The command copies the plugin into your Hermes home and switches it on, without stopping to ask; `--no-style` skips the question about reply style. To try it in a separate profile first, point `HERMES_HOME` at an empty directory before you install. [More install options](https://github.com/wjgoarxiv/lithermes/blob/main/docs/install.md).

## Your first task

Restart the Hermes CLI or gateway, then type:

```text
lit Build a to-do list in one HTML file without external dependencies. Implement add, complete, and delete; record what you checked and what remains.
```

The reply opens with a `🔥 **LIT IGNITED · <discipline>** 🔥` line once the lit workflow has started. In `hermes --tui`, a card under the prompt shows the goal, how much is proven and what comes next while your session has a lit goal. When the task is done, check the file yourself, then run `/lit-handoff` so the next session in this project can carry on from the note it writes. [Automatic handoff](https://github.com/wjgoarxiv/lithermes/blob/main/docs/automatic-handoff.md) is off by default; `/lit-handoff auto on 60` (a whole number from 1 to 99) asks for a handoff before you run `/compact`.

### Two ways to use it

**The easy way.** Write your request as usual and put `lit` at the start or at the end. Hermes sets the goal, writes a failing test, fixes the code, checks the result and tells you what it checked. The word works the same at either end: when it comes last, the words before it become the objective, so `fix the login redirect lit` gets the same goal question as `lit fix the login redirect` in a project with a test command. `lit-loop` and `litwork` work at the end too, and `lit continue` on its own carries on without asking for a new goal. Most tasks need nothing more:

```text
fix the date parsing bug in src/dates.py lit
```

**The full workflow.** For a bigger job, go one step at a time. Each step hands its result to the next, and you can skip any step you do not need.

| Step | Type | What happens |
| --- | --- | --- |
| 1. Explore | `lit brainstorm <question>` | Many options, then a short list with trade-offs |
| 2. Clarify | `/deep-interview <idea>` | Hermes asks questions until the goal is clear enough to build |
| 3. Plan | `lit-crucible <approach>` or `lit plan <task>` | Crucible attacks the approach first and hands what survives to a plan; `lit plan` writes the plan file and changes no code |
| 4. Build | `/start-work <plan file>` or `/lit-loop <task>` | Hermes does the work, with tests and checks along the way |
| 5. Review | `/review-work` | Five reviewers read the change separately and lead with what they found |
| 6. Hand off | `/lit-handoff` | The result and the next step go into `HANDOFF.md` in the project |

Both start from the one install line under [Install](#install).

## What you get

| Type | Skill | For |
|---|---|---|
| `lit <request>` or `/lit` | `litwork` | A task that ends with checked results |
| `lit-plan` or `/lit-plan` | `lit-plan` | A plan, before anything is edited |
| `/start-work <approved-plan>` | `start-work` | Running a plan you approved |
| `lit review [plan\|work] <target>` or `/review-work` | `review-work` | Reviewing a plan before `start-work`, or finished work after it |
| `lit brainstorm <ask>` | `lit-brainstorm` | Many options for an open ask, then a short list to pick from |
| `ultra-brainstorm <ask>` or `/ultra-brainstorm` | `ultra-brainstorm` | One question about how many idea children to launch, with the cost, then a judged top list. Read-only |
| `lit team <task>` or `/lit-team` | `lit-team` | This session leads the team: slices out, results merged and re-checked, one report; members never commit |
| `lit research <question>` | `litresearch` | Research with source notes |
| `/lit-humanizer` | `lit-humanizer` | Revising Korean or English prose, meaning kept |
| `/lit-diagram-drawer <brief>` | `lit-diagram-drawer` | A LitFamily extension on `wjgoarxiv-skills`: names the folder and the copy line |
| `/lit-schematic <brief>` | `lit-schematic` | A LitFamily extension on `wjgoarxiv-skills`: names the folder and the copy line |
| `/lit-pptx <brief>` | `lit-pptx` | A LitFamily extension on `wjgoarxiv-skills`: names the folder and the copy line |
| `/lit-docx <brief>` | `lit-docx` | A LitFamily extension on `wjgoarxiv-skills`: names the folder and the copy line |
| `/lit-hijack <brief>` | `lit-hijack` | A clean-room port of published know-how, licence-gated with parity proof |
| `/lit-adhd [recap [session]] [--here] [--since 7d] [--max 12] [--detail] [--en]` | `lit-adhd` | A six-line card across sessions: what changed, the one thing to do and what to type; `--detail` shows the KPI board, `recap` recaps one session (`/lit-recap` still works). Read-only |
| `/lit-typographic-motion <brief>` | `lit-typographic-motion` | A LitFamily extension on `wjgoarxiv-skills`: names the folder and the copy line |

On a Telegram gateway, use `/lit_loop` and `/lit_plan`. Every skill also loads by name as `lithermes:<name>`, for example `lithermes:review-work` or `lithermes:lit-humanizer`. [Skills and commands](https://github.com/wjgoarxiv/lithermes/blob/main/docs/skills.md) lists all 40; nine are stubs for the LitFamily extensions on `wjgoarxiv-skills`.

## Extensions

LitHermes's core is complete and works on its own. Nine skills that make files (decks, documents, figures, design and video covers) are LitFamily extensions, kept on the extension shelf [`wjgoarxiv-skills`](https://github.com/wjgoarxiv/wjgoarxiv-skills). Install the ones you use alongside LitHermes to get the full LitFamily experience. Each one has a Hermes edition, a single folder that goes into your profile before you start a new Hermes session. One command does it:

```sh
npx --package @litfamily/lithermes@latest -- lithermes extensions install lit-pptx --yes
```

It fetches a shallow copy of the shelf into its own cache folder (or uses your clone with `--from <path>`), stops and names the path when another skill of that name sits where Hermes reads skills, moves an old folder of that name whole into `extension-backups/` of the profile, so nothing old mixes into the copy, and writes a receipt beside it. Without `--yes` it only prints that plan. `extensions list`, `check`, `update`, `remove` and `prune-backups` do the rest. By hand, set `ID` and paste these lines in bash or zsh:

```sh
git clone https://github.com/wjgoarxiv/wjgoarxiv-skills.git
H="${HERMES_HOME:-$HOME/.hermes}"; ID=lit-pptx; SRC="$PWD/wjgoarxiv-skills/variants/lithermes/$ID"
[ -e "$H/skills/${ID:?}" ] && echo "taken: $H/skills/$ID" || echo "free: $H/skills/$ID"; grep -rlE --include=SKILL.md "^name: *[\"']?${ID}[\"']? *\$" "$H/skills" .hermes/skills .agents/skills 2>/dev/null; grep -A3 -E '^ *(external_dirs|create_dir):' "$H/config.yaml" 2>/dev/null
if [ -e "$H/skills/${ID:?}" ]; then mkdir -p "$H/extension-backups" && B=$(mktemp -d "$H/extension-backups/$(date +%Y%m%d-%H%M%S)-XXXX") && mv "$H/skills/$ID" "$B/" && echo "moved aside: $B/$ID"; fi
if [ -e "$H/skills/${ID:?}" ]; then echo "stopped: $H/skills/$ID is still there"; else mkdir -p "$H/skills" && cp -R "$SRC" "$H/skills/$ID" && echo "copied: $H/skills/$ID"; fi
printf '{"id":"%s","source":"%s","variant":"lithermes","installed_at":"%s"}\n' "${ID:?}" "$(printf %s "$SRC" | sed 's/[\\"]/\\&/g')" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$H/skills/$ID/.litfamily-extension.json"
```

Run `extensions update --yes`, or paste the last five lines again, to update. The installer prints this after an install or an upgrade, and the first Hermes reply after it shows it once. [The nine extensions and what each one makes](https://github.com/wjgoarxiv/lithermes/blob/main/docs/skills.md#moved-to-wjgoarxiv-skills).

## Check, update, remove

```sh
npx --package @litfamily/lithermes -- lithermes doctor --offline
npx --package @litfamily/lithermes -- lithermes uninstall --yes
```

`doctor --offline` checks the install without going online; add `--rollback-patches` when uninstalling if the installer patched Hermes. LitHermes updates itself with a backup and a rollback; set `LITHERMES_NO_AUTO_UPDATE=1` to update by hand. An install lock left by a crashed run clears itself on a later run. [Details and troubleshooting](https://github.com/wjgoarxiv/lithermes/blob/main/docs/install.md).

## Learn more

- [README on GitHub](https://github.com/wjgoarxiv/lithermes#readme) and [a tour with screenshots](https://github.com/wjgoarxiv/lithermes/blob/main/docs/tour.md)
- [Operating guide](https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.md): commands, natural routing, models, skins and safety
- [Changelog](https://github.com/wjgoarxiv/lithermes/blob/main/CHANGELOG.md) · [Privacy](https://github.com/wjgoarxiv/lithermes/blob/main/docs/privacy.md) · [Contributing](https://github.com/wjgoarxiv/lithermes/blob/main/CONTRIBUTING.md) · [Security](https://github.com/wjgoarxiv/lithermes/blob/main/SECURITY.md) · [Support](https://github.com/wjgoarxiv/lithermes/blob/main/SUPPORT.md)

MIT License. Part of [LitFamily](https://github.com/wjgoarxiv/litfamily).
