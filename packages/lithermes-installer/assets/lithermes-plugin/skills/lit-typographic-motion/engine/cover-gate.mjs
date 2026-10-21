// The cover gate (references/cover.md): G0 determinism, G1 budget and loop, G2 motion energy, G3
// anti-slide, G4 seam, G5 title contrast, G6 title cap height. It measures the DECODED cover (the
// animated WebP, or the GIF fallback), never only the frames that went into the encoder. Motion
// numbers are taken on a fixed time grid, because the encoder merges identical frames into one
// long frame and counting frames would make a slide film look busy; the loop is a ring, so the
// seam is one more step. FLOOR fails a cover, TARGET is the cover-mode goal and the strict verdict.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { COVER } from './constants.mjs';
import { lumaGrid } from './cover-image.mjs';
import { decodePng } from './cover-png.mjs';
import { decodeWebp, which } from './cover-webp.mjs';

const sorted = (xs) => [...xs].sort((a, b) => a - b);
const median = (xs) => { const s = sorted(xs), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (xs, q) => { const s = sorted(xs); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };
const meanStep = (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length / 255; };

export const readPng = (file) => decodePng(readFileSync(file));
export const framesIn = (dir, prefix = 'f') => (existsSync(dir) ? readdirSync(dir).filter((n) => n.startsWith(prefix) && n.endsWith('.png')).sort().map((n) => join(dir, n)) : []);

// GIF container facts ffmpeg's raw pipe does not return: per-frame delays (ms) and the loop count.
export function gifTiming(bytes) {
  if (bytes.toString('latin1', 0, 3) !== 'GIF') throw new Error('not a GIF file');
  const delays = [];
  let loop = null, delay = 100, at = 13;
  if (bytes[10] & 0x80) at += 3 * (1 << ((bytes[10] & 7) + 1));
  const skip = (p) => { while (p < bytes.length && bytes[p]) p += bytes[p] + 1; return p + 1; };
  while (at < bytes.length) {
    const block = bytes[at];
    if (block === 0x3b) break;
    if (block === 0x21) {
      if (bytes[at + 1] === 0xf9) delay = 10 * bytes.readUInt16LE(at + 4);
      if (bytes[at + 1] === 0xff && bytes.toString('latin1', at + 3, at + 14) === 'NETSCAPE2.0') loop = bytes.readUInt16LE(at + 16);
      at = skip(at + 2);
    } else if (block === 0x2c) {
      let p = at + 10;
      if (bytes[at + 9] & 0x80) p += 3 * (1 << ((bytes[at + 9] & 7) + 1));
      at = skip(p + 1);
      delays.push(delay > 0 ? delay : 100);
      delay = 100;
    } else break;
  }
  return { delays, loop, width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

// Load a cover: { lumas, delays, width, height, loop, bytes, format, kept }. keep(i, ms) is asked
// once per decoded frame, in order, whether to keep that frame whole (RGBA) for the stills.
export function loadCover(input, { fps = 16, keep = () => false, env = process.env } = {}) {
  const lumas = [], kept = new Map();
  if (statSync(input).isDirectory()) {
    let width = 0, height = 0;
    const files = framesIn(input);
    files.forEach((file, i) => {
      const img = readPng(file);
      ({ width, height } = img);
      lumas.push(lumaGrid(img.rgba, width, height).luma);
      if (keep(i, 1000 / fps)) kept.set(i, img.rgba);
    });
    return { lumas, delays: files.map(() => 1000 / fps), width, height, loop: 0, bytes: null, format: 'png', kept };
  }
  if (input.toLowerCase().endsWith('.gif')) {
    const bytes = readFileSync(input), timing = gifTiming(bytes);
    const ffmpeg = which('ffmpeg', env);
    if (!ffmpeg) throw new Error('ffmpeg is needed to decode a GIF cover');
    const raw = spawnSync(ffmpeg, ['-v', 'error', '-i', input, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 2 ** 31, env });
    if (raw.status !== 0) throw new Error(`ffmpeg could not decode ${input}`);
    const size = timing.width * timing.height * 4;
    for (let i = 0; (i + 1) * size <= raw.stdout.length; i++) {
      const rgba = raw.stdout.subarray(i * size, (i + 1) * size);
      lumas.push(lumaGrid(rgba, timing.width, timing.height).luma);
      if (keep(i, timing.delays[i] ?? 100)) kept.set(i, Buffer.from(rgba));
    }
    return { lumas, delays: timing.delays.slice(0, lumas.length), width: timing.width, height: timing.height, loop: timing.loop, bytes: bytes.length, format: 'gif', kept };
  }
  const info = decodeWebp(input, {
    env,
    onFrame: (i, rgba, ms, width, height) => {
      lumas.push(lumaGrid(rgba, width, height).luma);
      if (keep(i, ms > 0 ? ms : 100)) kept.set(i, Buffer.from(rgba));
    },
  });
  return { lumas, delays: info.durations.map((d) => (d > 0 ? d : 100)), width: info.width, height: info.height, loop: info.loop, bytes: info.bytes, format: 'webp', kept };
}

// The frame on screen at each grid time.
export function resample(frames, delays, stepMs) {
  const total = delays.reduce((a, b) => a + b, 0), out = [];
  let i = 0, end = delays[0];
  for (let ms = 0; ms < total - 1e-6; ms += stepMs) {
    while (ms >= end && i < frames.length - 1) end += delays[++i];
    out.push(frames[i]);
  }
  return out;
}

export function motionMetrics({ lumas, delays }) {
  const stepMs = Math.max(COVER.gridMs, Math.min(...delays));
  const grid = resample(lumas, delays, stepMs), n = grid.length;
  const steps = [];
  for (let i = 1; i < n; i++) steps.push(meanStep(grid[i], grid[i - 1]));
  const seam = meanStep(grid[0], grid[n - 1]);
  const ring = [...steps, seam];
  const medianD = median(ring);
  const still = ring.map((d) => d < COVER.stillEps);
  let longest = 0;
  if (still.every(Boolean)) longest = n * stepMs;
  else {
    // Walk the ring once from a moving step, so a hold that wraps the seam is counted whole.
    const start = still.findIndex((s) => !s);
    let run = 0;
    for (let k = 1; k <= n; k++) { run = still[(start + k) % n] ? run + stepMs : 0; longest = Math.max(longest, run); }
  }
  const around = n >= 4 ? (ring[n - 3] + ring[n - 2] + ring[0] + ring[1]) / 4 : medianD;
  return {
    gridFrames: n, stepMs, durationSec: (n * stepMs) / 1000, sourceDurationSec: delays.reduce((a, b) => a + b, 0) / 1000,
    medianD, p90D: quantile(ring, 0.9), maxD: Math.max(...ring), movingFrac: ring.filter((d) => d >= COVER.stillEps).length / ring.length,
    longestStillSec: longest / 1000, spike: Math.max(...ring) / Math.max(medianD, COVER.stillEps), seam, seamLocal: seam / Math.max(COVER.stillEps, around), diffs: ring,
  };
}

const LIN = Float64Array.from({ length: 256 }, (_, v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
const relLum = (px, at) => 0.2126 * LIN[px[at]] + 0.7152 * LIN[px[at + 1]] + 0.0722 * LIN[px[at + 2]];
const boxPx = (box, W, H) => box.map((v, k) => Math.round(v * (k % 2 ? H : W)));

// G5: per frame, the median title pixel against the 90th-percentile background pixel of the title
// box (background = box pixels at least 3 px from any title pixel), through the per-frame mask.
export function titleContrast({ framesDir, masksDir, box }) {
  const frames = framesIn(framesDir, 'f'), masks = framesIn(masksDir, 'm');
  if (!frames.length || masks.length !== frames.length) return { measured: false, reason: `needs one mask per frame (${frames.length} frames, ${masks.length} masks)` };
  const ratios = [];
  for (let i = 0; i < frames.length; i++) {
    const { width: W, height: H, rgba } = readPng(frames[i]);
    const mask = readPng(masks[i]);
    if (mask.width !== W || mask.height !== H) return { measured: false, reason: `mask ${i} is ${mask.width}x${mask.height}, the frame ${W}x${H}` };
    const [bx, by, bw, bh] = boxPx(box, W, H);
    const role = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) if (mask.rgba[p * 4] > 127) role[p] = 2;
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) {
      if (role[y * W + x] !== 2) continue;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < H && xx >= 0 && xx < W && role[yy * W + xx] === 0) role[yy * W + xx] = 1;
      }
    }
    const text = [], ground = [];
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) {
      const r = role[y * W + x];
      if (r === 2) text.push(relLum(rgba, (y * W + x) * 4)); else if (r === 0) ground.push(relLum(rgba, (y * W + x) * 4));
    }
    if (!text.length || !ground.length) return { measured: false, reason: `frame ${i}: the title box holds ${text.length} title and ${ground.length} background pixels` };
    const t = median(text), g = t > median(ground) ? quantile(ground, 0.9) : quantile(ground, 0.1);
    ratios.push((Math.max(t, g) + 0.05) / (Math.min(t, g) + 0.05));
  }
  return { measured: true, min: Math.min(...ratios), median: median(ratios), frames: ratios.length };
}

