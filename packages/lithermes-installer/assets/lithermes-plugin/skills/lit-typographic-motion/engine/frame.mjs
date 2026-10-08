// Frame composer: turns a scene display list into (a) the draw spec the page
// rasterizes and (b) the frame-line metadata the gate reads (textBoxes from
// outline geometry, graphics boxes, fills, overrides). The per-frame sampling,
// preroll and override rules follow pdoom's engine.ts render()/composite()
// method (MIT, see NOTICE), re-expressed around a Node-side display list.
import { FRAME, OVERRIDES } from './constants.mjs';
import { PRESETS } from './presets.mjs';
import { SCENE_MODULES, counterTarget } from './scenes.mjs';
import { layoutLine, inkBounds, wrapWords, eojeols } from './type.mjs';
import { strokeText, writtenLength, writtenStrokes } from './stroke.mjs';
import { shotsOf, revealsOf } from './timeline.mjs';
import { clamp } from './util.mjs';

// Font ids -> files. Archivo comes as pdoom's pre-built width x weight instances
// (weights 500/700/900; 500 stands in for 400, MO-A-59); Hangul reuses this
// product's own lit-pptx Pretendard pair (400 <-> 700 only, MO-A-33).
export const FONT_FILES = Object.freeze({
  ...Object.fromEntries([75, 100, 125].flatMap((w) => [500, 700, 900].map((wt) => [`archivo-w${w}-${wt}`, `fonts/Archivo-w${w * 10}-${wt}.ttf`]))),
  'pretendard-400': 'lit-pptx:Pretendard-Regular.otf',
  'pretendard-700': 'lit-pptx:Pretendard-Bold.otf',
  galmuri9: 'fonts/Galmuri9.ttf',
  vt323: 'fonts/VT323-Regular.ttf',
  meslo: 'fonts/MesloLGS-NF-Regular.ttf',
  'silkscreen-400': 'fonts/Silkscreen-Regular.ttf',
  'silkscreen-700': 'fonts/Silkscreen-Bold.ttf',
});

export const PRESET_FONTS = Object.freeze({
  'swiss-signal': ['archivo-w75-900', 'archivo-w100-500', 'archivo-w100-700', 'archivo-w100-900', 'archivo-w125-900', 'pretendard-400', 'pretendard-700', 'meslo'],
  tidal: ['archivo-w100-500', 'archivo-w100-700', 'archivo-w100-900', 'pretendard-400', 'pretendard-700', 'meslo'],
  terminalcore: ['galmuri9', 'vt323', 'meslo', 'silkscreen-400', 'silkscreen-700', 'pretendard-400'],
});

const archivoWeight = (weight) => (weight >= 800 ? 900 : weight >= 600 ? 700 : 500);

export function resolveFontId(presetId, voice, script, weight = 700, widthStep = 100) {
  const terminal = presetId === 'terminalcore';
  if (script === 'hangul') {
    if (terminal) return voice === 'machine' || voice === 'label' || voice === 'display' || voice === 'body' ? 'galmuri9' : 'pretendard-400';
    return weight >= 600 && voice !== 'machine' ? 'pretendard-700' : 'pretendard-400';
  }
  if (voice === 'machine') return 'meslo';
  if (voice === 'label') return terminal ? (weight >= 600 ? 'silkscreen-700' : 'silkscreen-400') : 'meslo';
  if (terminal) return 'vt323';
  const step = voice === 'display' && [75, 100, 125].includes(widthStep) ? widthStep : 100;
  const id = `archivo-w${step}-${archivoWeight(weight)}`;
  return FONT_FILES[id] ? id : `archivo-w100-${archivoWeight(weight)}`;
}

function colorFor(ctx, role) {
  const preset = PRESETS[ctx.presetId];
  if (role === 'accent') return preset.palette.accent || ctx.signal;
  if (role === 'emphasis') return ctx.signal;
  const key = preset.roles[role] || preset.roles.text;
  if (key === 'signal') return ctx.signal;
  return preset.palette[key] || preset.palette.ink;
}

function measureFor(ctx, el, size) {
  return (text) => layoutLine(text, size, (run) => ctx.fonts.get(resolveFontId(ctx.presetId, el.voice, run.script, el.weight, el.widthStep)), () => el.trackingEm || 0).width;
}

