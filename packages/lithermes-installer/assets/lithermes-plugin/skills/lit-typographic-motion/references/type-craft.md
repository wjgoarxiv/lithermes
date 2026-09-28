# Korean and Latin type craft

The engine enforces most of these rules in code; this page is what to aim for
when you write the brief and read the stills.

## Fonts per voice

| Voice | Latin | Hangul |
|---|---|---|
| display (swiss, tidal) | Archivo width instance 75/100/125 x weight 500/700/900 | PretendardGOV Bold (700) |
| body (swiss, tidal) | Archivo 100 width | PretendardGOV Regular or Bold |
| display and body (terminalcore) | VT323 | Galmuri9 |
| machine | MesloLGS NF | PretendardGOV Regular (swiss, tidal) or Galmuri9 (terminalcore) |
| chrome label (terminalcore) | Silkscreen | Galmuri9 |
| stroke | EMS single-stroke SVG (Allure for signatures) | none; stroke text is Latin only |

PretendardGOV Regular and Bold are this product's own lit-pptx pair, reused by
path and checked against its recorded hashes. Hangul weight moves only between
those two files. Every other font is fetched by the pre-warm from a pinned URL
and checked by sha256 before a render may use it. Galmuri and Pretendard carry
reserved names, so they are only ever used unmodified, never subset.

## Script runs

A line is split into Latin and Hangul runs. Digits, punctuation and spaces are
not a script: they join the run on their left, or the run on their right when
nothing precedes them. So `2026년` is one Hangul run and `LIT팀` is `LIT` plus
`팀`. Each run takes its own font, and tracking or width motion applies to Latin
runs only. A Hangul run is always untracked and never condensed, expanded or
stepped through width instances, even inside a Latin line.

## Kerning and split words

The engine lays out a whole line once with the font's kerning, then places each
piece of a split word at its glyph position inside that line. It never measures
`text.slice(0, i)`, which silently drops the kern between the last drawn glyph
and the next one. Karaoke words and list items all come from the whole-line
layout.

## Line breaks and 어절

Korean lines break only at whitespace between 어절. A word too wide for the
measure stays whole on its own line. Karaoke reveal steps and terminal type-in
never show half a 어절.

## Punctuation

Display strings go through `smart()`: straight quotes become curly, leading
elisions ('til, 'cause, '90s) get an apostrophe, `...` becomes `…`. Terminalcore
keeps typewriter punctuation (`plain()`), because a terminal types straight
quotes.

## Tracking, line height, measure

| Rule | Floor or range |
|---|---|
| Display tracking | not tighter than -0.04 em (the engine uses -0.02 em on Latin titles) |
| Machine, body and label tracking | 0 or looser |
| Two wrapped lines, Latin | line height >= 1.5 |
| Two wrapped lines, Hangul or mixed | >= 1.6 |
| Three or more lines | >= 1.4 (the engine uses 1.6) |
| Latin paragraph card | 60-75 characters per line |
| Korean paragraph card | 30-45 characters, advisory only |

## Contrast

Body type needs 4.5:1 against what is actually painted behind it; large type
(32 px and up, or 25 px at weight 700 and up) needs 3:1. The gate measures the
median of the glyph pixels under a mask eroded by 1 px against the 5th and 95th
percentile of the background around the word, so very thin small strokes read
lighter than their palette colour suggests. Give small annotations full ink or
a larger size rather than a mid tint. Never fix contrast with an outline or a
halo: move the word, change its colour inside the palette, or pick a calmer
background moment.

## Size floors

- Galmuri9 renders on a 9 px grid: use multiples of 9 px and at least 45 px on
  screen, or it blurs into its own strokes.
- Hold small type at weight 400 or heavier; large Hangul slams use Bold, because
  thin strokes break down under motion sampling.
- Every glyph's ink stays inside the title-safe rectangle 96-1824 x 54-1026 at
  1080p; non-type graphics stay inside 48-1872 x 27-1053.

## Reading time

Every unit holds at least its floor: 0.2 s per Hangul syllable plus one word per
0.3 s (3.3 words/s), at least 0.9 s for a Latin line and 1.0 s for any line with
Hangul, 0.5 s for a word shown alone, 0.35 s for a reveal step inside a line that
stays visible, and never more than 17 Latin characters per second on a line. A
4-어절 line of 14 syllables therefore needs 2.8 s; the generator gives it 3.5 s
before snapping to the beat.
