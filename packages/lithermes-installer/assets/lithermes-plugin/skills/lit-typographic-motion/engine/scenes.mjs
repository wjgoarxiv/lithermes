// Original starter scenes. Each render(f) is a pure function of the frame
// (shot-local time f.lt, progress f.p, beat length f.beat and the timeline's
// own reveal units) and returns a display list in logical 1920x1080 px:
// text elements, stroke text, flat graphics, hairline rules and post overrides.
// Beats are anchored to the shot window and reveal starts, never to literal
// frame numbers (MO-A-06). Only number-counter carries state (MO-A-05).
import { clamp, ease, lerp, prog } from './util.mjs';
import { eojeols } from './type.mjs';
import { listItems } from './timeline.mjs';

const LEFT = 120;
const CONTENT_W = 1680;

// Motion tokens per preset (MO-B-01..03), expressed against the shot window.
function entrance(f, token) {
  if (f.still) return { alpha: 1, scale: 1, dy: 0, landed: true };
  if (token === 'drift') {
    const alpha = prog(f.lt, 0, Math.min(1.2, f.hold * 0.4), ease.inOutSine);
    const dy = lerp(24, 0, prog(f.lt, 0, Math.min(2.4, f.hold * 0.8), ease.inOutSine));
    return { alpha, scale: 1, dy, landed: f.lt >= Math.min(1.2, f.hold * 0.4) };
  }
  const dur = f.tokens.entranceSec ?? 0.18;
  const k = prog(f.lt, 0, dur, ease.slam);
  return { alpha: k, scale: lerp(0.96, 1, k), dy: 0, landed: f.lt >= dur };
}

function typedCount(f, text) {
  if (f.still) return Array.from(text).length;
  const cps = f.tokens.typeCps || 22;
  const chars = Array.from(text);
  const shown = Math.floor(Math.max(0, f.lt) * cps);
  if (!/[가-힣]/u.test(text)) return Math.min(chars.length, shown);
  // Hangul types a whole 어절 at a time so a word never appears half-built.
  let count = 0, typed = 0;
  for (const word of text.split(/(\s+)/u)) {
    const n = Array.from(word).length;
    if (typed + n <= shown || /^\s+$/u.test(word)) { count += n; typed += n; } else break;
  }
  return count;
}

function annotation(f, text, x, y, extra = {}) {
  return { id: `${f.shot.id}:note`, text, voice: 'machine', role: 'annotation', size: 24, weight: 400, x, y, align: 'left', alpha: extra.alpha ?? 1, trackingEm: 0.02 };
}

// One window title for the whole film: a label that changes at a cut leaves a
// CRT-persistence ghost of the old text under the new one. The title is the
// film's own name or nothing, and the shot index shows only when the brief asks.
function terminalChrome(f) {
  const status = f.showIndex ? `${String(f.shotNumber).padStart(2, '0')}/${String(f.shotCount).padStart(2, '0')}` : '';
  return { window: [72, 64, 1776, 952], titleBar: 46, title: f.windowTitle, status, meters: [clamp(f.p), clamp((f.t) / f.duration)], caret: null };
}

function accentMark(f, x, y) {
  if (!f.accent || f.still) return [];
  const on = f.lt >= f.accent.from && f.lt < f.accent.to;
  return on ? [{ id: `${f.shot.id}:accent`, x, y, w: 28, h: 28, role: 'accent', alpha: 1 }] : [];
}