function fitSize(ctx, el) {
  if (el.size) return { size: el.size, lines: [normalize(el.text)] };
  const fit = el.fit;
  const text = normalize(el.text);
  const sample = fit.sample ? normalize(fit.sample) : text;
  const grid = (s) => (fit.pixelGrid ? Math.max(fit.pixelGrid, Math.floor(s / fit.pixelGrid) * fit.pixelGrid) : Math.floor(s));
  for (let size = grid(fit.max); size >= fit.min; size = grid(size - Math.max(1, fit.pixelGrid || 2))) {
    if (measureFor(ctx, el, size)(sample) <= fit.maxWidth) return { size, lines: [text] };
    if (size <= fit.min) break;
  }
  const maxLines = fit.maxLines || 3;
  for (let size = grid(fit.max); size >= fit.min; size = grid(size - Math.max(1, fit.pixelGrid || 2))) {
    const lines = wrapWords(text, fit.maxWidth, measureFor(ctx, el, size));
    if (lines.length <= maxLines && lines.every((line) => measureFor(ctx, el, size)(line) <= fit.maxWidth)) return { size, lines };
    if (size <= fit.min) break;
  }
  const size = grid(fit.min);
  return { size, lines: wrapWords(text, fit.maxWidth, measureFor(ctx, el, size)) };
}

const normalize = (text) => String(text).replace(/\s+/gu, ' ').trim();

export function compileText(ctx, el, post = { zoom: 1, shake: [0, 0] }) {
  const { size, lines } = fitSize(ctx, el);
  const cjk = /[가-힣]/u.test(el.text);
  const lineHeight = el.lineHeight || (lines.length >= 3 ? 1.6 : cjk ? 1.6 : 1.5);
  const scale = el.scale ?? 1;
  const baseY = el.y - ((lines.length - 1) * size * lineHeight) / 2;
  const words = el.words || null;
  const wordOfChar = [];
  if (words) eojeols(el.text).forEach((word, wi) => { for (let i = 0; i < Array.from(word).length; i++) wordOfChar.push(wi); wordOfChar.push(wi); });
  const draws = [], placedVisible = [];
  let charBase = 0, allSettled = (el.alpha ?? 1) >= 0.999 && scale === 1;
  const runs = [];
  lines.forEach((line, li) => {
    const layout = layoutLine(line, size, (run) => ctx.fonts.get(resolveFontId(ctx.presetId, el.voice, run.script, el.weight, el.widthStep)), () => el.trackingEm || 0);
    for (const run of layout.runs) runs.push({ script: run.script, fontFile: run.font.file, trackingEm: run.trackingEm, widthStep: run.script === 'latin' && el.voice === 'display' ? (el.widthStep || 100) : null });
    const ox = el.x - (el.align === 'center' ? layout.width / 2 : 0);
    const oy = baseY + li * size * lineHeight;
    for (const g of layout.glyphs) {
      const global = charBase + g.index;
      if (el.visibleChars != null && global >= el.visibleChars) continue;
      const w = words ? words[wordOfChar[global]] || { alpha: 1, dy: 0, role: el.role } : { alpha: 1, dy: 0, role: el.role };
      const alpha = clamp((el.alpha ?? 1) * w.alpha);
      if (alpha < 0.002 || !g.glyph.bbox) continue;
      if (alpha < 0.999 || w.dy) allSettled = false;
      const gx = ox + g.x, gy = oy + (w.dy || 0);
      const px = el.x + (gx - el.x) * scale, py = el.y + (gy - el.y) * scale;
      const fill = colorFor(ctx, w.role || el.role);
      draws.push({ key: `${g.font.id}#${g.glyph.index}`, font: g.font, glyph: g.glyph, x: px, y: py, s: g.scale * scale, fill, alpha });
      placedVisible.push({ glyph: g.glyph, scale: g.scale, uniform: scale, px, py, fill });
    }
    charBase += Array.from(line).length + 1;
  });
  const raw = inkBounds(placedVisible);
  const bbox = raw && postTransformBox(raw, post);
  const fills = [...new Set(placedVisible.map((p) => p.fill))];
  const primary = runs[0]?.fontFile || '';
  const scripts = [...new Set(runs.map((r) => r.script))];
  const box = bbox && {
    elementId: el.id, text: normalize(el.text), voice: el.voice, fontFile: primary,
    fontSizePx: round(size * scale), capHeightPx: round(ctx.fonts.get(resolveFontId(ctx.presetId, el.voice, scripts[0] || 'latin', el.weight, el.widthStep)).capHeight * size / ctx.fonts.get(resolveFontId(ctx.presetId, el.voice, scripts[0] || 'latin', el.weight, el.widthStep)).upm * scale),
    weight: el.weight ?? 400, fill: fills.length === 1 ? fills[0] : fills.length ? 'mixed' : colorFor(ctx, el.role),
    fills, bbox: bbox.map(round), lines, lineHeight, trackingEm: el.trackingEm || 0,
    script: scripts.length > 1 ? 'mixed' : scripts[0] || 'latin', runs: dedupeRuns(runs),
    scaleX: scale, scaleY: scale, settled: allSettled, role: el.role, blockId: el.blockId || null,
    outline: false, halo: false,
  };
  return { draws, box, size };
}

