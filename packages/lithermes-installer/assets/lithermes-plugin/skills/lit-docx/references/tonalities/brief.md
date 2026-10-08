# Brief tonality

Brief is the one-to-three page paper for someone who must decide in five minutes: conclusion first,
the request under the title block, the summary as numbered points with bold lead sentences.

## Use cases

Pick Brief for 현황 보고, 검토 보고, decision papers, pre-meeting notes and any document that asks
one reader for one decision.

Otherwise:

- no decision, only news: Memo; evidence past three pages: Report; a procedure: Manual;
- explicit 개조식 request: still Brief, but write those lines yourself (no engine mode).

## Structure

- **Page 1, compact title block, then the decision.** Label and date line (`2026. 10. 5.`), title,
  subtitle, byline, one accent rule, the `notice:` once. The first `::: callout kind=key` in the source
  is moved directly beneath. No cover page.
- **Summary as points.** First-section paragraphs become ① ② ③ ④, each first sentence bold. Write
  three or four, each led by a complete sentence (situation, key number, option, request); a fifth
  stays unnumbered.
- **Numbering.** None. Each h1 opens under a full-width 0.5 pt ink hairline, the reader's way to find
  the next part without numerals.
- **Components:** `callout` (one box, the decision request) and `columns` (two near-equal options).
  No key figures; the points carry the numbers.
- **Tables.** One small table per part at most.
- **Running head.** The folio alone at the foot, right, from page 2.
- **Contents.** None.

## Tokens

Pack defaults, density 9 and variance 3, from `brief.yaml`. Pitch, paragraph spacing and fill follow the page-composition reference.

| Token | Value |
|---|---|
| Page | A4; margins 25 / 27 / 25 / 25 mm; text block 160 mm |
| Body | Pretendard 10.5 pt, Korean justified, English ragged right |
| Ramp | h1 1.3× (about 13.5 pt) under a hairline, h2 1.15× (12 pt), h3 10.5 pt bold, title 2.5× |
| Ink | `#1A1A1A`; muted `#555555`; rules `#8C8C8C` |
| Accent | green `2D5A47` on the title rule and the callout rule only |
| Tables | booktabs, 9.5 pt, bold header, numbers right-aligned |
| Figures | at most 0.40 of the frame height |

Density 10 for a brief three lines over (cutting a sentence is better); 7 for an annotated print.

## Do and avoid

| Do | Avoid |
|---|---|
| open each summary paragraph with a sentence that stands alone | one long summary paragraph, which cannot become points |
| one `key` callout holding the request and its date | a second box (it prints as text) |
| state the deciding numbers inside the points | a key-figure strip (Brief draws none) |
| headings as labels: 냉방 설정 온도 조정안 | 설정 온도를 26도로 올려야 함 |

## Source excerpt

```markdown
::: callout kind=key title="결정 요청"
본관 여름철 냉방 설정 온도를 24도에서 26도로 올리는 안을 7월 1일 시행으로 승인해 주시기 바랍니다.
:::

# 요약

오후 2-4시 본관 전력의 약 4할이 냉방에 쓰인다(예시). 최대 부하 시간대다.

설정 온도를 2도 올리면 여름 냉방 전력이 약 11% 준다(예시). 지난해 별관 측정값이다.

남향 사무실에는 선풍기 40대를 먼저 둔다(예시). 기존 시설 예산으로 충당한다.

7월 시행 뒤 실내 온도와 민원을 보고 8월 계속 여부를 정한다.
```