const titleSlam = {
  id: 'title-slam',
  render(f) {
    const text = f.shot.text;
    const hangul = /[가-힣]/u.test(text);
    const out = { texts: [], strokes: [], rects: [], rules: [], overrides: {} };
    if (f.preset.id === 'terminalcore') {
      const typed = typedCount(f, text);
      out.terminal = terminalChrome(f);
      out.texts.push({ id: f.shot.id, text, voice: 'display', role: 'text', fit: { maxWidth: 1540, max: hangul ? 108 : 150, min: 54, pixelGrid: hangul ? 9 : 0 }, x: 200, y: 560, align: 'left', alpha: 1, visibleChars: typed, trackingEm: 0 });
      out.texts.push({ id: `${f.shot.id}:prompt`, text: '>', voice: 'machine', role: 'annotation', size: 72, weight: 400, x: 120, y: 540, alpha: 1, trackingEm: 0 });
      out.terminal.caret = { after: f.shot.id, blinkHz: 1.2, t: f.lt, visibleAfterType: typed >= Array.from(text).length };
      return out;
    }
    const e = entrance(f, f.tokens.entrance);
    const widthStep = f.preset.id === 'swiss-signal' && !f.still && f.lt < (f.tokens.entranceSec ?? 0.18) / 2 ? 125 : 100;
    out.texts.push({
      id: f.shot.id, text, voice: 'display', role: 'text', weight: f.preset.id === 'tidal' ? 700 : 900, widthStep,
      fit: { maxWidth: CONTENT_W, max: f.preset.id === 'tidal' ? 150 : (hangul ? 150 : 190), min: 64 },
      x: LEFT, y: 590 + e.dy, align: 'left', alpha: e.alpha, scale: e.scale, trackingEm: hangul ? 0 : -0.02,
    });
    if (f.showIndex) out.texts.push(annotation(f, `${String(f.shotNumber).padStart(2, '0')} — ${String(f.shotCount).padStart(2, '0')}`, LEFT, 150, { alpha: e.alpha }));
    if (f.preset.passes.includes('swiss-grid')) {
      const len = f.still ? 1 : prog(f.lt, 0, 2 * f.beat, ease.outCubic);
      out.rules.push({ id: `${f.shot.id}:rule`, x0: LEFT, y0: 660, x1: LEFT + 960 * len, y1: 660, width: 2, role: 'rule', alpha: 1 });
      out.rules.push({ id: `${f.shot.id}:tick`, x0: LEFT, y0: 104, x1: LEFT + 64, y1: 104, width: 2, role: 'rule', alpha: 1 });
    }
    out.rects.push(...accentMark(f, LEFT + 980, 646));
    return out;
  },
};

const karaokeLine = {
  id: 'karaoke-line',
  render(f) {
    const text = f.shot.text;
    const words = eojeols(text);
    const reveals = f.reveals;
    const out = { texts: [], strokes: [], rects: [], rules: [], overrides: {} };
    const starts = reveals.length === words.length ? reveals.map((r) => r.start - f.shot.start) : words.map((_, i) => (i * f.hold * 0.6) / words.length);
    const wordState = words.map((_, i) => {
      if (f.still) return { alpha: 1, dy: 0, current: false };
      const k = prog(f.lt, starts[i], starts[i] + 0.12, ease.outCubic);
      const next = i + 1 < starts.length ? starts[i + 1] : Infinity;
      return { alpha: k, dy: lerp(14, 0, k), current: f.lt >= starts[i] && f.lt < next && i < words.length - 1 };
    });
    const terminal = f.preset.id === 'terminalcore';
    if (terminal) out.terminal = terminalChrome(f);
    out.texts.push({
      id: f.shot.id, text, voice: terminal ? 'display' : 'body', role: 'text', weight: 700,
      fit: { maxWidth: terminal ? 1560 : CONTENT_W - 40, max: terminal ? 90 : 128, min: 48, maxLines: 3, pixelGrid: terminal ? 9 : 0 },
      x: terminal ? 200 : LEFT + 40, y: 570, align: 'left', alpha: 1, trackingEm: 0,
      words: wordState.map((w) => ({ alpha: w.alpha, dy: w.dy, role: w.current ? 'emphasis' : 'text' })),
    });
    if (f.preset.passes.includes('swiss-grid')) {
      out.rules.push({ id: `${f.shot.id}:margin`, x0: LEFT, y0: 430, x1: LEFT, y1: 430 + 190 * (f.still ? 1 : prog(f.lt, 0, f.beat, ease.outCubic)), width: 2, role: 'rule', alpha: 1 });
    }
    return out;
  },
};