const dedupeRuns = (runs) => {
  const seen = new Map();
  for (const r of runs) seen.set(`${r.script}|${r.fontFile}|${r.trackingEm}|${r.widthStep}`, r);
  return [...seen.values()];
};
const round = (x) => Math.round(x * 100) / 100;

export function postTransformBox([x0, y0, x1, y1], post) {
  const z = post.zoom ?? 1, [sx, sy] = post.shake ?? [0, 0];
  const cx = FRAME.width / 2, cy = FRAME.height / 2;
  return [(x0 - cx) * z + cx + sx, (y0 - cy) * z + cy + sy, (x1 - cx) * z + cx + sx, (y1 - cy) * z + cy + sy];
}

export function compileStroke(ctx, st, post) {
  const font = ctx.strokeFonts.get(st.font);
  const layout = ctx.strokeLayouts.get(`${st.font}|${st.text}|${st.size}`) || strokeText(font, st.text, st.size);
  ctx.strokeLayouts.set(`${st.font}|${st.text}|${st.size}`, layout);
  const len = st.t === Infinity ? layout.total : writtenLength(layout, st.charTimes, st.t);
  const polylines = writtenStrokes(layout, len).map((flat) => flat.map((v, i) => (i % 2 === 0 ? v + st.x : v + st.y)));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const flat of polylines) for (let i = 0; i < flat.length; i += 2) {
    x0 = Math.min(x0, flat[i]); x1 = Math.max(x1, flat[i]); y0 = Math.min(y0, flat[i + 1]); y1 = Math.max(y1, flat[i + 1]);
  }
  const fill = colorFor(ctx, st.role);
  const half = st.width / 2;
  const box = Number.isFinite(x0) ? {
    elementId: st.id, text: st.text, voice: 'stroke', fontFile: font.file, fontSizePx: st.size, capHeightPx: round(st.size * 0.7),
    weight: 400, fill, fills: [fill], bbox: postTransformBox([x0 - half, y0 - half, x1 + half, y1 + half], post).map(round),
    lines: [st.text], lineHeight: 1, trackingEm: 0, script: 'latin', runs: [{ script: 'latin', fontFile: font.file, trackingEm: 0, widthStep: null }],
    scaleX: 1, scaleY: 1, settled: len >= layout.total - 1e-6 && (st.alpha ?? 1) >= 0.999, role: st.role, blockId: null, outline: false, halo: false,
  } : null;
  return { stroke: { polylines, width: st.width, fill, alpha: st.alpha ?? 1 }, box, total: layout.total };
}

