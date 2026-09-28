// Type kit: typographic punctuation, script runs, 어절 breaking, kerned glyph
// layout and ink geometry. Adapted from mexicat/pdoom-video
// app/src/engine/type.ts (MIT, see NOTICE). Upstream measured with Canvas2D in
// the page; here layout runs in Node on real outline data through a small font
// adapter, so the gate can read textBoxes without re-detecting text in pixels.
import { READING } from './constants.mjs';

// MO-A-34. Leading elisions get an apostrophe, not an opening quote.
export function smart(value) {
  return String(value)
    .replace(/\.\.\./g, '…')
    .replace(/(^|[\s([{—–-])'(?=(?:cause|cos|til|em|round|n|tis|twas|\d0s)\b)/gi, '$1’')
    .replace(/(^|[\s([{—–-])'/g, '$1‘')
    .replace(/'/g, '’')
    .replace(/(^|[\s([{—–-])"/g, '$1“')
    .replace(/"/g, '”');
}
export const plain = (value) => String(value).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...');

const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/u;
const LATIN = /[A-Za-zÀ-ɏ]/u;
export const isHangul = (ch) => HANGUL.test(ch);
export const isHangulSyllable = (ch) => /[가-힣]/u.test(ch);

// MO-FT-04: digits, punctuation and spaces are not a script of their own. They
// join the run on their left, or the run on their right when nothing precedes.
export function scriptRuns(text) {
  const chars = Array.from(String(text));
  const letter = chars.map((ch) => (HANGUL.test(ch) ? 'hangul' : LATIN.test(ch) ? 'latin' : null));
  const resolved = letter.slice();
  let left = null;
  for (let i = 0; i < chars.length; i++) {
    if (letter[i]) { left = letter[i]; continue; }
    if (left) { resolved[i] = left; continue; }
    const right = letter.slice(i + 1).find(Boolean);
    resolved[i] = right || 'latin';
  }
  const runs = [];
  chars.forEach((ch, index) => {
    const script = resolved[index];
    const last = runs.at(-1);
    if (last && last.script === script) { last.text += ch; last.end = index + 1; }
    else runs.push({ script, text: ch, start: index, end: index + 1 });
  });
  return runs;
}

export function scriptOf(text) {
  const hangul = HANGUL.test(text), latin = LATIN.test(text);
  return hangul && latin ? 'mixed' : hangul ? 'hangul' : 'latin';
}

// MO-A-13 / MO-FT-05: whitespace is the only break candidate, so a 어절 never splits.
export const eojeols = (text) => String(text).trim().split(/\s+/u).filter(Boolean);

// MO-C-07/08 counts.
export function readingCounts(text) {
  const value = String(text);
  const H = Array.from(value).filter(isHangulSyllable).length;
  const nonHangul = value.replace(/[가-힣ᄀ-ᇿ㄰-㆏]+/gu, ' ');
  const W = (nonHangul.match(/[A-Za-z0-9À-ɏ'’-]+/gu) || []).filter((word) => /[A-Za-z0-9]/.test(word)).length;
  const C = scriptRuns(value).filter((run) => run.script === 'latin').reduce((sum, run) => sum + Array.from(run.text).length, 0);
  return { H, W, C };
}

// The one reading-floor function (MO-C-07/08, MO-A-09..12, MO-FT-06).
export function readingFloor(text, kind = 'line') {
  if (kind === 'reveal') return READING.revealFloor;
  const { H, W } = readingCounts(text);
  const rate = READING.hangulSecPerSyllable * H + W / READING.englishWordsPerSec;
  if (kind === 'word') return Math.max(READING.wordFloor, rate);
  return Math.max(H > 0 ? READING.lineFloorHangul : READING.lineFloorLatin, rate);
}

// Font adapter over an opentype.js Font. Tests pass their own adapter with the
// same shape: { id, file, upm, ascender, descender, capHeight, glyph(ch), kern(a, b) }.
export function openTypeAdapter(opentypeFont, id, file) {
  const cache = new Map();
  const font = opentypeFont;
  return {
    id, file,
    upm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    capHeight: font.tables.os2?.sCapHeight || font.ascender * 0.7,
    has: (ch) => font.charToGlyphIndex(ch) > 0,
    glyph(ch) {
      if (cache.has(ch)) return cache.get(ch);
      const g = font.charToGlyph(ch);
      const box = g.index > 0 ? g.getBoundingBox() : null;
      const empty = !box || (box.x1 === 0 && box.x2 === 0 && box.y1 === 0 && box.y2 === 0);
      const entry = {
        index: g.index,
        advance: g.advanceWidth || 0,
        bbox: empty ? null : { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 },
        raw: g,
        pathData: () => g.getPath(0, 0, font.unitsPerEm).toPathData(2),
      };
      cache.set(ch, entry);
      return entry;
    },
    kern(a, b) {
      try { return font.getKerningValue(a.raw, b.raw) || 0; } catch { return 0; }
    },
  };
}

// Kerned layout of one line across script runs. `fontFor(run)` returns the
// adapter for a run; `trackingFor(run)` returns em tracking (Hangul is forced
// to 0 by the caller's policy and again here). Glyph x is the position of the
// glyph inside the complete shaped line, which is what glyphX returns (MO-A-32).
export function layoutLine(text, sizePx, fontFor, trackingFor = () => 0) {
  const runs = scriptRuns(text);
  const glyphs = [];
  let x = 0;
  for (const run of runs) {
    const font = fontFor(run);
    const scale = sizePx / font.upm;
    const tracking = run.script === 'hangul' ? 0 : trackingFor(run) * sizePx;
    let previous = null;
    const chars = Array.from(run.text);
    chars.forEach((ch, offset) => {
      const glyph = font.glyph(ch);
      if (previous) x += font.kern(previous, glyph) * scale;
      glyphs.push({ ch, index: run.start + offset, script: run.script, font, glyph, x, advance: glyph.advance * scale, scale });
      x += glyph.advance * scale;
      if (offset < chars.length - 1) x += tracking;
      previous = glyph;
    });
    run.font = font;
    run.trackingEm = run.script === 'hangul' ? 0 : trackingFor(run);
  }
  return { text, sizePx, glyphs, runs, width: x };
}

export function glyphX(layout, index) {
  if (index <= 0) return 0;
  const glyph = layout.glyphs.find((entry) => entry.index === index);
  return glyph ? glyph.x : layout.width;
}

// Ink bbox of positioned glyphs (baseline at y, y down), from outline bounds.
export function inkBounds(placed) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const item of placed) {
    const box = item.glyph.bbox;
    if (!box) continue;
    const s = item.scale * (item.uniform ?? 1);
    x0 = Math.min(x0, item.px + box.x1 * s);
    x1 = Math.max(x1, item.px + box.x2 * s);
    y0 = Math.min(y0, item.py - box.y2 * s);
    y1 = Math.max(y1, item.py - box.y1 * s);
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}

// Greedy wrap at 어절/word boundaries only (MO-FT-05): a word wider than the
// measure stays whole on its own line rather than breaking inside it.
export function wrapWords(text, maxWidth, measure) {
  const words = eojeols(text);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || measure(candidate) <= maxWidth) current = candidate;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines;
}

// MO-D-04 support: which characters a font cannot draw.
export function missingGlyphs(text, fontFor) {
  const missing = [];
  for (const run of scriptRuns(text)) {
    const font = fontFor(run);
    for (const ch of run.text) {
      if (/\s/u.test(ch)) continue;
      if (!font.has(ch)) missing.push({ ch, font: font.file });
    }
  }
  return missing;
}