const kineticList = {
  id: 'kinetic-list',
  render(f) {
    const items = listItems(f.shot.text);
    const out = { texts: [], strokes: [], rects: [], rules: [], overrides: {} };
    const terminal = f.preset.id === 'terminalcore';
    if (terminal) out.terminal = terminalChrome(f);
    const starts = f.reveals.length === items.length ? f.reveals.map((r) => r.start - f.shot.start) : items.map((_, i) => i * f.beat);
    const rows = items.length;
    const rowSize = Math.min(104, Math.floor(760 / (rows * 1.6)));
    const top = 540 - ((rows - 1) * rowSize * 1.6) / 2;
    out.block = { id: f.shot.id, lines: rows, lineHeight: 1.6 };
    items.forEach((item, i) => {
      const k = f.still ? 1 : prog(f.lt, starts[i], starts[i] + (f.tokens.entranceSec ?? 0.2), ease.slam);
      const y = top + i * rowSize * 1.6 + rowSize * 0.35;
      out.texts.push({ id: `${f.shot.id}:n${i}`, text: String(i + 1).padStart(2, '0'), voice: 'machine', role: 'annotation', size: 26, weight: 400, x: LEFT, y, alpha: k, trackingEm: 0.02 });
      out.texts.push({ id: `${f.shot.id}:i${i}`, text: item, voice: terminal ? 'display' : 'body', role: i === rows - 1 && !f.still && f.lt < starts[i] + f.beat ? 'emphasis' : 'text', weight: 700, fit: { maxWidth: 1520, max: rowSize, min: 40, pixelGrid: terminal ? 9 : 0 }, x: 220 + lerp(-24, 0, k), y, alpha: k, trackingEm: 0, blockId: f.shot.id });
      if (f.preset.passes.includes('swiss-grid') && i < rows - 1) {
        out.rules.push({ id: `${f.shot.id}:sep${i}`, x0: LEFT, y0: y + rowSize * 0.55, x1: LEFT + 1560 * k, y1: y + rowSize * 0.55, width: 1.5, role: 'rule', alpha: k });
      }
    });
    return out;
  },
};

// Counts toward the brief's own number with a critically damped spring,
// integrated on a fixed 1/fps grid from the shot start so a seek re-derives
// exactly the state a sequential render carried (MO-A-05, MO-A-25).
const numberCounter = {
  id: 'number-counter',
  stateful: true,
  prerollMax: Infinity,
  reset() { return { steps: 0, x: 0, v: 0 }; },
  // Settles inside about 0.8 s; once within half a displayed unit it snaps, so
  // the final number is exact and holds for the rest of the shot.
  step(state, target, fps, decimals = 0) {
    if (state.done) return { ...state, steps: state.steps + 1 };
    const dt = 1 / fps, w = 10;
    const a = w * w * (target - state.x) - 2 * w * state.v;
    const v = state.v + a * dt;
    const x = state.x + v * dt;
    const close = Math.abs(target - x) < 0.5 * 10 ** -decimals && Math.abs(v) < 10 ** -decimals * fps;
    return close ? { steps: state.steps + 1, x: target, v: 0, done: true } : { steps: state.steps + 1, x, v };
  },
  render(f) {
    const { raw, target, decimals, suffix } = counterTarget(f.shot.text);
    const value = f.still ? target : Math.min(target, Math.max(0, f.state?.x ?? 0));
    const shown = formatLike(raw, value, decimals) + suffix;
    const label = f.shot.text.replace(raw + suffix, '').replace(/\s+/g, ' ').trim();
    const out = { texts: [], strokes: [], rects: [], rules: [], overrides: {} };
    const terminal = f.preset.id === 'terminalcore';
    if (terminal) out.terminal = terminalChrome(f);
    const e = terminal ? { alpha: 1, scale: 1, dy: 0 } : entrance(f, f.tokens.entrance === 'drift' ? 'drift' : 'slam');
    out.texts.push({ id: `${f.shot.id}:num`, text: shown, voice: 'display', role: 'text', weight: 900, fit: { maxWidth: 1400, max: 220, min: 80, sample: formatLike(raw, target, decimals) + suffix, pixelGrid: 0 }, x: LEFT, y: 520 + e.dy, align: 'left', alpha: e.alpha, trackingEm: 0 });
    if (label) out.texts.push({ id: `${f.shot.id}:label`, text: label, voice: 'body', role: 'text', weight: 400, fit: { maxWidth: CONTENT_W, max: 64, min: 36, pixelGrid: terminal ? 9 : 0 }, x: LEFT, y: 680 + e.dy, align: 'left', alpha: e.alpha, trackingEm: 0 });
    const ratio = target > 0 ? clamp(value / target) : 1;
    out.rects.push({ id: `${f.shot.id}:bar`, x: LEFT, y: 760, w: Math.max(2, 1200 * ratio), h: 10, role: 'emphasis', alpha: e.alpha });
    return out;
  },
};