// Terminal chrome drawn as flat Canvas2D graphics plus two small type elements. Both
// use the signal hue: the dim grey drops under 4.5:1 once scanlines and dither thin it.
function terminalElements(ctx, term, typedBox) {
  const preset = PRESETS.terminalcore;
  const [x, y, w, h] = term.window;
  const line = preset.palette.secondary, panel = preset.palette.panel;
  const rects = [
    { id: 'term:panel', x, y, w, h, fill: panel, alpha: 1, role: 'panel' },
    { id: 'term:title', x, y, w, h: term.titleBar, fill: '#111820', alpha: 1, role: 'panel' },
    { id: 'term:top', x, y, w, h: 1.5, fill: line, alpha: 1, role: 'chrome' },
    { id: 'term:bottom', x, y: y + h - 1.5, w, h: 1.5, fill: line, alpha: 1, role: 'chrome' },
    { id: 'term:left', x, y, w: 1.5, h, fill: line, alpha: 1, role: 'chrome' },
    { id: 'term:right', x: x + w - 1.5, y, w: 1.5, h, fill: line, alpha: 1, role: 'chrome' },
    { id: 'term:sep', x, y: y + term.titleBar, w, h: 1.5, fill: line, alpha: 1, role: 'chrome' },
  ];
  term.meters.forEach((value, i) => {
    rects.push({ id: `term:meter${i}`, x: x + w - 380, y: y + h - 58 + i * 20, w: 300, h: 8, fill: '#16202A', alpha: 1, role: 'panel' });
    rects.push({ id: `term:meterfill${i}`, x: x + w - 380, y: y + h - 58 + i * 20, w: Math.max(2, 300 * clamp(value)), h: 8, fill: ctx.signal, alpha: 1, role: 'emphasis' });
  });
  if (term.caret && typedBox) {
    const on = !term.caret.visibleAfterType || Math.floor(term.caret.t * term.caret.blinkHz * 2) % 2 === 0;
    if (on) {
      const [, by0, bx1, by1] = typedBox.bbox;
      rects.push({ id: 'term:caret', x: bx1 + 14, y: by0, w: Math.max(12, (by1 - by0) * 0.5), h: by1 - by0, fill: ctx.signal, alpha: 1, role: 'emphasis' });
    }
  }
  const texts = [
    { id: 'term:label', text: term.title.toUpperCase(), voice: 'label', role: 'emphasis', size: 32, weight: 400, x: x + 32, y: y + 30, alpha: 1, trackingEm: 0.04 },
    { id: 'term:status', text: term.status, voice: 'machine', role: 'emphasis', size: 28, weight: 400, x: x + 32, y: y + h - 30, alpha: 1, trackingEm: 0 },
  ].filter((el) => el.text);
  return { rects, texts };
}

export class FrameComposer {
  constructor({ fonts, strokeFonts, presetId, signal, timeline, plan, fps = FRAME.fps, durationSec, runSeed, software, brief, accent }) {
    this.ctx = { fonts, strokeFonts, presetId, signal, strokeLayouts: new Map() };
    this.preset = PRESETS[presetId];
    this.timeline = timeline;
    this.shots = shotsOf(timeline);
    this.plan = plan;
    this.fps = fps;
    this.durationSec = durationSec;
    this.runSeed = runSeed;
    this.software = software;
    this.brief = brief;
    this.accent = accent;
    this.states = new Map();
    this.sent = new Set();
  }

  // Timeline times are rounded to 6 decimals, so a start can sit up to 5e-7 s
  // after its frame time; a 1e-6 tolerance keeps the cut on its own frame.
  shotIndexAt(t) {
    const i = this.shots.findIndex((s) => t >= s.start - 1e-6 && t < s.end - 1e-6);
    return i < 0 ? this.shots.length - 1 : i;
  }

  // Stateful scenes integrate on a fixed 1/fps grid from the shot start; a
  // backward jump resets and re-integrates (the engine-side preroll).
  stateFor(module, shot, t) {
    if (!module.stateful) return null;
    const key = `${shot.sceneId}#${shot.shotIndex}`;
    const target = Math.max(0, Math.floor((t - shot.start) * this.fps + 1e-6));
    let state = this.states.get(key);
    if (!state || state.steps > target) state = module.reset();
    const { target: value, decimals } = counterTarget(shot.text);
    while (state.steps < target) state = module.step(state, value, this.fps, decimals);
    this.states.set(key, state);
    return state;
  }

