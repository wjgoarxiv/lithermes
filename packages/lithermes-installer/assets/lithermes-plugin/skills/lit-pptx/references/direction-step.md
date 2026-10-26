# Direction step

On every route (`/lit-pptx`, bare `lit`, office brief) `lithermes:lit-pptx` picks a tonality
(`ledger`, `signal`, `atlas`, `chalk`, `paper`, `gazette`, `studio`, `night`,
`computational-brutalism`, `neo-brutalism`, `bauhaus`, `riso`, `newsroom`), two alternatives and a
reason before any slide. No house look. A bare request gets the style question first (SKILL.md: recommended tonality plus two alternatives, recommended first); pause only for a
deliberately open look (compare strip) or a dial move above 2. If Tonality and Reason cannot be
filled, stop and ask.

## Inputs the card needs

Deck type (a row below, or "other, closest to …"), reader (who, where, how long), delivery (live,
sent ahead, both), language. Unstated facts are marked "(inferred)".

## Deck type to candidates

The first candidate wins unless a signal reorders.

| Deck type | Candidates (density, variance) |
|---|---|
| Pitch (투자·제안 피치) | `signal` (10, 6); `studio` (10, 7); `atlas` (10, 7) when the product is visual |
| Launch, demo day or campaign (런칭·데모데이·캠페인) | `neo-brutalism` (10, 7); `signal` (10, 6); `studio` (10, 7) |
| Engineering or developer review (아키텍처·인프라·장애 리뷰) | `computational-brutalism` (10, 7); `night` (10, 6) for a stage; `ledger` (10, 5) when it is read alone |
| Business review (경영 실적 보고) | `ledger` (10, 5); `gazette` (10, 4) when circulated in Korean and read alone; `night` (10, 6) for a stage review |
| Research talk (연구 발표) | `paper` (10, 5); `night` (10, 5) for a keynote room; `chalk` (10, 6) for a tutorial talk |
| Lecture or teaching (강의) | `chalk` (10, 6); `paper` (10, 5); `studio` (10, 7) for a public lecture |
| Design or culture lecture (디자인·건축·전시·워크숍) | `bauhaus` (10, 7); `studio` (10, 8); `atlas` (10, 7) when the works are the deck |
| Data-heavy review (데이터 리뷰) | `night` (10, 6); `ledger` (10, 5); `paper` (10, 5) for a written analysis |
| Image-led (product, portfolio) | `atlas` (10, 7); `studio` (10, 8); `signal` (10, 6) for a launch |
| Korean text briefing (보고서형 덱) | `gazette` (10, 4); `ledger` (10, 5) |
| Status update (주간·월간 보고) | `ledger` (10, 5); `gazette` (10, 4); `night` (10, 6) |
| Community, culture or education programme (커뮤니티·문화·교육 프로그램) | `riso` (10, 7); `studio` (10, 7); `bauhaus` (10, 7) for a design programme |
| Data story for the public (주민·독자 대상 데이터 브리핑) | `newsroom` (10, 6); `gazette` (10, 4) when it is read alone; `ledger` (10, 5) |

## Signals that reorder

Count on the outline (one message, one visual per slide), not the topic; apply rows in order, ties
keep the deck-type order.

| Signal (measured on the outline) | Threshold | Effect |
|---|---|---|
| A tonality is named in the brief or was picked earlier | any | use it; the card is still written |
| A legacy template is named | any | use it as a legacy pack; name two tonalities as alternatives |
| Read rather than presented ("보고서", sent ahead, circulated) | stated | `gazette` (Korean) or `ledger` (other) to the front |
| Slides carrying a table | ≥ 30 % | `ledger` or `gazette` up one |
| Slides carrying a chart | ≥ 30 % | `ledger`, `night` or `paper` up one |
| Slides carrying an image or screenshot | ≥ 30 % | `atlas` or `studio` up one; `gazette` down |
| Body text per content slide | ≥ 150 Korean glyphs / 300 Latin chars | `gazette` or `ledger` up; `signal` down |
| Body text per content slide | ≤ 40 Korean glyphs / 80 Latin chars | `signal` or `studio` up; density stays 10 |
| Numbered citations, DOIs, a references slide | present | `paper` up one |
| Equations, definitions, a mechanism of three or more steps | present | `chalk` or `paper` up one |
| Dark room (keynote, stage, demo day) | stated | `night` up one |
| A pack lacks a family or title for some slide role on the outline | any slide | drop that pack |

Last row: `atlas`, `ledger`, `gazette` lack a `statement` title; `atlas` a table family; `signal`
`ledger-table` and `dashboard-grid`. Confirm:

```sh
node <installed-plugin>/skills/lit-pptx/bin/office.mjs pptx --list-tonalities
node <installed-plugin>/skills/lit-pptx/bin/office.mjs pptx --list-layouts paper
```

## The card (sample, figures invented)

```text
Direction card
  Deck type        research talk (연구 발표)
  Reader           lab group and two external reviewers, seminar room, 20 minutes (inferred)
  Delivery         presented, file shared afterwards
  Tonality         paper        alternatives: chalk, night
  Reason           figure-led talk: 50 % chart slides, DOI reference list, a four-stage mechanism
  Signals fired    chart share, citations, mechanism
  Dials            density 10, variance 5 (pack defaults, no move)
  Treatments       content top-rule · data-takeaway bottom-anchor · definition side-rail ·
                   statement statement (pull quote only)
  Families planned cover-index, figure-academic, method, chart-insight ×3, figure-pair,
                   table-insight, comparison, full-chart, quote, closing-summary-list,
                   references-appendix
  Wrong if         the talk turns into a hands-on tutorial; chalk's numbered steps then fit better
```

Field rules:

- Reason cites fired signals, not the deck type.
- Dials: move each by up to 2, written ("density 8, −2: 300-seat hall"); more needs the user; variance
  under 4 only on request (`density-and-fill.md`).
- Treatments from the role map (`title-treatments.md`); one family per slide (`layout-families.md`).
- Wrong if: one condition that flips the choice; checked first, and if true, rebuild and rewrite.

## Recording and replying

Each compile appends `note:`, `fill:`, `variety:` lines and the gate result to the build log,
delivered only on request.

```text
<deck>.md          source; frontmatter carries tonality:
<deck>.build.md    direction card, compile notes, fill lines, gate result
<deck>.pptx        compiled deck
```

The reply gives the card in two or three sentences: "Paper 톤으로 구성했습니다. 그림과 차트가 절반인
연구 발표라서입니다. 실습형이면 Chalk, 어두운 강연장이면 Night도 어울립니다."

## Compare strip

For requested options or an open look ("어떤 느낌이 좋을지 모르겠다"), show the first three slides
under the choice and both alternatives as labelled rows before writing the rest.

```sh
# strip.md: the deck frontmatter plus its first three slides
OFFICE=<installed-plugin>/skills/lit-pptx/bin/office.mjs
for t in paper chalk night; do
  node "$OFFICE" pptx strip.md --pptx "strip-$t.pptx" --tonality "$t"
  soffice --headless --convert-to pdf --outdir "strip-$t" "strip-$t.pptx"
done
```

Do not argue for a row; after the pick, Reason becomes "chosen by the user from the strip". Without
`soffice`, say so and rely on the card.

## Legacy templates

AZURE-PRO, AZURE-A2Z, BOILERPLATE-PRETENDARD and BOILERPLATE-A2Z load only on the user's word or
when a revised source already says `template:`. The card still names two tonalities; the gate
reports variety and median-band checks as advisories.