export function counterTarget(text) {
  const match = String(text).match(/(\d[\d,]*(?:\.\d+)?)(%?)/);
  const raw = match ? match[1] : '0';
  return { raw, suffix: match ? match[2] : '', target: Number(raw.replace(/,/g, '')) || 0, decimals: (raw.split('.')[1] || '').length };
}

function formatLike(raw, value, decimals) {
  const fixed = value.toFixed(decimals);
  if (!raw.includes(',')) return fixed;
  const [int, frac] = fixed.split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? `.${frac}` : '');
}

const strokeSignature = {
  id: 'stroke-signature',
  render(f) {
    const out = { texts: [], strokes: [], rects: [], rules: [], overrides: {} };
    const chars = Array.from(f.shot.text);
    const writeSec = Math.max(0.6, f.hold - f.beat);
    const per = writeSec / Math.max(1, chars.length);
    const charTimes = chars.map((_, i) => [f.shot.start + i * per, f.shot.start + (i + 1) * per]);
    out.strokes.push({ id: f.shot.id, text: f.shot.text, font: 'script', size: 200, x: LEFT + 40, y: 600, width: 4, role: 'text', alpha: 1, charTimes, t: f.still ? Infinity : f.t });
    if (f.preset.passes.includes('swiss-grid')) out.rules.push({ id: `${f.shot.id}:base`, x0: LEFT, y0: 660, x1: LEFT + 720, y1: 660, width: 1.5, role: 'rule', alpha: 1 });
    if (f.preset.id === 'terminalcore') out.terminal = terminalChrome(f);
    return out;
  },
};

const endCard = {
  id: 'end-card',
  render(f) {
    const text = f.shot.text;
    const out = { texts: [], strokes: [], rects: [], rules: [], overrides: {} };
    const terminal = f.preset.id === 'terminalcore';
    const hangul = /[가-힣]/u.test(text);
    if (terminal) {
      out.terminal = terminalChrome(f);
      const typed = typedCount(f, text);
      out.texts.push({ id: f.shot.id, text, voice: 'display', role: 'text', fit: { maxWidth: 1540, max: hangul ? 90 : 120, min: 54, maxLines: 2, pixelGrid: hangul ? 9 : 0 }, x: 200, y: 560, align: 'left', alpha: 1, visibleChars: typed, trackingEm: 0 });
      out.texts.push({ id: `${f.shot.id}:prompt`, text: '>', voice: 'machine', role: 'annotation', size: 64, weight: 400, x: 120, y: 544, alpha: 1, trackingEm: 0 });
      out.terminal.caret = { after: f.shot.id, blinkHz: 1.2, t: f.lt, visibleAfterType: typed >= Array.from(text).length };
    } else {
      const e = entrance(f, f.tokens.entrance);
      out.texts.push({ id: f.shot.id, text, voice: 'display', role: 'text', weight: 700, fit: { maxWidth: CONTENT_W, max: hangul ? 120 : 132, min: 56, maxLines: 2 }, x: LEFT, y: 600 + e.dy, align: 'left', alpha: e.alpha, scale: e.scale, trackingEm: hangul ? 0 : -0.01 });
      if (f.reduced && f.firstLine && f.firstLine !== text) {
        out.texts.push({ id: `${f.shot.id}:title`, text: f.firstLine, voice: 'body', role: 'annotation', weight: 700, fit: { maxWidth: CONTENT_W, max: 44, min: 32 }, x: LEFT, y: 360, align: 'left', alpha: 1, trackingEm: 0 });
      }
      if (f.preset.passes.includes('swiss-grid')) out.rules.push({ id: `${f.shot.id}:rule`, x0: LEFT, y0: 420, x1: LEFT + 240, y1: 420, width: 2, role: 'rule', alpha: 1 });
    }
    return out;
  },
};

export const SCENE_MODULES = Object.freeze({
  'title-slam': titleSlam,
  'karaoke-line': karaokeLine,
  'kinetic-list': kineticList,
  'number-counter': numberCounter,
  'stroke-signature': strokeSignature,
  'end-card': endCard,
});