  sceneAt(t, { still = false, reduced = false, shotIndex = null } = {}) {
    const index = shotIndex ?? this.shotIndexAt(t);
    const shot = this.shots[index];
    const module = SCENE_MODULES[shot.sceneId];
    const hold = shot.end - shot.start;
    const lt = still ? hold : Math.max(0, t - shot.start);
    const f = {
      t, lt, p: clamp(lt / hold), hold, beat: 60 / (this.brief.bpm || 100), fps: this.fps,
      shot, reveals: revealsOf(this.timeline, shot), preset: this.preset, tokens: this.preset.motion,
      still, reduced, duration: this.durationSec, shotNumber: index + 1, shotCount: this.shots.length,
      showIndex: this.brief.index === true, windowTitle: typeof this.brief.windowTitle === 'string' ? this.brief.windowTitle : '', firstLine: this.shots[0].text,
      accent: this.accent && this.accent.shotId === shot.id ? this.accent : null,
      state: still ? null : this.stateFor(module, shot, t),
    };
    return { shot, index, display: module.render(f), stateful: Boolean(module.stateful) };
  }

  overridesFor(display, { still } = {}) {
    const post = { ...this.preset.post, exposure: 1, fade: 1, flash: 0, shake: [0, 0], zoom: 1, invert: false, ...(display.overrides || {}) };
    if (still) post.grain = 0;
    for (const [key, [min, max]] of Object.entries(OVERRIDES)) {
      if (typeof post[key] !== 'number') continue;
      post[key] = Math.max(min, max == null ? post[key] : Math.min(max, post[key]));
    }
    return post;
  }

  compileSample(t, opts) {
    const { shot, display } = this.sceneAt(t, opts);
    const post = this.overridesFor(display, opts);
    const glyphs = [], strokes = [], rects = [], rules = [], boxes = [], graphics = [];
    const compiled = display.texts.map((el) => ({ el, out: compileText(this.ctx, el, post) }));
    let typedBox = null;
    for (const { el, out } of compiled) {
      glyphs.push(...out.draws);
      if (out.box) boxes.push(out.box);
      if (display.terminal?.caret?.after === el.id) typedBox = out.box;
    }
    for (const st of display.strokes || []) {
      const out = compileStroke(this.ctx, st, post);
      strokes.push(out.stroke);
      if (out.box) boxes.push(out.box);
    }
    let terminal = null;
    if (display.terminal) {
      const chrome = terminalElements(this.ctx, display.terminal, typedBox);
      for (const el of chrome.texts) {
        const out = compileText(this.ctx, el, post);
        glyphs.push(...out.draws);
        if (out.box) boxes.push(out.box);
      }
      terminal = chrome.rects;
      for (const r of chrome.rects) graphics.push({ id: r.id, bbox: postTransformBox([r.x, r.y, r.x + r.w, r.y + r.h], post).map(round), fill: r.fill, role: r.role, area: [r.w, r.h] });
    }
    for (const r of display.rects || []) {
      const fill = colorFor(this.ctx, r.role);
      rects.push({ ...r, fill });
      graphics.push({ id: r.id, bbox: postTransformBox([r.x, r.y, r.x + r.w, r.y + r.h], post).map(round), fill, role: r.role, area: [r.w, r.h] });
    }
    for (const r of display.rules || []) {
      const fill = colorFor(this.ctx, r.role);
      if (Math.hypot(r.x1 - r.x0, r.y1 - r.y0) < 0.5) continue;
      rules.push({ ...r, fill });
      const h = r.width / 2;
      graphics.push({ id: r.id, bbox: postTransformBox([Math.min(r.x0, r.x1) - h, Math.min(r.y0, r.y1) - h, Math.max(r.x0, r.x1) + h, Math.max(r.y0, r.y1) + h], post).map(round), fill, role: r.role, area: [Math.abs(r.x1 - r.x0) + r.width, Math.abs(r.y1 - r.y0) + r.width] });
    }
    return { t, shot, post, glyphs, strokes, rects, rules, terminal, boxes, graphics, block: display.block || null };
  }

