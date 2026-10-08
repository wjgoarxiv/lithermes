# Document direction before the first heading

`lithermes:lit-docx` picks one of six tonality packs (Report, Brief, Manual, Proposal, Memo,
Journal) before writing. Packs differ in structure only; no colour is chosen here.

## Questions: when and when not

| Situation | Action |
|---|---|
| Bare `lit`, or `/lit-docx` with no look named | decide and build; name choice and two alternatives; ask nothing |
| Tonality named now, earlier, or in frontmatter `tonality:` | it wins; card and alternatives still written |
| Publisher named (elsevier, acs, ieee, nature, korean-generic), a submission, or a user `.docx` template | publisher/template path; `--tonality` with `--publisher` is refused |
| Look left open on purpose | build the direction strip, no question first |
| Dial move over 2, or conflicting explicit constraints | ask once |

No silent default: a non-manuscript with neither tonality nor publisher is a skipped step.

## Five facts up front

Type, reader and use, delivery, language (sets body size, caption form, numbering, callout labels),
length (one or two pages points to Memo or Brief). Mark inferred facts on the card.

## Type to tonality

First candidate wins unless a signal moves it; dials are pack defaults (density, variance).

| Document type | Candidates, in order | Dials of the first |
|---|---|---|
| Report, results, analysis (보고서, 결과 보고, 분석) | Report, Brief, Manual | 9, 5 |
| Korean itemised briefing for one decision maker, one to three pages (현황 보고, 검토 보고) | Brief, Memo, Report | 9, 3 |
| Guide, procedure, operating manual, onboarding (가이드, 매뉴얼, 절차서) | Manual, Report, Brief | 9, 6 |
| Proposal, plan or pitch as a document (제안서, 기획서, 계획서) | Proposal, Report, Brief | 8, 6 |
| Memo, notice, letter of one or two pages (메모, 공지, 안내문) | Memo, Brief, Report | 9, 2 |
| Essay, newsletter, white paper, research summary not bound for a journal | Journal, Report, Proposal | 9, 6 |
| Journal submission, or a publisher the user names | that publisher profile, no tonality | profile rules |

Korean Report is institute prose, 개조식 not built in; Journal is the publisher-profile tonality,
never a submission (see the sheets).

## Structure per tonality (A4.6)

| Tonality | Page 1 | Summary | Numbering | Components | Running head | Contents |
|---|---|---|---|---|---|---|
| Report | title block, one rule | prose + one key-figure strip | Ⅰ. / 1. / 가. (en 1 / 1.1) | keyfigures, callout, columns | footer title + folio | 5+ pages |
| Brief | title block, decision box under it | ①-④ bold lead sentences | none; h1 under hairline | callout (one), columns | folio right | none |
| Proposal | typographic cover | prose + key figures | none | keyfigures, one decision box, columns; budget table | folio centred | none |
| Manual | title over control block | prose overview | 1 / 1.1, numbered steps | one warning style, optional sidebar, columns | header title, footer folio | 5+ pages |
| Memo | no cover; To / From rows | opening paragraph | none | none | folio from p. 2 | none |
| Journal | masthead, abstract, two columns | abstract | 1 / 1.1 | callout | header title + folio | none |

Two tonalities of one source differ in three or more features (`tonality.structure`):

```sh
node <installed-plugin>/skills/lit-pptx/bin/office.mjs gate a.docx --source a.md --layout --compare b.docx
```

## Content signals

Counted on the outline; they reorder within the row, in this order, table order on a tie.

| Signal | Fires when | Effect |
|---|---|---|
| User names a tonality | always | use it; card still written |
| Table share | tables are 30 % or more of body blocks, or four or more tables | Report or Manual first |
| Images | three or more | Proposal or Journal first |
| Short | under about 900 words, or the brief says one or two pages | Memo or Brief first |
| English long-form prose | at most about one table per three pages | Journal first |
| Procedure | numbered steps, or three or more warnings | Manual first |
| Decision asked (승인 요청, 결정 사항) | stated in the source | Brief or Proposal up one place; plan a `key` callout |
| Pack lacks a needed component | sidebar outside Manual, key figures in Brief/Memo, anything in Memo, non-callout in Journal | move it down, or keep the content as text and note it |

## The direction card

Every field filled, or the build stops. Each component needs a one-line purpose (the
out-of-sequence content it carries) or it is cut.

```text
Direction card
  Document type   evaluation report (결과 보고), about 8 pages
  Reader          hospital director and two clinic leads; printed for the quarterly review
  Tonality        Report     alternatives: Brief, Manual
  Reason          6 tables in 17 body blocks (35 %); one extension request near the end
  Signals fired   table share, decision asked
  Dials           density 9, variance 5 (pack defaults)
  Page 1          title block: kind label, date, title, subtitle, byline, one rule, notice once
  Contents        yes (8 pages)
  Headings        Ⅰ. / 1. / 가., ink, separated by weight and space; every heading a noun phrase
  Components      keyfigures (summary)  wait time, check-in share, staff hours; each with a basis line
                  callout key           the extension request and its decision date
  Left out        glossary sidebar (Report has none; terms go into the method paragraph)
  Fonts           Pretendard (pack default)
  Wrong if        the director reads only page one; Brief's conclusion-first points would fit better
```

Review checks "wrong if" first; if true, rebuild under that alternative. Budget and notice: components
reference. Dials (`density:` / `variance:`, or `--density`) move up to 2 without asking, noted on the
card; variance is recorded only.

## Binding rules on every card

1. Labels, not sentences: title, subtitle, headings, component titles ("외래 무인 접수 운영 결과",
   not "대기 시간이 줄었다"); `heading.declarative` fails a sentence; reword the label, never the gate.
2. Honest numbers: sourced, consistent, key figures no larger than h2 with a basis; (예시) / (sample).
3. Pretendard (Journal: Times New Roman Latin body); another face only on request.
4. Dense and restrained; Korean conventions (dates `2026. 10. 5.`, no ■ ✓ ▶, weight-only emphasis).

## Reply and build notes

Reply, one sentence each: "Report로 구성했습니다. 표가 본문 블록의 3분의 1을
넘고 끝에 연장 승인 요청이 있기 때문입니다. 원장님이 첫 장만 보신다면 Brief, 접수 절차 안내가
중심이라면 Manual도 가능합니다." 

Build notes (never in the document):

```text
<name>.md         source; tonality: and any dials in frontmatter
<name>.build.md   direction card, runner notes, gate result, pages looked at
<name>.docx       converted document
```

## The direction strip

Same source under the choice and both alternatives, first pages shown as three rows; the user's
pick becomes the card's reason.

```sh
for t in Report Brief Manual; do
  node <installed-plugin>/skills/lit-pptx/bin/office.mjs docx strip.md "strip-$t.docx" --tonality "$t"
  node <installed-plugin>/skills/lit-pptx/bin/office.mjs audit "strip-$t.docx"
done
node <installed-plugin>/skills/lit-pptx/bin/office.mjs gate strip-Report.docx --source strip.md --layout --compare strip-Brief.docx
```

Rows differing only in colour fail `tonality.structure`; do not show them.

## Failure patterns

- Choosing by topic without counting the outline, or for the accent colour.
- A reason restating the document type; 개조식 merely because the text is Korean.
- A tonality changed after the build without updating card and reply.
