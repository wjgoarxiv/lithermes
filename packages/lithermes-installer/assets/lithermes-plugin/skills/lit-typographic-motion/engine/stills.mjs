// The stills set every render writes, on both paths: each beat's midpoint, a
// transition strip per cut (6 frames before, the cut, 6 after), a 12-frame
// contact sheet and the poster frame, listed with their SHA-256 in
// stills/stills.json. `look` accepts only frames from the latest set.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { areaResize, contactSheet, pngEncode } from './encode.mjs';
import { writeJson } from './director.mjs';

const sha = (data) => createHash('sha256').update(data).digest('hex');
const pad = (n) => String(n).padStart(2, '0');

// beats: [{ index, first, last, mid }] in frames.
export function stillsPlan({ totalFrames, beats }) {
  const clamp = (f) => Math.max(0, Math.min(totalFrames - 1, f));
  const mids = beats.map((b) => ({ index: b.index, frame: clamp(b.mid) }));
  const cuts = beats.slice(1).map((b, i) => ({ index: i + 1, frame: clamp(b.first), frames: [clamp(b.first - 6), clamp(b.first), clamp(b.first + 6)] }));
  const contact = Array.from({ length: 12 }, (_, i) => Math.round((i * (totalFrames - 1)) / 11));
  const poster = clamp(beats[Math.floor(beats.length / 2)].mid);
  const reduced = clamp(beats[beats.length - 1].mid);
  const frames = [...new Set([...mids.map((m) => m.frame), ...cuts.flatMap((c) => c.frames), ...contact, poster, reduced])].sort((a, b) => a - b);
  return { mids, cuts, contact, poster, reduced, frames };
}

function strip(PNG, images, width, height) {
  const portrait = height > width;
  const cellW = portrait ? 360 : 640;
  const tiles = images.map((rgba) => areaResize(rgba, width, height, cellW));
  const cellH = tiles[0].height, gap = 6;
  const W = tiles.length * cellW + (tiles.length + 1) * gap, H = cellH + 2 * gap;
  const buf = Buffer.alloc(W * H * 4);
  for (let i = 0; i < buf.length; i += 4) { buf[i] = 30; buf[i + 1] = 32; buf[i + 2] = 36; buf[i + 3] = 255; }
  tiles.forEach((tile, k) => {
    const left = gap + k * (cellW + gap);
    for (let y = 0; y < cellH; y++) tile.data.copy(buf, ((gap + y) * W + left) * 4, y * cellW * 4, (y + 1) * cellW * 4);
  });
  return pngEncode(PNG, buf, W, H);
}

// pngs: Map frame -> PNG bytes of the full-size capture (or a function frame -> PNG bytes).
export function writeStillsSet({ out, PNG, pngs, plan, size, round, mode, posterPng = null }) {
  const [W, H] = size;
  const get = (f) => (typeof pngs === 'function' ? pngs(f) : pngs.get(f));
  const decoded = new Map();
  const rgba = (f) => { if (!decoded.has(f)) decoded.set(f, PNG.sync.read(get(f)).data); return decoded.get(f); };
  rmSync(join(out, 'stills'), { recursive: true, force: true });
  mkdirSync(join(out, 'stills'), { recursive: true });
  mkdirSync(join(out, 'sheet'), { recursive: true });
  const files = [];
  const put = (rel, bytes, entry) => { writeFileSync(join(out, rel), bytes); files.push({ file: rel, sha256: sha(bytes), ...entry }); };
  for (const m of plan.mids) put(`stills/beat-${pad(m.index + 1)}-f${m.frame}.png`, get(m.frame), { kind: 'beat-mid', beat: m.index, frame: m.frame });
  for (const c of plan.cuts) put(`stills/strip-${pad(c.index)}-f${c.frame}.png`, strip(PNG, c.frames.map(rgba), W, H), { kind: 'strip', cut: c.index, frames: c.frames });
  if (posterPng) put('stills/poster.png', posterPng, { kind: 'poster', frame: plan.poster });
  else put(`stills/poster-f${plan.poster}.png`, get(plan.poster), { kind: 'poster', frame: plan.poster });
  const sheetFile = join(out, 'sheet', 'contact.png');
  contactSheet(PNG, plan.contact.map((f) => ({ data: rgba(f), width: W, height: H, frame: f })), sheetFile);
  const sheetBytes = readFileSync(sheetFile);
  files.push({ file: 'sheet/contact.png', sha256: sha(sheetBytes), kind: 'contact', frames: plan.contact });
  const set = { schema: 'lithermes.stills/v1', round, mode, size, files, required: files.map((f) => f.file), manifestSha256: null };
  writeJson(join(out, 'stills', 'stills.json'), set);
  return { file: 'stills/stills.json', files, set };
}

// Once manifest.json exists, the stills set records its hash; `look` checks it.
export function stampStills(out) {
  const file = join(out, 'stills', 'stills.json');
  const set = JSON.parse(readFileSync(file, 'utf8'));
  set.manifestSha256 = sha(readFileSync(join(out, 'manifest.json')));
  writeJson(file, set);
}