// G6: the title's cap height at the README display width. In up to 12 sampled masks the white
// pixels inside the title box split into connected glyphs; dots and accents (under 1 % of the
// largest glyph's area or 30 % of the tallest glyph) are dropped and the median height of the rest
// is that frame's cap height. The smallest one, scaled from the cover width to displayWidth, must
// reach COVER.minCapPx. A title painted into declared base art is exempt: measured, reported INFO.
export function glyphHeights({ masksDir, box, displayWidth = COVER.displayWidth, exempt = null, samples = 12 }) {
  const masks = framesIn(masksDir, 'm');
  if (!masks.length) return { pass: false, reason: 'no mask frames to measure the title on' };
  const n = Math.min(samples, masks.length);
  const picks = [...new Set(Array.from({ length: n }, (_, k) => Math.floor((k * masks.length) / n)))];
  let cap = Infinity, glyphs = 0, width = 0;
  for (const i of picks) {
    const m = readPng(masks[i]);
    width = m.width;
    const [bx, by, bw, bh] = boxPx(box, m.width, m.height);
    const on = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) on[y * bw + x] = m.rgba[((by + y) * m.width + bx + x) * 4] > 127 ? 1 : 0;
    const parts = [];
    for (let seed = 0; seed < on.length; seed++) {
      if (on[seed] !== 1) continue;
      const stack = [seed];
      on[seed] = 2;
      let area = 0, top = bh, bottom = -1;
      while (stack.length) {
        const q = stack.pop(), y = Math.floor(q / bw), x = q - y * bw;
        area++; top = Math.min(top, y); bottom = Math.max(bottom, y);
        for (const nb of [x > 0 ? q - 1 : -1, x < bw - 1 ? q + 1 : -1, y > 0 ? q - bw : -1, y < bh - 1 ? q + bw : -1]) if (nb >= 0 && on[nb] === 1) { on[nb] = 2; stack.push(nb); }
      }
      parts.push({ area, height: bottom - top + 1 });
    }
    if (!parts.length) return { pass: false, reason: `mask ${i}: no title pixels inside the title box` };
    const biggest = Math.max(...parts.map((p) => p.area)), tallest = Math.max(...parts.map((p) => p.height));
    const letters = parts.filter((p) => p.area >= 0.01 * biggest && p.height >= 0.3 * tallest);
    glyphs = Math.max(glyphs, letters.length);
    cap = Math.min(cap, median(letters.map((p) => p.height)));
  }
  const capPx = (cap * displayWidth) / width;
  const row = { capPx: Number(capPx.toFixed(1)), coverPx: cap, displayWidth, glyphs, sampled: picks.length };
  return exempt ? { pass: null, ...row, reason: exempt } : { pass: capPx >= COVER.minCapPx, ...row };
}

