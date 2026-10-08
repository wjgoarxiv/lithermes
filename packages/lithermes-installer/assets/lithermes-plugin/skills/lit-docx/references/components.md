# Document components and tables

Fenced directives in the Markdown source become Word structure when the `office.mjs` runner
converts a document; no `:::` line reaches the page. An unknown name or attribute, or an unclosed
fence, stops the build with the line number. A component carries what a paragraph carries badly,
never decoration.

## Budget and purpose gate

`component.budget` fails a tonality document past any of these:

- **Three component kinds at most**, beyond headings, paragraphs, lists, tables and figures. Kinds are
  admitted in order of first appearance; a fourth kind prints as text. A cover or title block does not
  count.
- **One key-figure strip**, in the summary, never on a cover.
- **No pull quote.**

Each component needs a one-line purpose on the direction card ("callout: the extension request and
its decision date"), or it is removed. `component.variety` (two kinds from four pages) firing on a
Memo or Journal means the document outgrew its pack; change tonality, do not invent a component.

## Outside the pack: kept as text

A directive the pack does not draw, or one past the budget or callout ration, prints as ordinary
paragraphs with its `title` as a bold lead line, with a stdout note. Copy those notes into the build
notes.

| Tonality | Kinds drawn | Callouts | Key figures |
|---|---|---|---|
| Report | keyfigures, callout, columns | about one per four pages | one strip, summary |
| Brief | callout, columns | one, moved under the title block | none |
| Proposal | keyfigures, callout, columns | one decision box | one strip, summary |
| Manual | callout, sidebar, columns | about one per four pages, one warning style | none |
| Memo | none | none (bold lead line) | none |
| Journal | callout | about one per four pages, ink rule | none |
| plain profile (no tonality) | all but pullquote | every callout | as written |

## Grammar

```text
::: <name> [<positional>] [<key>=<value> ...]
<Markdown: paragraphs, lists, tables, nested directives where allowed>
:::
```

- The fence starts at column 0: three or more colons, a space, the name. The block ends at the next
  line holding only the same number of colons.
- A nested block needs a longer outer fence: `::::` around a cover, `:::` for the key figures inside.
  Equal fences read as "close, then a stray close", which is an error.
- A value is a bare token such as `kind=warning`, `cols=3` or `gap=8`, or a double-quoted string
  (`title="검사 전 확인"`, `\"` the only escape). Keys are lower case and may not repeat.
- Fences inside fenced code blocks are plain text.
- `<!-- column-break -->` alone on a line is legal only inside `::: columns`.
- Names: `cover`, `callout`, `sidebar`, `pullquote`, `keyfigures`, `columns`.

## `::: cover variant=…`

```markdown
::: cover variant=typographic kicker="정비 계획서"
노후 설비 교체 범위와 일정을 한 문단으로 밝힌다.
:::
```

`variant` accepts `typographic`, `band`, `split` or `masthead`, and `kicker` is the kind label. Every
value parses but **the variant changes nothing**: each tonality draws its own typographic block (see
its sheet). No colour block, no figures, no picture unless supplied (`cover.block`: filled shape over
25 %). `image=` draws nothing.

The cover stands first and needs frontmatter `title:`; subtitle, author, organisation and date come
from frontmatter, the block body is an optional lead (Memo: `Key: value` rows). Key figures nested
in a cover move to the summary, or leave with a note where the pack has none (state them in the
text). Korean dates print as `2026. 10. 5.`.

**Notice.** Frontmatter `notice:` prints once, small and muted, under the title block (Proposal: cover
foot); never in a header, as a coloured label, or repeated in the body.

## `::: callout kind=note|key|warning`

```markdown
::: callout kind=warning title="회전부 정지 확인"
덮개를 열기 전에 표시등이 꺼지고 회전 소리가 멈췄는지 확인한다.
:::
```

One unsplittable cell: 0.75 pt rule above, 0.5 pt below in the pack accent (Journal: ink), no side
stripe, no fill, bold title (참고 / 핵심 / 주의, Note / Key point / Warning, or `title`), body-size
text. One style for every kind; the kind sets priority. Ration: about one per four pages (Brief and
Proposal one), only for out-of-sequence content; boxes go to `key`, then `warning`, then `note`, the
rest print as text. Brief moves its first `key` under the title block. `key` = decision or request,
`warning` = risk placed before its step, `note` = definition or assumption. No box inside a box.

## `::: sidebar`

`::: sidebar [title="…"] [width=third|half] [float=right|left|none]`, **Manual only**: a one-cell
table, accent hairline left, no fill, table-size text, floating right at a third of the width; full
width when the text before the next heading is shorter (`sidebar.overlap`). Terms or a method note,
never steps.

## `::: keyfigures`

```markdown
::: keyfigures cols=3
- **4.2분** 평균 접수 대기 (예시)
  - 2026년 3분기, 두 외래 진료과, 접수 기록
- **61%** 무인 접수 비율 (예시)
  - 2026년 9월, 전체 접수 중 키오스크 처리
- **118시간** 월 절감 인력 시간 (예시)
  - 2026년 7-9월 평균, 인사 근무표
:::
```

One to eight items, each `**<figure>** <label>` (figure contains a digit) with an indented basis line
(period, scope, source). Drawn as a borderless row under ink hairlines: figure bold ink at h2 size,
never larger; label table size; basis muted. Place it after the summary's first paragraph, three or
four real comparable metrics, no non-metric ("만족도 향상"). A second strip, or one in a pack without
key figures, prints as a list with the basis in brackets.

## `::: columns 2`

`::: columns <1|2|3> [gap=<mm>] [rule=true]`, top level only, its own section between continuous
breaks. With `<!-- column-break -->` each part takes a cell of one borderless row; `gap` 6 mm default,
`rule=true` a line between. Side by side only within about 20 % length; otherwise read in sequence.

## `::: pullquote`

Off everywhere. It parses; a repeat of body text is dropped with a note, new content stays as a
paragraph. Move it into the body and delete the directive.

## Booktabs tables

Three rules: 1 pt above and below, 0.5 pt under the header; no verticals, fills, banding or grid
(`table.fill`). Bold ink header; numbers and clock times right-aligned in tabular figures; no column
narrower than its longest word; 9.5 pt at 140 %. A last row opening 합계, 총계, 소계, 계, Total or Sum
is bold under a 0.5 pt rule. A caption's `{style=…}` is removed with a note.

**Korean.** `표 1. 제목` before the table prints above as `<표 1> 제목`, label bold. A unit shared by
every numeric header (`3분기 (분)`) moves to a right-aligned `(단위: 분)` line above. Below: `주:`,
then `자료:` (`출처:` is rewritten). Alt text `그림 1. 제목` prints as `[그림 1] 제목`.

**English.** `Table 1.` above the table, `Figure 1.` below the figure, label bold; `Note:` and
`Source:` under the table.

Paragraphs opening `주:`, `자료:`, `출처:`, `Note:`, `Notes:`, `Source:` or `Sources:` take the muted
source-note style; put one under every data table or figure. Spacing and split rules: page-composition
reference.

## Misuse

- Key figures with adjectives ("대폭 단축") or no basis; a `columns` block of one long part and one line.
- Nested directives with equal fences; component titles written as sentences (`heading.declarative`).
