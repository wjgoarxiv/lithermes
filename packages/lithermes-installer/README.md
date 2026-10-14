<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.22/readme-assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.22/readme-assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: five armored robots power on one by one, the LitHermes robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

<p align="center">
<a href="#install"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.22/readme-assets/badge-version.svg" alt="1.0.22" /></a>
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.22/readme-assets/badge-license.svg" alt="MIT license" /></a>
</p>

<p align="center">
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.md"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.22/readme-assets/lucide-book-open.svg" width="16" alt="" /> Guide</a> &nbsp;
<a href="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.22/readme-assets/ignition-film.mp4"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.22/readme-assets/lucide-play.svg" width="16" alt="" /> Ignition film</a> &nbsp;
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.22/readme-assets/lucide-shield-check.svg" width="16" alt="" /> MIT</a>
</p>

# LitHermes

**Keep the work lit.**

A plugin for **Hermes Agent**. Put `lit` in front of a request, and Hermes plans the task, does it, checks what it did and leaves a note that the next session can pick up.

**[README and docs on GitHub](https://github.com/wjgoarxiv/lithermes#readme)** · [한국어](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.22/README_Ko-KR.md)

## Install

You need Hermes Agent, Node.js 18 or later, and write access to your Hermes home (normally `~/.hermes`).

```sh
npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes --no-style
```

It installs the plugin and updates your Hermes configuration without stopping to ask; `--no-style` skips the reply-style picker. To try it in a separate profile, set `HERMES_HOME` to an empty directory first. [More install options](https://github.com/wjgoarxiv/lithermes/blob/main/docs/install.md).

## Your first task

Restart the Hermes CLI or gateway, then type:

```text
lit Build a to-do list in one HTML file without external dependencies. Implement add, complete, and delete; record what you checked and what remains.
```

Once the work has started, the reply opens with a `🔥 **LIT IGNITED · <discipline>** 🔥` line. When it finishes, check the file yourself, then run `/lit-handoff` so the next session in this project can continue. [Automatic handoff](https://github.com/wjgoarxiv/lithermes/blob/main/docs/automatic-handoff.md) is off by default; `/lit-handoff auto on 60` (a whole number from 1 to 99) asks for a handoff before you run `/compact`.

## What you get

| Type | Skill | For |
|---|---|---|
| `lit <request>` or `/lit` | `litwork` | A task that ends with checked results |
| `lit-plan` or `/lit-plan` | `lit-plan` | A plan, before anything is edited |
| `/start-work <approved-plan>` | `start-work` | Running a plan you approved |
| `lit review <target>` or `/review-work` | `review-work` | Reviewing a plan or a result |
| `lit research <question>` | `litresearch` | Research with source notes |
| `/lit-humanizer` | `lit-humanizer` | Revising Korean or English prose, meaning kept |
| `/lit-diagram-drawer <brief>` | `lit-diagram-drawer` | A checked, editable diagram |
| `/lit-pptx <brief>` | `lit-pptx` | A PowerPoint deck in one of eight named looks, with its Markdown source |
| `/lit-docx <brief>` | `lit-docx` | A restrained Word document in one of six named shapes, with its Markdown source |
| `/lit-typographic-motion <brief>` | `lit-typographic-motion` | A short film, treatment first |

On a Telegram gateway, use `/lit_loop` and `/lit_plan`. Every skill also loads by name as `lithermes:<name>`, for example `lithermes:lit-pptx` or `lithermes:lit-docx`. [Skills and commands](https://github.com/wjgoarxiv/lithermes/blob/main/docs/skills.md) shows all 36 with pictures.

## Check, update, remove

```sh
npx --package @litfamily/lithermes -- lithermes doctor --offline
npx --package @litfamily/lithermes -- lithermes uninstall --yes
```

`doctor --offline` checks the install without going online; add `--rollback-patches` when uninstalling if the installer patched Hermes. LitHermes updates itself with a backup and a rollback; set `LITHERMES_NO_AUTO_UPDATE=1` to update by hand. [Details and troubleshooting](https://github.com/wjgoarxiv/lithermes/blob/main/docs/install.md).

## Learn more

- [README on GitHub](https://github.com/wjgoarxiv/lithermes#readme) and [a tour with screenshots](https://github.com/wjgoarxiv/lithermes/blob/main/docs/tour.md)
- [Operating guide](https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.md): commands, natural routing, models, skins and safety
- [Optional Jev skill hint](https://github.com/wjgoarxiv/lithermes/blob/main/docs/jev.md): off by default; sends eligible prompts to a third-party service when on
- [Changelog](https://github.com/wjgoarxiv/lithermes/blob/main/CHANGELOG.md) · [Privacy](https://github.com/wjgoarxiv/lithermes/blob/main/docs/privacy.md) · [Contributing](https://github.com/wjgoarxiv/lithermes/blob/main/CONTRIBUTING.md) · [Security](https://github.com/wjgoarxiv/lithermes/blob/main/SECURITY.md) · [Support](https://github.com/wjgoarxiv/lithermes/blob/main/SUPPORT.md)

MIT License. Part of [LitFamily](https://github.com/wjgoarxiv/litfamily).