  // Page payload for one output frame: N sub-samples (MO-A-28), the post of
  // sample floor(N/2), and new glyph outlines the page has not cached yet.
  // `settled` renders a shot's resolved end state with grain and random noise
  // at 0 (poster, reduced-motion still; MO-A-39/40); every other mode renders
  // the real moment at the frame's own time. Every sub-sample draws the frame's
  // own shot: on a cut frame the pinned early samples fall before the cut, and
  // drawing the old shot there would turn a hard cut into a half dissolve.
  frameSpec(frameIndex, { samples = 1, shutter = 0.5, settled = null } = {}) {
    const tn = frameIndex / this.fps;
    const times = settled ? [tn] : sampleTimes(frameIndex, this.fps, samples, shutter);
    const mid = Math.floor(times.length / 2);
    const frameShot = this.shotIndexAt(tn);
    const compiled = times.map((t) => this.compileSample(t, settled ? { still: true, reduced: Boolean(settled.reduced), shotIndex: settled.shotIndex } : { shotIndex: frameShot }));
    const defs = {};
    for (const s of compiled) for (const d of s.glyphs) {
      if (!this.sent.has(d.key)) { this.sent.add(d.key); defs[d.key] = { upm: d.font.upm, path: d.glyph.pathData() }; }
    }
    const main = compiled[mid];
    const outShot = settled ? main.shot : this.shots[frameShot];
    const passes = this.passUniforms(frameIndex, settled ? main.shot.end : tn, outShot, { settled: Boolean(settled) });
    const spec = {
      frame: frameIndex, mid, settled: Boolean(settled), defs,
      samples: compiled.map((s) => ({
        t: s.t,
        background: this.preset.palette.background,
        tidal: passes.tidal ? this.tidalFor(settled ? s.shot.end : s.t, s.shot, { settled: Boolean(settled) }) : null,
        glyphs: s.glyphs.map((d) => [d.key, round(d.x), round(d.y), d.s, d.fill, round(d.alpha)]),
        strokes: s.strokes, rects: s.rects, rules: s.rules, terminal: s.terminal,
      })),
      passes: { crt: passes.crt, dither: passes.dither, glitch: passes.glitch, swissGrid: passes.swissGrid, terminalUi: passes.terminalUi },
      post: { ...main.post, grainSeed: frameIndex, invert: Boolean(main.post.invert) },
      frameTime: tn,
    };
    const meta = {
      sceneId: outShot.sceneId, shotIndex: outShot.shotIndex, shotId: outShot.id, sampleTimes: times.map(round6),
      textBoxes: main.boxes, graphics: main.graphics, block: main.block,
      fills: this.fillsFor(main, passes),
      overrides: { flash: main.post.flash, invert: Boolean(main.post.invert), zoom: main.post.zoom, shake: main.post.shake, fade: main.post.fade, grain: main.post.grain },
      accent: main.rects.some((r) => r.role === 'accent') || main.boxes.some((b) => b.role === 'accent'),
    };
    return { spec, meta };
  }

