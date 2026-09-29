<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: five armored robots power on one by one, the LitHermes robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

<p align="center"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/ascii-readme.svg" width="480" alt="LIT ASCII B mark" /></p>

<p align="center">
<a href="#install"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/badge-version.svg" alt="1.0.11" /></a>
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/badge-license.svg" alt="MIT license" /></a>
</p>

<p align="center">
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.md"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/lucide-book-open.svg" width="16" alt="" /> Guide</a> &nbsp;
<a href="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/ignition-film.mp4"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/lucide-play.svg" width="16" alt="" /> Ignition film</a> &nbsp;
<a href="https://github.com/wjgoarxiv/lithermes/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/readme-assets/lucide-shield-check.svg" width="16" alt="" /> MIT</a>
</p>

# LitHermes

**Keep the work lit.**

A plugin for **Hermes Agent**. Add `lit` to a request, and Hermes plans the task, does it, checks it, and leaves a note the next session can pick up.

**[Full guide, skills gallery and A/B results on GitHub](https://github.com/wjgoarxiv/lithermes#readme)** · [한국어](https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.11/README_Ko-KR.md)

## Install

You need Hermes Agent, Node.js 18 or later, and write access to your Hermes home (normally `~/.hermes`).

```sh
npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes --no-style
```

The command puts the plugin into your Hermes home and updates your Hermes configuration without stopping to ask. That is why `--yes` appears twice: the first lets npx run the package, and the second approves the configuration changes. `--no-style` skips the picker for how replies are written; the Ignition skin installs either way. Nothing connects to Telegram during installation.

Want to try it away from your usual setup? Point `HERMES_HOME` at a new, empty directory before installing, and start Hermes with the same value. If the Hermes installation itself lives outside that trial profile, add `--no-patch-installed-hermes` so the installer leaves it without compatibility edits.

## Your first task

Restart the Hermes CLI or gateway, then type:

```text
lit Build a to-do list in one HTML file without external dependencies. Implement add, complete, and delete; record what you checked and what remains.
```

The reply opens with a single `🔥 **LIT IGNITED · <discipline>** 🔥` line. When you see it, LitHermes has picked up the task and the work has started. When it finishes, open the file and try each action yourself, and ask Hermes to separate what it actually checked from what is still unverified. Then run `/lit-handoff`. A new session in the same project can read that handoff and continue from it.

The spark is that record. Once the session closes, nothing carries on in the background; the next session picks the work up from the handoff.

## Routes you will use most

| Type | Skill | For |
|---|---|---|
| `lit <request>` or `/lit` | `litwork` | A bounded task that ends with checked results |
| `lit-plan` or `/lit-plan` | `lit-plan` | A plan, before anything is edited |
| `/start-work <approved-plan>` | `start-work` | Running a plan you approved |
| `lit review <target>` or `/review-work` | `review-work` | Reviewing a plan or a result |
| `lit research <question>` | `litresearch` | Research with source notes |
| `handoff` or `/lit-handoff` | `lit-handoff` | Carrying the work into the next session |
| `/lit-humanizer` | `lit-humanizer` | Revising Korean or English prose without changing its meaning |
| `/lit-diagram-drawer <brief>` | `lit-diagram-drawer` | A checked, editable diagram |
| `/lit-pptx <brief>` | `lit-pptx` | A PowerPoint deck with its Markdown source |
| `/lit-docx <brief>` | `lit-docx` | A styled Word report with its Markdown source |
| `/lit-typographic-motion <brief>` | `lit-typographic-motion` | A short film, treatment first |

On a Telegram gateway, use `/lit_loop` and `/lit_plan`. Every skill also loads by name as `lithermes:<name>`, for example `lithermes:lit-pptx` or `lithermes:lit-docx`. The other bundled skills are `litgoal`, `lit-recap`, `deep-interview`, `lit-crucible`, `lit-init`, `lit-comprehend`, `frontend-ui-ux`, `readme-studio`, `lit-scientific-visualization`, `visual-qa`, `browser-drive`, `structural-search`, `wikify`, `debugging`, `refactor`, `lit-burnoff`, `lit-burnoff-file`, `lit-code`, `lit-commit`, `lsp-setup`, `lsp`, `rules`, `comment-checker`, `autoresearch` and `autoconference`. The GitHub page shows each one with a picture.

## Making more than code

- **Reports and slides.** Ask for a report or a presentation with a bare `lit`, and it goes to `lit-docx` or `lit-pptx`. You get a DOCX, a PPTX or both, with the Markdown source beside them. Unless you choose otherwise, Korean documents use the korean-generic profile and slides use AZURE-PRO with Pretendard. The first time, the Office runtime installs the pinned tools it needs into a LitHermes cache.
- **Diagrams.** `lit-diagram-drawer` draws concept maps and technical diagrams. Product pages belong to `frontend-ui-ux`, and plots of measured data to `lit-scientific-visualization`.
- **Films.** `lit-typographic-motion` writes a treatment first. When the film passes its final check, you get a 60 fps film with a poster, a reduced-motion still and a QA report. A render never downloads anything, so its helper packages and fonts must already be cached. `lithermes install` tries to fetch them; if that was skipped or failed, run `lithermes motion-runtime install`. `lithermes motion-runtime status` shows whether Chrome, ffmpeg, WebGL2 and the fonts are ready.
- **Prose.** `lit-humanizer` revises Korean and English drafts while keeping their facts. Its detector reads what Hermes writes for people through `write_file` and `patch`. A serious (block-tier) finding can stop the write; a milder warning comes back as advice.

## What changes after install


- The plugin goes into your Hermes home. After a restart, Hermes has new hooks, commands, skills and `goal_*` work tools.
- Goals, plans and evidence are written to local records under `.hermes/lithermes/` in your project, where the next session can read them.
- The Hermes CLI gains the Ignition skin. Choose it with `/skin lithermes-ignition` and restart, or use `/skin lithermes-tokyonight-day` on a light terminal and `/skin lithermes-tokyonight` on a dark one. A fresh interactive, color-capable install run with `--yes` selects Ignition only when `display.skin` is absent, and existing skin files are kept.
- LitHermes looks for a newer release at most once every 24 hours and saves the answer in `update-check.json`; any update notice is read from there. It suggests a command such as `npx --yes --package @litfamily/lithermes@<version> -- lithermes install --yes --no-hud`, and running it is up to you. With `--offline`, `--json` or `--dry-run`, in CI, or when output is piped, nothing is installed. To stop the check, set `NO_UPDATE_NOTIFIER=1` or `LITHERMES_NO_UPDATE_CHECK=1`.
- LitHermes decides where a request goes; Hermes Agent still runs the model.

## Does it help?

Ten casual one-line Korean prompts were each run once in Hermes Agent v0.21.3 with `gpt-6-sol` at reasoning `high`, as written and with ` lit` added at the end. A blind judge compared each pair in both orders, and the maintainer made the final call.

| Task | Prompt | Final verdict | Blind judge (same round) |
|---|---|---|---|
| S1 · Terminal to-do CLI | 터미널에서 쓰는 할 일 관리 CLI 만들어줘 | Tie | Baseline won |
| S2 · API server bugs | 이 API 서버 가끔 이상하게 동작하는데 고쳐줘 | Tie | Tie |
| S3 · Budget dashboard (UI round) | 개인 가계부 대시보드 웹페이지 만들어줘 | **LitHermes won** | LitHermes won |
| S4 · Café landing page (UI round) | 동네 카페 브랜드 랜딩페이지 만들어줘 | **LitHermes won** | LitHermes won |
| S5 · Report and slides from sources (office round) | sources 폴더 자료로 보고서랑 발표자료 만들어줘 | **LitHermes won** | LitHermes won |
| S6 · Node 22→24 research | Node 22에서 24로 올릴 때 달라지는 거 조사해줘 | **LitHermes won** | Tie |
| S7 · Order, payment and shipping diagram | 주문-결제-배송 서비스 구조도 그려줘 | **LitHermes won** | LitHermes won |
| S8 · Quarterly results deck (office round) | 분기 실적 발표자료 만들어줘 | **LitHermes won** | Baseline won |
| S9 · New product plan (office round) | 신제품 기획서 써줘 | **LitHermes won** | LitHermes won |
| S11 · Meeting-room booking web app (UI round) | 회의실 예약 웹앱 만들어줘 | **LitHermes won** | Tie |
| Total | | **8 won, 2 tied, 0 lost** | 5 won, 3 tied, 2 lost |

The judge preferred the baseline in S1 and S8. What each side produced, the screenshots, and the notes on which tasks came from later rounds are on GitHub. The motion cover at the top was made with the LitFamily motion skill. That skill (`lit-typographic-motion` here) was rebuilt after its first A/B and has no A/B result yet.

## Optional: Jev skill hint

This is off by default. With `LITHERMES_JEV=1` and your own `TYPESAFE_API_KEY` set in the environment Hermes runs in, LitHermes asks Jev, TypeSafe's hosted decision model, which bundled skill fits a plain prompt. The answer is added to that turn's context as one line of advice. It is only a suggestion: the Hermes model still decides, and the hint cannot grant permissions or start tools.

While it is on, each eligible prompt is sent to TypeSafe (typesafe.ai), truncated to 2,000 characters, with home paths, email addresses and token-shaped strings redacted. Anything without a token shape is sent as written, such as hostnames, customer names, and passwords not written as `password=...`. In gateway mode, other participants' messages in a chat are eligible too. The agent's own tools can read the exported key, so use a dedicated key with a low spend limit; TypeSafe bills your account, at about $0.04 per million input tokens. Each request stops after 1.5 seconds with no retry, and a failed request leaves the turn unchanged.

The first reply of each session starts with `✦ Jev skill hint ON`. Inside a Hermes session, `hermes lithermes status` and `hermes lithermes doctor` show that session's last hint, for example `Jev skill hint: on — last hint lit-humanizer (0.43s)`, or `on — no hint yet`. Outside any session they read `on — no session`; otherwise `off` or `flag on but TYPESAFE_API_KEY missing`. To turn it off, unset `LITHERMES_JEV` or set it to any value other than `1`. The full details are in the GitHub README and the [privacy notes](https://github.com/wjgoarxiv/lithermes/blob/main/docs/privacy.md).

## Check, remove, stay safe

```sh
npx --package @litfamily/lithermes -- lithermes doctor --offline
npx --package @litfamily/lithermes -- lithermes uninstall --yes
```

`doctor --offline` checks the install without going online. If the installer made compatibility edits to Hermes, add `--rollback-patches` when uninstalling to undo them. Uninstalling keeps the skin files and your `display.skin` choice; `npx --package @litfamily/lithermes -- lithermes hud off` clears the choice and keeps the files.

- To see what the installer would change before it changes anything, run `lithermes install --dry-run`.
- Code, quotations and commands you paste in are treated as text to read, never as instructions. Secrets are masked before anything is saved or passed to a model.
- Hermes' own `/goal` belongs to you: LitHermes does not watch it and never updates, clears or resumes it. LitHermes goes by the goals it saves through its `goal_*` tools.
- Hermes sends every helper through one shared model setting, so there is no per-task model and no separate reviewer model. The installer's report shows what was configured; only the receipt of a real `delegate_task` run proves which model a helper used.
- If Lit skills seem to be missing, ask Hermes to call its `skills_list` tool and look for LitHermes entries; the `/skills` command only reads the filesystem, and its list can differ by Hermes version. An import error in the Hermes log means the plugin failed to load. Keep the message rather than installing pip packages on a guess.
- If a same-named skill elsewhere hides a LitHermes one, `lithermes doctor` prints a `skill shadow check: WARNING` line. Load the LitHermes copy as `lithermes:<name>`. The warning leaves doctor's exit status as it was.

## Learn more

- [Full README on GitHub](https://github.com/wjgoarxiv/lithermes#readme): the skills gallery, the A/B results with screenshots, and how it works
- [Operating guide](https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.md): commands, models, skins and troubleshooting
- [Changelog](https://github.com/wjgoarxiv/lithermes/blob/main/CHANGELOG.md) · [Contributing](https://github.com/wjgoarxiv/lithermes/blob/main/CONTRIBUTING.md) · [Security](https://github.com/wjgoarxiv/lithermes/blob/main/SECURITY.md) · [Support](https://github.com/wjgoarxiv/lithermes/blob/main/SUPPORT.md)

MIT License.
