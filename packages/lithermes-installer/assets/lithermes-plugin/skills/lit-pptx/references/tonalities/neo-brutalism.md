# Neo-Brutalism (`neo-brutalism`)

The loud direction, loud on purpose: every card a flat yellow block with a thick black border
and a hard black shadow offset down and right, no blur at all. Heavy tight titles, a saturated
blue topic band, one pink-red accent for the figure the slide is for, on warm cream. Nothing
soft: no gradients, no rounded corners, no glow. A poster or product sticker for a room that
should feel energy — and still legible, because every colour pair meets the contrast floor.

## Pick it when

- Startup pitches at demo days, consumer product launches, campaign kick-offs, creator or
  community events, hackathon finals, education decks for a young audience.
- One claim and two or three facts per slide; three or four headline numbers; a launch or
  sign-up ask; words such as 런칭, 출시, 데모데이, 캠페인, 크리에이터, or a bold, punchy,
  "brutalist" look. Second candidate for pitches after Signal; first for a bold, playful look.

## Pass on it when

- Formal reports, academic talks, board or finance reviews, decks read alone later (blocks take
  the space a reader needs; long paragraphs between thick borders read as noise).
- Grief, safety, HR or financial-loss topics; decks under a corporate brand guide.
- A brief that says "clean" or "minimal" (Signal, Studio); a brief that says "report"
  (Ledger, Gazette).

## Token summary

| Token | Value |
|---|---|
| ground, surface | #FFF5E1, #FFD43B (the yellow card) |
| ink, ink-muted, line | #111111, #3A3A3A, #111111 |
| accent, accent-deep, accent-tint | #D81B5C, #6B0F2E, #FFC9DA |
| field, on-field | #2F4BFF, #FFFFFF |
| positive, negative | #137A43, #111111 (losses in ink with ▼) |
| series | #D81B5C, #2F4BFF, #111111, #137A43 |
| faces | Pretendard Bold (display, title, numeral), Regular (body, label); `faces: a2z` swaps to A2Z Black display, titles and numerals |
| register, ramp | bold / presented; hero step on cover and fitting statements; figures at most title size |
| type voice | title tracking −2, display −3 |
| density, variance | 10, 7 |
| radius, edge | 0 / fill and border, 2.5 pt in ink |
| shadow | 6 pt offset at 45°, ink, fully opaque, no blur |
| decoration | colour-field, numeral |

This is the family's bold register: presented type and the hero step, filling the same slide-grid
zones as every other pack — the register changes the size inside a zone, never the zone. The
registry refuses presented type in a pack without `register: bold`. A KPI row keeps its bordered
cards: the card is this direction's figure. The pink accent is darkened until a pink figure on a
yellow card holds 3:1 at title size. The shadow is a real outer shadow with a blur of zero, so
PowerPoint, Keynote and LibreOffice draw the same hard edge. Every block of the blue field
carries the black border too. Gate allowance: `qa: offset-shadow` lets OF-120 pass the hard
shadow; any blur still fails.

## Title treatments by role

Allowed: `top-plain-large`, `band`, `kicker-numeral`, `statement`, `bottom-anchor`. Defaults:
content, data-takeaway → top-plain-large; data, sequence, reference, definition → band (title in
white on the blue band); image → bottom-anchor; statement → statement.

## Families and display slides

Families: `big-number`, `kpi-row`, `comparison`, `process`, `step-diagram`, `chart-insight`,
`table-insight`, `image-split`, `summary-box-list`, `agenda`, `quote`, `statement`.

- Covers `cover-typographic`, `cover-split-field`, `cover-numeral`; sections `section-field`,
  `section-numeral`; closings `closing-ask`, `closing-decision-box`, `closing-statement`.
- Display devices: cover `plate` (topic in white on a blue plate across the lower half, bordered
  in black), statement `drench` (page in blue, sentence in white), number `field`, closing `box`
  (bordered, with its shadow).
- Table: yellow header, ruled grid, protagonist row in pink tint, bold totals. Chart: no
  gridlines, direct labels, series in order (pink, blue, black). Image: hairline frame.
- Fill order: step-up, change-family, anchor-visual, distribute.

## Do

- Keep one claim per slide, written in the first body line in plain words.
- Give every figure its label and its basis in the card.
- Let yellow cards carry figures and short labels, never paragraphs.
- End on `closing-ask` with the amount, its uses and the next meeting.

## Avoid

- Blurred or soft shadows, rounded corners, gradients.
- Thin hairlines beside the 2.5 pt borders.
- More than three fill colours on one slide.
- Muted grey text on the yellow surface.
- This direction for formal reports or sensitive topics.

## Worked slide

A traction slide: four results as cards with two facts under them.

```markdown
---
layout: kpi-row

## 베타 8주 성과, 2026년 10월

| 가입자 | 주간 재방문 | 추천 가입 | 유료 전환 |
|---|---|---|---|
| 1만 2천 명 | 46% | 38% | 7.4% |
| 목표 1만 명 | 업계 평균 25% | 광고비 0원 | 목표 5% |

> 베타 운영 기록, 2026년 8-10월 (예시)

- 광고 없이 가입자 목표를 넘겼다: 셋 중 하나 이상이 친구 추천으로 왔다
- 유료 전환 7.4%는 목표 5%를 넘었고, 연 결제가 그중 60%다
- 출처: 예시 서비스 운영 대시보드, 2026년 10월 (예시)
---
```

## Example in this skill

```text
references/examples/14-launch-pitch-neo-brutalism-ko.md
```
