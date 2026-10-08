# Atlas (`atlas`)

A captioned picture book: photographs bleed and bring the colour, titles sit on dark panels over a
picture or under a large one, text stays short. Slate blue marks the one figure to land on.

## Pick it when

- Product, portfolio, site, field and venue decks judged by seeing.
- Real photos or screenshots on a third of the slides or more (Atlas or Studio up, Gazette down).

## Pass on it when

- Few or no real images: the skill bundles no stock photos, and picture families turn into empty
  boxes (Studio or Ledger instead).
- Tables carry the argument: Atlas has no table family.
- A decision paper read at a desk (Gazette, Ledger).

## Token summary

| Token | Value |
|---|---|
| ground, surface | #FFFFFF, #F3F4F5 |
| ink, ink-muted, line | #1A1D21, #555B63, #D6D9DD |
| accent, accent-deep, accent-tint | #2B4C7E, #1B2F4E, #E6ECF4 |
| field, on-field | #1A1D21, #FFFFFF |
| positive, negative | #1E7A3F, #B3261E |
| series | #2B4C7E, #555B63, #8A6A2E, #3E7A5A |
| faces | Pretendard Regular (display, numeral, body, label), Bold (title) |
| ramp | compact (body 13, title 26 pt); figures ≤ title size |
| density, variance | 10, 7 |
| radius, edge | 0, fill |
| decoration | caption-band, hairline-rule, colour-field |

## Title treatments by role

Allowed: `overlay`, `bottom-anchor`, `side-rail`, `top-plain-large`, `statement`. Defaults:
content, reference, definition → side-rail; data, sequence → top-plain-large; data-takeaway →
bottom-anchor; image → overlay (dark panel over the photo); statement → statement.

## Families and display slides

Families: `image-full`, `image-split`, `photo-grid`, `figure-pair`, `asymmetric-feature`,
`kpi-row`, `comparison`, `timeline`, `text-column`, `statement`.

- Covers `cover-full-image`, `cover-split-image`, `cover-typographic`; sections `section-image`,
  `section-field`; closings `closing-contact-split`, `closing-ask`.
- Display devices: cover `plate`, statement `drench` (the whole page in the field), number `tint`, closing `band`.
- Picture families and image covers need a real file beside the source; without one use
  `cover-typographic`, `section-field`, `text-column`, `kpi-row`, `comparison`, `timeline`.
- Table (timeline, KPI and closing rows): light grid, ink header without fill, hairline rows,
  right-tabular. Chart: hairline grid, direct labels, accent over muted ink, no annotation.
  Image: bleed and crop allowed, no frame, cropped to its box in its own proportions.
- Fill order: anchor-visual, change-family, distribute, step-up.

## Do

- Caption every picture: `도 n.` / `Figure n.`, what, when, and its source after `|`.
- Pair each image-split picture with four to six labelled facts; use `figure-pair` for before and
  after.
- Back the pictures with a `kpi-row` of measured use near the end.

## Avoid

- Text set straight on a photograph.
- Pictures in card frames, or more than three in one row.
- Grey placeholder boxes in a delivered deck.

## Worked slide

A picture beside its facts (the photo is the user's own file next to the deck source).

```markdown
---
layout: image-split

## 동쪽 별관 1층 작업실 배치

![도 3. 공사 후 1층 작업실, 2026년 9월 | 출처: 예시 사진](photos/annex-workshop.jpg)

- **면적** 140㎡, 기존 창고 두 칸을 합쳤다
- **좌석** 작업대 12개, 한 번에 24명 (전 10명)
- **채광** 남쪽 창 4개를 넓혀 낮 조명 없이 작업 가능
- **동선** 재료 반입구를 작업실 바로 옆으로 옮김
- 출처: 예시 시설팀 준공 실측, 2026년 9월 (예시)
---
```

## Example in this skill

```text
references/examples/06-image-led-atlas-ko.md
```
