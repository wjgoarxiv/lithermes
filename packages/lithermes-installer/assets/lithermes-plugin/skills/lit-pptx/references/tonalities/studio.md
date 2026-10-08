# Studio (`studio`)

A magazine spread: the 12-column grid shows as hairlines, titles live in a side rail or open the
page large, splits are asymmetric, real figures stand as data panels, and dark ochre marks the one
thing to look at.

## Pick it when

- Brand, strategy and design stories, public lectures, portfolio narratives, visual-product pitches.
- Short bodies with a speaker carrying detail (Signal or Studio up).
- Second candidate for image-led decks; works without pictures through grid, rails and panels.

## Pass on it when

- Dense data reviews (Ledger, Night); Korean desk reads (Gazette); teaching with steps (Chalk).

## Token summary

| Token | Value |
|---|---|
| ground, surface | #FFFFFF, #F2F2F0 |
| ink, ink-muted, line | #141414, #525252, #D2D2CE |
| accent, accent-deep, accent-tint | #8A5A00, #4D3200, #F5ECD9 |
| field, on-field | #141414, #FFFFFF |
| positive, negative | #1E7A3F, #B3261E |
| series | #8A5A00, #141414, #525252, #3B5F7F |
| faces | Pretendard Bold (display, title, numeral), Regular (body, label) |
| ramp | compact (body 13, title 26, display 36 pt); figures ≤ title size |
| density, variance | 10, 8 (highest; no layout over 40 % of content slides) |
| radius, edge | 0, fill |
| decoration | column-hairlines, numeral, rail-fill, colour-field, caption-band |

## Title treatments by role

Allowed: `side-rail`, `statement`, `top-plain-large`, `bottom-anchor`, `overlay`. Defaults:
content, sequence, data-takeaway, reference, definition → side-rail; data → top-plain-large;
image → bottom-anchor; statement → statement (set offset). No kicker numeral.

## Families and display slides

Families: `asymmetric-feature`, `big-number`, `image-split`, `image-full`, `photo-grid`,
`text-two-column`, `chart-insight`, `kpi-row`, `timeline`, `comparison`, `statement`.

- `big-number` with two to four figures: a data panel (value, label, basis) on seven of twelve
  columns, evidence beside it.
- Covers `cover-split-image` (first when a picture exists), `cover-rail`, `cover-numeral`; sections
  `section-numeral`, `section-rail`; closings `closing-contact-split`, `closing-summary-list`.
- Display devices: statement `rules` (two hairlines; the offset rail stood empty), number `tint`, closing `band`.
- Table: open, ink header over a 2 pt ink rule, no row rules or banding, right-tabular, bold
  totals. Chart: no gridlines, direct labels, protagonist in accent, annotations on. Image: bleed
  and crop allowed, no frame.
- Fill order: change-family, step-up, anchor-visual, distribute.

## Do

- Large numerals only for real figures, each with label and basis.
- Alternate rail pages with top-titled data pages; give `text-two-column` bold heads with three or
  four sub-points.
- End with a contact split naming stages, fees or dates and the next meeting.

## Avoid

- Large numerals that are not real figures.
- Column hairlines through text.
- Two side-rail slides with the same split in a row.
- Centred body text.

## Worked slide

A figure panel with its evidence.

```markdown
---
layout: big-number

## 리브랜딩 후 첫 분기 매장 반응

| 매장 방문 | 재방문 비율 | 객단가 |
|---|---|---|
| 주 2만 3천 명 | 38% | 1만 8,400원 |
| 전 분기 1만 9천 명 | 전 분기 31% | 전 분기 1만 7,100원 |

> 직영 12개 매장, 2026년 7-9월 (예시)

- 방문은 21% 늘었고 증가분의 절반이 저녁 시간대에서 나왔다
- 새 포장 도입 매장의 재방문 비율이 그렇지 않은 매장보다 9%p 높다
- 출처: 예시 브랜드 POS 집계, 2026년 4-9월 (예시)
---
```

## Examples in this skill

```text
references/examples/09-image-led-studio-en.md
references/examples/11-lecture-studio-en.md
```