// G0: SHA-256 per frame file of two independent captures.
export function determinism(dirA, dirB) {
  const a = framesIn(dirA, 'f'), b = framesIn(dirB, 'f');
  const hash = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
  let identical = 0, firstDiffering = null;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { if (hash(a[i]) === hash(b[i])) identical++; else if (firstDiffering === null) firstDiffering = i; }
  return { compared: n, identical, countsMatch: a.length === b.length, firstDiffering };
}

// Gate one cover. Options: frames + frames2 (G0), masks + title (G5, G6), glyph ({ displayWidth,
// exempt }), fps (for a PNG folder input), keep. Returns the metrics, each gate, pass and target.
export function coverGate(input, { frames = null, frames2 = null, masks = null, title = null, glyph = {}, fps = 16, keep, env = process.env } = {}) {
  const src = loadCover(input, { fps, keep, env });
  const m = motionMetrics(src);
  const F = COVER.floor, T = COVER.target, gates = {};
  if (frames && frames2) {
    const det = determinism(frames, frames2);
    gates.G0 = { pass: det.compared > 0 && det.countsMatch && det.identical === det.compared, ...det };
  }
  if (src.format !== 'png') {
    gates.G1 = {
      pass: src.bytes <= COVER.maxBytes && m.sourceDurationSec >= COVER.minSec && m.sourceDurationSec <= COVER.maxSec && src.loop === 0,
      target: src.bytes <= COVER.targetBytes, bytes: src.bytes, durationSec: m.sourceDurationSec, loop: src.loop, size: `${src.width}x${src.height}`,
    };
  }
  gates.G2 = { pass: m.medianD >= F.medianD && m.movingFrac >= F.movingFrac, target: m.medianD >= T.medianD && m.movingFrac >= T.movingFrac, medianD: m.medianD, movingFrac: m.movingFrac };
  gates.G3 = { pass: m.longestStillSec <= F.stillSec, target: m.longestStillSec <= T.stillSec && m.spike <= T.spike, longestStillSec: m.longestStillSec, spike: m.spike };
  gates.G4 = { pass: m.seamLocal <= F.seamLocal, target: m.seamLocal >= T.seamLo && m.seamLocal <= T.seamHi, seam: m.seam, seamLocal: m.seamLocal };
  if (title && masks) {
    const c = frames ? titleContrast({ framesDir: frames, masksDir: masks, box: title }) : { measured: false, reason: 'needs the captured frames (--frames) beside the masks' };
    gates.G5 = c.measured ? { pass: c.min >= COVER.minContrast, min: c.min, median: c.median, frames: c.frames } : { pass: false, reason: c.reason };
    gates.G6 = glyphHeights({ masksDir: masks, box: title, displayWidth: glyph.displayWidth ?? COVER.displayWidth, exempt: glyph.exempt ?? null });
  }
  return finishGate({ input, src, m, gates });
}

