# Signal (`signal`)

One idea per slide for a room that listens: white ground, large type, few words, and a single
red-orange for the protagonist (the product, the ask, the bar that matters).

## Pick it when

- Pitches, launches, kickoffs and openings presented live in ten to fifteen minutes.
- Short bodies (≤ 40 Hangul glyphs or 80 Latin characters per slide): Signal up, density −1.
- The deck builds towards one decision.

## Pass on it when

- Readers study it later (Ledger, Gazette); mostly tables (no ledger-table or dashboard here); a
  photo-led product (Atlas, Studio); losses that must be red (red is the accent).

## Token summary

| Token | Value |
|---|---|
| ground, surface | #FFFFFF, #F4F4F5 |
| ink, ink-muted, line | #15131A, #55525C, #D4D4D8 |
| accent, accent-deep, accent-tint | #C8361A, #6E1A0C, #FBE7E2 |
| field, on-field | #C8361A, #FFFFFF |
| positive, negative | #1E7A3F, #15131A (losses in ink with ▼) |
| series | #C8361A, #15131A, #6B6870, #2F6F8F |
| faces | Pretendard Bold (display, title, numeral), Regular (body, label) |
| ramp | compact (body 13, title 26, display 36, cover 44 pt); no hero step |
| density, variance | 10, 6 (8-9 common for live talks) |
| radius, edge | 0, fill |
| decoration | colour-field, hairline-rule, numeral |

Large type means the display and cover steps on display slides; every number stays at or below
title size with label, basis and source.

## Title treatments by role

Allowed: `statement`, `top-plain-large`, `bottom-anchor`, `top-rule`. Defaults: content,
data-takeaway → top-plain-large; data, sequence, reference, definition → top-rule; image →
bottom-anchor; statement → statement (pull quotes or a display-led deck the user asked for; a claim
is never a title).

## Families and display slides

Families: `statement`, `big-number`, `image-split`, `asymmetric-feature`, `process`, `kpi-row`,
`chart-insight`, `full-chart`, `comparison`, `table-insight`, `quote`.

- Covers `cover-numeral`, `cover-typographic`, `cover-split-field`; sections `section-field`,
  `section-numeral`; closings `closing-statement`, `closing-ask` (amount-keyed rows with share
  bars, next step on a floor band).
- Display devices: cover `drench`, statement `open`, number `field`, closing `band`.
- Table: open, ink header without fill, hairlines top and bottom only, no banding, numbers
  right-aligned, bold totals, protagonist row on accent-tint. Chart: no gridlines, direct labels,
  protagonist in accent. Image: no frame.
- Fill order: step-up, change-family, anchor-visual, distribute.

## Do

- Keep the protagonist the only red on each slide.
- Back market and traction claims with a figure panel of two to four figures, each with a basis.
- Give each list item a figure, comparison or consequence; close with amount, use and date.

## Avoid

- Red for losses or warnings.
- More than two lines of display text.
- Cards and card grids.
- Bullet lists longer than four items.

## Worked slide

A figure panel with its evidence beside it.

```markdown
---
layout: big-number

## 반려동물 원격 진료 수요 규모

| 원격 상담 의향 | 야간 응급 문의 | 평균 왕복 시간 |
|---|---|---|
| 62% | 월 1.8회 | 54분 |
| 보호자 900명 응답 | 가구당, 오후 9시 이후 | 동물병원 방문 1회 |

> 수도권 반려가구 설문, 2026년 7월 (예시)

- 야간 문의의 70%는 방문이 필요 없는 상담으로 끝난다
- 왕복 시간이 길수록 원격 상담 의향이 높다 (1시간 이상 74%)
- 출처: 예시 반려가구 설문 900명, 2026년 7월 (예시)
---
```

## Example in this skill

```text
references/examples/01-pitch-signal-ko.md
```