  fillsFor(sample, passes) {
    const out = [{ hex: this.preset.palette.background, w: FRAME.width, h: FRAME.height, role: 'background' }];
    if (passes.tidal) for (const hex of this.preset.passes.includes('tidal-gradient') ? [this.preset.palette.stopA, this.preset.palette.stopB] : []) out.push({ hex, w: FRAME.width, h: FRAME.height, role: 'gradient' });
    for (const b of sample.boxes) for (const hex of b.fills || [b.fill]) {
      if (!/^#/.test(hex)) continue;
      out.push({ hex, w: b.bbox[2] - b.bbox[0], h: b.bbox[3] - b.bbox[1], role: b.role === 'emphasis' ? 'emphasis' : 'text' });
    }
    for (const r of sample.rects) out.push({ hex: r.fill, w: r.w, h: r.h, role: r.role });
    for (const r of sample.terminal || []) out.push({ hex: r.fill, w: r.w, h: r.h, role: r.role });
    return out;
  }

  rangeFor(pass, frameIndex) {
    return this.plan.passRanges.find((r) => r.pass === pass && frameIndex >= r.frameStart && frameIndex <= r.frameEnd)
      || this.plan.passRanges.filter((r) => r.pass === pass).at(-1) || null;
  }

  tidalFor(t, shot, { settled }) {
    const range = this.plan.passRanges.find((r) => r.pass === 'tidal-gradient' && r.sceneId === shot.sceneId && r.shotIndex === shot.shotIndex);
    if (!range) return null;
    const p = range.params;
    let surge = 0;
    if (!settled) for (const s of p.surges) {
      const dt = t - s.t;
      if (dt < 0) continue;
      const up = clamp(dt / s.attack), down = clamp((dt - s.attack) / s.decay);
      surge = Math.max(surge, dt < s.attack ? up * up * (3 - 2 * up) : 1 - down * down * (3 - 2 * down));
    }
    return {
      u_time: t, u_seed: range.seed, u_paletteStops: p.paletteStopsHex, u_flowSpeed: p.flowSpeed, u_warpAmount: p.warpAmount,
      u_curlStrength: p.curlStrength, u_octaves: p.octaves, u_surge: surge * p.surgeOnHit, u_ditherAmount: settled ? 0 : p.ditherAmount,
    };
  }

  passUniforms(frameIndex, t, shot, { settled }) {
    const out = {};
    const has = (pass) => this.preset.passes.includes(pass);
    if (has('tidal-gradient')) out.tidal = true;
    if (has('swiss-grid')) {
      const r = this.rangeFor('swiss-grid', frameIndex);
      out.swissGrid = { u_columns: r.params.columns, u_gutterPx: r.params.gutterPx, u_marginPx: r.params.marginPx, u_baselinePx: r.params.baselinePx, u_moduleSnap: true, u_showGuides: r.params.showGuides, u_hairlineWidthPx: 1 };
    }
    if (has('terminal-ui')) {
      const r = this.rangeFor('terminal-ui', frameIndex);
      out.terminalUi = { u_charGridPx: [14, 24], u_windowChromeWidthPx: 1.5, u_meterCount: r.params.meterCount, u_logLineRateCharsPerSec: r.params.logLineRateCharsPerSec, u_caretBlinkHz: r.params.caretBlinkHz, u_seed: r.seed };
    }
    if (has('crt')) {
      const r = this.rangeFor('crt', frameIndex);
      const p = r.params;
      const boot = this.plan.events.find((e) => e.kind === 'boot-flicker' && t >= e.t && t < e.t + e.duration);
      out.crt = {
        u_time: t, u_seed: r.seed, u_scanlineFreqPerFrame: p.scanlineFreq, u_scanlineDepth: p.scanlineDepth,
        u_phosphorPersistence: settled ? 0 : p.phosphorPersistence, u_bloomAmount: 0.2, u_curvature: p.curvature, u_vignette: p.vignette,
        u_triadMaskAmount: p.triadMaskAmount, u_flickerAmp: settled ? 0 : (boot ? p.bootFlickerAmp : p.flickerAmp), u_flickerFreqHz: p.flickerFreqHz,
        persistenceEnabled: Boolean(p.persistenceEnabled) && !settled, shotKey: `${r.sceneId}#${r.shotIndex}`, shotStartFrame: r.frameStart,
      };
    }
    if (has('dither')) {
      const r = this.rangeFor('dither', frameIndex);
      out.dither = { u_ditherMode: r.params.mode, u_paletteSize: r.params.paletteSize, u_pixelScale: r.params.pixelScale, u_ditherStrength: r.params.ditherStrength, u_seed: r.seed };
    }
    if (has('glitch')) {
      const r = this.rangeFor('glitch', frameIndex);
      const hitIndex = settled ? -1 : r.params.hits.findIndex((h) => frameIndex >= h.frame && frameIndex < h.frame + h.holdFrames);
      const hit = hitIndex >= 0 ? r.params.hits[hitIndex] : null;
      out.glitch = { u_time: t, u_seed: r.seed, u_intensity: r.params.intensity, u_active: hit ? 1 : 0, u_slices: hit ? hit.slices : [], u_rgbSplitPx: r.params.rgbSplitPx, u_hitIndex: hitIndex };
    }
    return out;
  }
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

// MO-A-28: t = max(0, t_n + (shutter / fps) * ((i + 0.5) / N - 0.5)).
export function sampleTimes(frameIndex, fps, samples, shutter) {
  const tn = frameIndex / fps;
  return Array.from({ length: samples }, (_, i) => Math.max(0, tn + (shutter / fps) * ((i + 0.5) / samples - 0.5)));
}
