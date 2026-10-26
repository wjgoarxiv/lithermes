# Riso (`riso`)

Two spot inks on warm paper, the look of a risograph print. Teal fields carry the cover, the
sections, the statements and the band over a data title; pink marks the one word or figure that
matters on a content page. Surfaces and rules stay grey so the two inks are the only colours.

## Pick it when

- Community, culture and education programmes: workshops, festivals, library or museum
  programmes, student clubs, nonprofit annual gatherings, volunteer briefings.
- Programmes with dates and places, a few counts (participants, sessions, books), steps for
  taking part, words such as 워크숍, 프로그램, 축제, 동아리, 도서관, 주민, 참여, 자원봉사,
  community, programme, zine.

## Pass on it when

- Boards, finance, public-sector or sensitive topics (two bright inks read as unserious).
- Dense data reviews (Ledger) or general-public data stories that live on their charts (Newsroom).
- Grief, safety or financial-loss topics.

## Token summary

| Token | Value |
|---|---|
| ground, surface | #F5F0E6, #E4E2DE |
| ink, ink-muted, line | #1C2433, #4E5361, #C4C1BB |
| accent, accent-deep, accent-tint | #D1206B, #8A1043, #F8D5E3 |
| field, on-field | #00727A, #FFFFFF |
| positive, negative | #1D6B45, #1C2433 (losses in ink with ▼) |
| series | #D1206B, #00727A, #1C2433, #8A6A00 |
| faces | Pretendard Bold (display, title, numeral), Regular (body, label); `faces: a2z` swaps to A2Z Bold display, titles and numerals |
| ramp | compact at density 10 (body 13, title 26, display 36, cover 44 pt); hero step on fitting cover and statement titles |
| density, variance | 10, 7 |
| radius, edge | 6 / fill |
| decoration | mark-underline, colour-field, numeral |

The pink is the fluorescent ink darkened until it holds 4.5:1 on the paper, so it can set a word;
teal holds white type at 5.6:1. A loss uses ink with a ▼ sign, since pink is the accent. The
fourth series colour is an ochre that holds 3:1 on the paper. Teal and pink share a content slide
(a band title over a pink figure): the two inks are the register, not a gate limit. Surfaces and
rules stay grey on purpose: a warm beige card would read as a third hue family and fail.

## Title treatments by role

Allowed: `top-plain-large`, `band`, `kicker-numeral`, `statement`, `side-rail`. Defaults: content,
data-takeaway, image → top-plain-large (title over a pink underline); data, reference →
band (title in white on teal); sequence → kicker-numeral; definition → side-rail;
statement → statement.

## Families and display slides

Families: `agenda`, `summary-box-list`, `text-two-column`, `sidebar-note`, `comparison`,
`process`, `step-diagram`, `timeline`, `kpi-row`, `big-number`, `chart-insight`,
`table-insight`, `image-split`, `photo-grid`, `quote`, `statement`.

- Covers `cover-typographic`, `cover-numeral`, `cover-split-field`; sections `section-field`,
  `section-numeral`; closings `closing-ask`, `closing-summary-list`, `closing-statement`.
- Display devices: cover `drench` (page in teal, title in white), statement `drench`,
  number `field` (teal panel), closing `band`.
- Table: pink-tint header, rule under it, grey banding, bold totals. Chart: no gridlines, direct
  labels, accent on the highlighted series. Image: no frame.
- Fill order: change-family, distribute, step-up, anchor-visual.

## Do

- Keep full teal fields on display slides; on a content page teal is the title band and nothing more.
- Let pink mark one word or one figure on a content slide.
- Give every session a date, a place and who it is for.
- Write the way organisers talk to participants: short, plain, inviting.

## Avoid

- A third ink beside pink and teal (black is the type, not an ink).
- The fluorescent pink as text; the darkened accent is the type colour.
- Gradients, grain or halftone painted to fake the print.
- Teal blocks on content slides beyond the title band.
- This direction for a board, finance, public-sector or sensitive topic.

## Worked slide

A process slide shows how to take part, one step per row.

```markdown
---
layout: process

## 참여는 이렇게: 신청부터 첫 모임까지

- **1. 신청** 10월 31일까지 도서관 누리집에서 한 사람씩 신청한다
- **2. 안내 문자** 모임 사흘 전 장소와 준비물을 문자로 받는다
- **3. 첫 모임** 11월 7일 저녁 7시, 3층 다목적실에서 만난다
- **4. 소모임 배정** 첫 모임에서 관심사별로 다섯 명씩 나눈다
- 출처: 예시 도서관 운영 계획, 2026년 (예시)
---
```

## Example in this skill

```text
references/examples/16-community-programme-riso-ko.md
```