// Recompute the verdicts after a caller added gates (SEEK, ART, FLASH).
export function finishGate({ input, src, m, gates }) {
  const pass = Object.values(gates).every((g) => g.pass !== false);
  const target = pass && Object.values(gates).every((g) => g.target !== false);
  return { input, format: src.format, width: src.width, height: src.height, bytes: src.bytes, loop: src.loop, sourceFrames: src.lumas.length, durations: src.delays, kept: src.kept, ...m, gates, pass, target, src, m };
}

const num = (x) => (typeof x === 'number' && !Number.isInteger(x) ? Number(x.toPrecision(4)) : x);

export function coverVerdict(r) {
  return r.pass ? (r.target ? 'PASS+TARGET' : 'PASS(floor)') : 'FAIL';
}

// Report text: the strict verdict line, the file line, one line per gate.
export function formatCoverReport(r, { strict = true } = {}) {
  const lines = [
    `COVER gate${strict ? ' --strict' : ''}: ${coverVerdict(r)}`,
    `  ${r.width}x${r.height} ${r.format} frames=${r.sourceFrames} dur=${num(r.sourceDurationSec)}s bytes=${r.bytes ?? '-'} loop=${r.loop} grid=${num(r.stepMs)}ms`,
  ];
  for (const [id, g] of Object.entries(r.gates)) {
    const { pass, target, ...detail } = g;
    const word = pass === null ? 'INFO' : pass ? (target === false ? 'pass(floor)' : 'pass') : 'FAIL';
    lines.push(`  ${id} ${word} ${Object.entries(detail).map(([k, v]) => `${k}=${num(v)}`).join(' ')}`.trimEnd());
  }
  return `${lines.join('\n')}\n`;
}
