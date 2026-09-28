// Single-stroke plotter type from the five OFL EMS SVG fonts (MO-FT-08), laid
// out as polylines so a pen can write text progressively. Adapted from
// mexicat/pdoom-video app/src/engine/stroke.ts (MIT, see NOTICE): the optical
// pair-kerning and writtenLength() method are kept; SVG parsing runs in Node
// with a small attribute reader instead of the browser DOMParser.
import { polylineLengths } from './util.mjs';

export const STROKE_FONTS = Object.freeze({
  readable: 'EMSReadability.svg',
  script: 'EMSAllure.svg',
  tech: 'EMSTech.svg',
  osmotron: 'EMSOsmotron.svg',
  felix: 'EMSFelix.svg',
});
const CONNECTED = new Set(['script']);

const attr = (tag, name) => {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? match[1] : null;
};
const decodeEntity = (value) => value
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function parsePath(d) {
  const out = [];
  const tokens = String(d || '').match(/[MLml]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let current = null, command = 'M';
  for (let i = 0; i < tokens.length;) {
    const token = tokens[i];
    if (/[MLml]/.test(token)) { command = token.toUpperCase(); i++; continue; }
    const x = parseFloat(tokens[i]), y = parseFloat(tokens[i + 1]);
    i += 2;
    if (command === 'M') { current = [{ x, y }]; out.push(current); command = 'L'; }
    else current?.push({ x, y });
  }
  return out;
}

const inkBox = (strokes) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of strokes) for (const p of s) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return { x0, x1, y0, y1 };
};

const ROWS = 90, SHADE = 0.4, CLEAR = 0.1, STRENGTH = 0.6;
const OPEN_R = new Set("AFLPTVWYKXfrvwyk7'\"’”".split(''));
const OPEN_L = new Set("AJTVWYXvwyj.,'\"’”…".split(''));

export function parseStrokeFont(svgText, name = 'readable') {
  const fontFace = svgText.match(/<font-face\b[^>]*>/)?.[0] || '';
  const fontTag = svgText.match(/<font\b[^>]*>/)?.[0] || '';
  const defaultAdvance = parseFloat(attr(fontTag, 'horiz-adv-x') || '500');
  const glyphs = new Map();
  for (const tag of svgText.match(/<glyph\b[^>]*>/g) || []) {
    const unicode = attr(tag, 'unicode');
    if (unicode == null) continue;
    glyphs.set(decodeEntity(unicode), {
      adv: parseFloat(attr(tag, 'horiz-adv-x') || String(defaultAdvance)),
      strokes: parsePath(attr(tag, 'd')),
    });
  }
  let yLo = Infinity, yHi = -Infinity;
  for (const g of glyphs.values()) for (const s of g.strokes) for (const p of s) { yLo = Math.min(yLo, p.y); yHi = Math.max(yHi, p.y + 1); }
  const H = inkBox(glyphs.get('H')?.strokes ?? [[{ x: 0, y: 0 }, { x: 0, y: 700 }]]);
  const X = inkBox(glyphs.get('x')?.strokes ?? [[{ x: 0, y: 0 }, { x: 0, y: 450 }]]);
  return {
    name,
    upm: parseFloat(attr(fontFace, 'units-per-em') || '1000'),
    glyphs, missingAdv: defaultAdvance,
    base: H.y0, xTop: X.y1, capTop: H.y1,
    yLo, dy: (yHi - yLo) / ROWS,
    profiles: new Map(), kerns: new Map(), target: null,
  };
}

function profile(font, ch) {
  if (font.profiles.has(ch)) return font.profiles.get(ch);
  const g = font.glyphs.get(ch);
  let result = null;
  if (g && g.strokes.length) {
    const l = new Float64Array(ROWS).fill(NaN), r = new Float64Array(ROWS).fill(NaN);
    const put = (x, y) => {
      const i = Math.floor((y - font.yLo) / font.dy);
      if (i < 0 || i >= ROWS) return;
      if (!(l[i] <= x)) l[i] = x;
      if (!(r[i] >= x)) r[i] = x;
    };
    for (const s of g.strokes) {
      if (s.length === 1) put(s[0].x, s[0].y);
      for (let k = 1; k < s.length; k++) {
        const a = s[k - 1], b = s[k];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (font.dy * 0.35)));
        for (let j = 0; j <= n; j++) put(a.x + ((b.x - a.x) * j) / n, a.y + ((b.y - a.y) * j) / n);
      }
    }
    const widen = (k) => {
      const lw = new Float64Array(ROWS).fill(NaN), rw = new Float64Array(ROWS).fill(NaN);
      for (let i = 0; i < ROWS; i++) for (let j = 0; j < ROWS; j++) {
        const d = Math.abs(i - j) * font.dy * k;
        if (!Number.isNaN(l[j]) && !(lw[i] <= l[j] + d)) lw[i] = l[j] + d;
        if (!Number.isNaN(r[j]) && !(rw[i] >= r[j] - d)) rw[i] = r[j] - d;
      }
      return [lw, rw];
    };
    const [lw, rw] = widen(SHADE), [l45, r45] = widen(1);
    result = { l: lw, r: rw, l45, r45 };
  }
  font.profiles.set(ch, result);
  return result;
}

const isLower = (ch) => ch !== ch.toUpperCase() && ch === ch.toLowerCase();
const isLetter = (ch) => /[\p{L}\p{N}]/u.test(ch);

