# Chalk (`chalk`)

A tidy teaching board: steps numbered because they happen in order, one taught term per slide, a
fenced sidebar for the definition or usual mistake, soft corners, a rust accent on the lesson and a
deep green rail.

## Pick it when

- Lectures, tutorials, workshops, onboarding and training, spoken then reviewed from the file.
- Equations, definitions or a sequence of three steps or more (Chalk or Paper up one place).
- Worked examples and exercises in the material.

## Pass on it when

- Decision decks (numbered steps read as padding); peer research talks (Paper); story-led public
  lectures (Studio).

## Token summary

| Token | Value |
|---|---|
| ground, surface | #FAFBFC, #EEF2F5 |
| ink, ink-muted, line | #1F2933, #4E5A66, #CBD3DA |
| accent, accent-deep, accent-tint | #9A3412, #6B2409, #FCEBE0 |
| field, on-field | #1F3B33, #FFFFFF |
| positive, negative | #1E7A3F, #B3261E |
| series | #9A3412, #1F3B33, #4E5A66, #2E6A8E |
| faces | Pretendard Bold (display, title, numeral), Regular (body, label) |
| ramp | compact (body 13, lead 18, title 26 pt) |
| density, variance | 10, 6 (8 for a lecture hall) |
| radius, edge, rail | 6, fill, field |
| decoration | accent-rule, mark-underline (listed, not drawn yet), rail-fill, numeral |

## Title treatments by role

Allowed: `kicker-numeral`, `top-rule`, `side-rail`, `statement`. Defaults: content, data,
reference → top-rule; data-takeaway, image, definition → side-rail; sequence → kicker-numeral;
statement → statement. Structure: a comparison takes `side-rail`, its criteria on the board rail.
The kicker numeral is for real sequences only, never an agenda count: a deck whose only kicker was
the agenda needs a step or sidebar slide under it (OF-110), and a note across the top can push
top/grid past 40 % (OF-111).

## Families and display slides

Families: `step-diagram`, `process`, `method`, `sidebar-note`, `comparison`, `image-split`,
`quote`, `agenda`, `statement`, `text-column`, `table-insight`.

- `method`: formula across the top, terms in two columns. `process` / `step-diagram`: rows of
  numeral, step and what happens. `sidebar-note`: misreadings in the body, the correct reading in
  a `::: main-box`.
- Covers `cover-rail`, `cover-typographic`, `cover-numeral`; sections `section-numeral`,
  `section-rail`; closings `closing-summary-list`, `closing-ask`.
- Display devices: cover `rail`, statement `drench`, number `tint`, closing `box`.
- Table: accent-tint header with accent-deep labels, hairline rows, right-tabular, bold totals.
  Chart: hairline grid, direct labels, accent over muted ink, annotations on. Image: side bleed,
  no crop, no frame.
- Fill order: distribute, step-up, change-family, anchor-visual.

## Do

- Define the slide's one term in the sidebar or method slide, not in a bullet.
- Give every step a worked number: input, operation, result.
- Show the effect of changing one input in a five-to-eight-row table.
- Close with summary, exercise (format, deadline) and the next session.

## Avoid

- More than one marked term per slide.
- Numerals on points that are not a sequence.
- Definitions buried in bullets instead of the sidebar.

## Worked slide

A formula with its terms.

```markdown
---
layout: method

## 이동평균의 정의와 기호

MA(k) = (x₁ + x₂ + … + xₖ) ÷ k

- **xᵢ** i번째 관측값, 예제에서는 하루 판매량(개)
- **k** 창 크기, 평균에 넣는 최근 관측값의 개수
- **MA(k)** 최근 k개 값의 평균, 단위는 관측값과 같다
- **창이 길 때** 잡음은 줄지만 변화에 늦게 반응한다
- **창이 짧을 때** 반응은 빠르지만 하루 튀는 값에 흔들린다
- **예** 최근 5일 판매량 40, 44, 38, 50, 48이면 MA(5) = 220 ÷ 5 = 44개
- 출처: 예시 시계열 입문 강의 2강, 2026년 (예시)
---
```

## Example in this skill

```text
references/examples/04-lecture-chalk-ko.md
```
