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

The first `--yes` lets npx run the package; the second approves the changes to your Hermes configuration. `--no-style` skips the reply-style picker and leaves the Ignition skin alone. Nothing connects to Telegram during installation.

To try it apart from your usual setup, set `HERMES_HOME` to a new, empty directory before installing and start Hermes with the same value. Adding `--no-patch-installed-hermes` also keeps compatibility edits away from the Hermes installation outside that profile.

## Your first task

Restart the Hermes CLI or gateway, then type:

```text
lit Build a to-do list in one HTML file without external dependencies. Implement add, complete, and delete; record what you checked and what remains.
```

The reply begins with exactly one `🔥 **LIT IGNITED · <discipline>** 🔥` line, so you can tell the route took. When it finishes, open the file and try each action yourself, and ask Hermes to separate what it actually checked from what is still unverified. Then run `/lit-handoff`. A new session in the same project can read that handoff and continue from it.

The spark is the record you leave. It does not mean work keeps running after the session closes.

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

- **Reports and slides.** A report or presentation request with a bare `lit` goes to `lit-docx` or `lit-pptx`. You get DOCX, PPTX or both, with the Markdown source beside them. Korean documents default to the korean-generic profile and slides to AZURE-PRO with Pretendard, unless you choose otherwise. On first use the Office runtime installs pinned dependencies into a LitHermes cache.
- **Diagrams.** `lit-diagram-drawer` makes conceptual and technical diagrams. Product pages stay with `frontend-ui-ux`, and plots of measured data with `lit-scientific-visualization`.
- **Films.** `lit-typographic-motion` writes a treatment first, and when its gate passes you get a 60 fps film with a poster, a reduced-motion still and a QA report. Run `lithermes motion-runtime status` to check Chrome, ffmpeg, WebGL2 and fonts, and `lithermes motion-runtime install` to fetch dependencies ahead of time.
- **Prose.** `lit-humanizer` revises Korean and English drafts while keeping their facts. Its detector checks reader-facing text written through Hermes `write_file` and `patch`: a block-tier finding can stop the write, and warnings are advice.

## What changes after install


- The plugin goes into your Hermes home. After a restart, Hermes has new hooks, commands, skills and `goal_*` work tools.
- Goals, plans and evidence are written to local records under `.hermes/lithermes/` in your project, where the next session can read them.
- The Hermes CLI gains the Ignition skin. Choose it with `/skin lithermes-ignition` and restart, or use `/skin lithermes-tokyonight-day` on a light terminal and `/skin lithermes-tokyonight` on a dark one. A fresh interactive, color-capable install run with `--yes` selects Ignition only when `display.skin` is absent, and existing skin files are kept.
- Update notices are cache-only, and you decide whether to act on them. The check runs at most once every 24 hours through `update-check.json`; `--offline`, `--json`, `--dry-run`, CI and piped streams never install updates. The notice suggests `npx --yes --package @litfamily/lithermes@<version> -- lithermes install --yes --no-hud`. Set `NO_UPDATE_NOTIFIER=1` or `LITHERMES_NO_UPDATE_CHECK=1` to turn the check off.
- LitHermes routes the request; Hermes Agent still runs the model.

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

This is off by default. With `LITHERMES_JEV=1` and your own `TYPESAFE_API_KEY` set in the environment Hermes runs in, LitHermes asks Jev, TypeSafe's hosted decision model, which bundled skill fits a plain prompt. The answer becomes one advisory line in that turn's context. The Hermes model still decides, and the hint grants no permission and starts no tool.

While it is on, each eligible prompt is sent to TypeSafe (typesafe.ai), truncated to 2,000 characters, with home paths, email addresses and token-shaped strings redacted. Anything without a token shape is sent as written, such as hostnames, customer names, and passwords not written as `password=...`. In gateway mode, other participants' messages in a chat are eligible too. The agent's own tools can read the exported key, so use a dedicated key with a low spend limit; TypeSafe bills your account, at about $0.04 per million input tokens. Each request stops after 1.5 seconds with no retry, and a failed request leaves the turn unchanged.

The first reply of each session starts with `✦ Jev skill hint ON`. Inside a Hermes session, `hermes lithermes status` and `hermes lithermes doctor` show that session's last hint, for example `Jev skill hint: on — last hint lit-humanizer (0.43s)`, or `on — no hint yet`. Outside any session they read `on — no session`; otherwise `off` or `flag on but TYPESAFE_API_KEY missing`. To turn it off, unset `LITHERMES_JEV` or set it to any value other than `1`. The full details are in the GitHub README and the [privacy notes](https://github.com/wjgoarxiv/lithermes/blob/main/docs/privacy.md).

## Check, remove, stay safe

```sh
npx --package @litfamily/lithermes -- lithermes doctor --offline
npx --package @litfamily/lithermes -- lithermes uninstall --yes
```

If compatibility patches were installed, add `--rollback-patches` when uninstalling. Uninstalling leaves the skin files and `display.skin` in place; `npx --package @litfamily/lithermes -- lithermes hud off` clears that choice and keeps the files.

- Preview configuration changes with `lithermes install --dry-run`. Code, quotations and copied commands remain inert data, and secrets are redacted before persistence or model handoff.
- Native `/goal` is user-managed and unobserved. Durable `goal_*` state is authoritative; there is no automatic update, clear, or resume of native `/goal`.
- Hermes uses one global child model route. Per-task model overrides and named reviewer routes are unavailable, and a configuration receipt does not prove which route a child actually ran on.
- If Lit skills seem to be missing, ask Hermes to call its `skills_list` tool and look for LitHermes entries. The filesystem-only `/skills` listing may differ by host version. An import error in the Hermes log is a loading failure, not a missing pip package to install on a guess.
- If a same-named skill elsewhere shadows a LitHermes one, `lithermes doctor` prints a `skill shadow check: WARNING` line. Load the LitHermes copy as `lithermes:<name>`. The warning never changes doctor's exit status.

## Learn more

- [Full README on GitHub](https://github.com/wjgoarxiv/lithermes#readme): the skills gallery, the A/B results with screenshots, and how it works
- [Operating guide](https://github.com/wjgoarxiv/lithermes/blob/main/docs/guide.md): commands, models, skins and troubleshooting
- [Changelog](https://github.com/wjgoarxiv/lithermes/blob/main/CHANGELOG.md) · [Contributing](https://github.com/wjgoarxiv/lithermes/blob/main/CONTRIBUTING.md) · [Security](https://github.com/wjgoarxiv/lithermes/blob/main/SECURITY.md) · [Support](https://github.com/wjgoarxiv/lithermes/blob/main/SUPPORT.md)

MIT License.