function approach(font, a, b) {
  const pa = profile(font, a), pb = profile(font, b);
  if (!pa || !pb) return null;
  const adv = font.glyphs.get(a).adv;
  const lower = isLower(a) || isLower(b) || !isLetter(a) || !isLetter(b);
  const top = lower ? font.xTop : font.capTop;
  const i0 = Math.max(0, Math.floor((font.base - font.yLo) / font.dy));
  const i1 = Math.min(ROWS - 1, Math.floor((top - font.yLo) / font.dy));
  let m = Infinity;
  for (let i = i0; i <= i1; i++) {
    const ra = pa.r[i], lb = pb.l[i];
    if (!Number.isNaN(ra) && !Number.isNaN(lb)) m = Math.min(m, adv + lb - ra);
  }
  return m === Infinity ? null : m;
}

function pairKern(font, a, b) {
  if (a === ' ' || b === ' ' || !(OPEN_R.has(a) || OPEN_L.has(b))) return 0;
  if (!isLetter(a) && !isLetter(b)) return 0;
  const key = a + b;
  if (font.kerns.has(key)) return font.kerns.get(key);
  if (!font.target) {
    const mean = (pairs) => pairs.map((p) => approach(font, p[0], p[1]) ?? 0).reduce((x, y) => x + y, 0) / pairs.length;
    font.target = { lc: mean(['nn', 'oo', 'no', 'on']), uc: mean(['HH', 'OO', 'HO', 'OH']) };
  }
  const m = approach(font, a, b);
  let k = 0;
  if (m !== null) {
    const lower = isLower(a) || isLower(b) || !isLetter(a) || !isLetter(b);
    k = Math.max(-0.15 * font.upm, Math.min(0, STRENGTH * ((lower ? font.target.lc : font.target.uc) - m)));
    const pa = profile(font, a), pb = profile(font, b), adv = font.glyphs.get(a).adv;
    let near = Infinity;
    for (let i = 0; i < ROWS; i++) {
      const ra = pa.r45[i], lb = pb.l45[i];
      if (!Number.isNaN(ra) && !Number.isNaN(lb)) near = Math.min(near, adv + lb - ra);
    }
    k = Math.max(k, Math.min(0, CLEAR * font.upm - near));
  }
  font.kerns.set(key, k);
  return k;
}

// Polylines in px (origin left baseline, y down) with cumulative lengths for writing.
export function strokeText(font, text, size, tracking = 0) {
  const s = size / font.upm;
  const kern = !CONNECTED.has(font.name);
  const strokes = [], charOf = [];
  let x = 0;
  const chars = Array.from(text);
  chars.forEach((ch, ci) => {
    const g = font.glyphs.get(ch);
    for (const st of g?.strokes ?? []) {
      strokes.push(st.map((p) => ({ x: x + p.x * s, y: -p.y * s })));
      charOf.push(ci);
    }
    x += (g?.adv ?? font.missingAdv) * s + tracking;
    if (kern && ci + 1 < chars.length) x += pairKern(font, ch, chars[ci + 1]) * s;
  });
  const lens = strokes.map((p) => polylineLengths(p));
  const startLen = [];
  let acc = 0;
  for (const L of lens) { startLen.push(acc); acc += L[L.length - 1] ?? 0; }
  const charRange = chars.map(() => [Infinity, -Infinity]);
  strokes.forEach((_, i) => {
    const r = charRange[charOf[i]];
    r[0] = Math.min(r[0], startLen[i]);
    r[1] = Math.max(r[1], startLen[i] + (lens[i][lens[i].length - 1] ?? 0));
  });
  let last = 0;
  for (const r of charRange) {
    if (r[0] === Infinity) { r[0] = last; r[1] = last; }
    last = r[1];
  }
  return { strokes, startLen, lens, total: acc, width: x - tracking, charRange, size, missing: chars.filter((ch) => ch.trim() && !font.glyphs.has(ch)) };
}

// Pen distance at time t from each character's own [start, end] window, so the
// pen follows the timeline's word timing instead of a fixed px/s constant.
export function writtenLength(layout, charTimes, t) {
  let len = 0;
  for (let i = 0; i < layout.charRange.length; i++) {
    const [a, b] = layout.charRange[i];
    const [t0, t1] = charTimes[i] ?? [Infinity, Infinity];
    if (t >= t1) len = b;
    else if (t > t0) { len = a + (b - a) * ((t - t0) / Math.max(1e-3, t1 - t0)); break; }
    else break;
  }
  return len;
}

// The written prefix of each polyline as flat coordinate arrays for the page.
export function writtenStrokes(layout, len) {
  const out = [];
  for (let i = 0; i < layout.strokes.length; i++) {
    const s0 = layout.startLen[i];
    if (s0 >= len) break;
    const pts = layout.strokes[i], L = layout.lens[i], remain = len - s0;
    const flat = [pts[0].x, pts[0].y];
    let j = 1;
    for (; j < pts.length && L[j] <= remain; j++) flat.push(pts[j].x, pts[j].y);
    if (j < pts.length) {
      const a = pts[j - 1], b = pts[j];
      const u = (remain - L[j - 1]) / Math.max(1e-6, L[j] - L[j - 1]);
      flat.push(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
    }
    out.push(flat);
  }
  return out;
}

export function strokeBounds(layout) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of layout.strokes) for (const p of s) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}
