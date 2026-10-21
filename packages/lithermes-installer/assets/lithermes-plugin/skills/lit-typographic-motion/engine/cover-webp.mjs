// Decode an animated WebP as a browser would show it, with no npm dependency: the RIFF container is
// read here (canvas size, loop count, each ANMF frame's rectangle, duration, blend and dispose
// bits), each frame's own bitstream is rewrapped as a still and handed to the host's dwebp (it
// ships with img2webp in libwebp), and the stills are composited the way libwebp's animation
// decoder does. The cover gate reads the encoded file through this module: a lossy animation
// encoder skips small changes, and only the decoded file shows what it skipped.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { whichSync } from './hostexec.mjs';

// A PATH walk with PATHEXT on Windows; `where` prints CRLF lines and extensionless shims.
export function which(name, env = process.env, probes = {}) {
  return whichSync(name, { env, ...probes });
}

const u24 = (b, at) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);

export function parseWebp(bytes) {
  if (bytes.length < 16 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') throw new Error('not a WebP file');
  const info = { width: 0, height: 0, loop: null, animated: false, frames: [] };
  const end = Math.min(bytes.length, 8 + bytes.readUInt32LE(4));
  for (let at = 12; at + 8 <= end;) {
    const kind = bytes.toString('latin1', at, at + 4), size = bytes.readUInt32LE(at + 4), body = bytes.subarray(at + 8, at + 8 + size);
    if (kind === 'VP8X') { info.animated = Boolean(body[0] & 2); info.width = 1 + u24(body, 4); info.height = 1 + u24(body, 7); }
    else if (kind === 'ANIM') info.loop = body.readUInt16LE(4);
    else if (kind === 'ANMF') {
      info.frames.push({ x: 2 * u24(body, 0), y: 2 * u24(body, 3), w: 1 + u24(body, 6), h: 1 + u24(body, 9), ms: u24(body, 12), blend: !(body[15] & 2), dispose: Boolean(body[15] & 1), data: body.subarray(16) });
    } else if ((kind === 'VP8 ' || kind === 'VP8L') && !info.frames.length) {
      info.frames.push({ x: 0, y: 0, w: 0, h: 0, ms: 0, blend: false, dispose: false, still: true, data: bytes.subarray(at, at + 8 + size + (size & 1)) });
    }
    at += 8 + size + (size & 1);
  }
  if (!info.animated && info.loop === null) info.loop = 0;
  return info;
}

// One ANMF payload (ALPH?, then VP8/VP8L) as a standalone WebP file.
function asStill(frame) {
  const alpha = frame.data.toString('latin1', 0, 4) === 'ALPH';
  const parts = [frame.data];
  if (alpha) {
    const vp8x = Buffer.alloc(18);
    vp8x.write('VP8X', 0, 'latin1'); vp8x.writeUInt32LE(10, 4); vp8x[8] = 0x10;
    vp8x.writeUIntLE(frame.w - 1, 12, 3); vp8x.writeUIntLE(frame.h - 1, 15, 3);
    parts.unshift(vp8x);
  }
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(4 + parts.reduce((n, p) => n + p.length, 0), 4); head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, ...parts]);
}

// dwebp -pam output: { width, height, rgba }.
export function readPam(buf) {
  const end = buf.indexOf('ENDHDR\n');
  if (buf.toString('latin1', 0, 2) !== 'P7' || end < 0) throw new Error('not a PAM image');
  const head = buf.toString('latin1', 0, end);
  const field = (name) => Number(new RegExp(`${name} (\\d+)`).exec(head)?.[1]);
  const width = field('WIDTH'), height = field('HEIGHT'), depth = field('DEPTH');
  const data = buf.subarray(end + 7);
  if (depth === 4) return { width, height, rgba: data };
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) rgba[i * 4 + c] = data[i * depth + c];
  return { width, height, rgba };
}

// Non-premultiplied alpha blend (as libwebp), or a straight replace when the frame does not blend.
function paint(canvas, W, frame, rgba) {
  for (let y = 0; y < frame.h; y++) {
    for (let x = 0; x < frame.w; x++) {
      const s = (y * frame.w + x) * 4, d = ((frame.y + y) * W + frame.x + x) * 4, sa = rgba[s + 3];
      if (!frame.blend || sa === 255) { canvas[d] = rgba[s]; canvas[d + 1] = rgba[s + 1]; canvas[d + 2] = rgba[s + 2]; canvas[d + 3] = sa; continue; }
      if (!sa) continue;
      const keep = (canvas[d + 3] * (255 - sa)) / 255, a = sa + keep;
      for (let c = 0; c < 3; c++) canvas[d + c] = Math.round((rgba[s + c] * sa + canvas[d + c] * keep) / a);
      canvas[d + 3] = Math.round(a);
    }
  }
}

// Decode every frame; onFrame(index, rgba, ms, width, height) sees the composited canvas, which is
// reused between calls (copy what you keep). Returns { width, height, loop, durations, bytes }.
export function decodeWebp(file, { env = process.env, onFrame = () => {} } = {}) {
  const dwebp = which('dwebp', env);
  if (!dwebp) throw new Error('dwebp not found (it ships with img2webp in libwebp)');
  const bytes = readFileSync(file);
  const info = parseWebp(bytes);
  if (!info.frames.length) throw new Error(`${file} holds no frames`);
  const work = mkdtempSync(join(tmpdir(), 'lithermes-webp-'));
  try {
    let W = info.width, H = info.height, canvas = null, previous = null;
    const durations = [];
    info.frames.forEach((frame, i) => {
      const src = join(work, 'f.webp'), pam = join(work, 'f.pam');
      writeFileSync(src, frame.still ? Buffer.concat([bytes.subarray(0, 12), frame.data]) : asStill(frame));
      const run = spawnSync(dwebp, [src, '-pam', '-quiet', '-o', pam], { encoding: 'utf8', env });
      if (run.status !== 0) throw new Error(`dwebp failed on frame ${i}: ${(run.stderr || run.error?.message || '').trim().split(/\r?\n/)[0]}`);
      const still = readPam(readFileSync(pam));
      if (frame.still) { W = still.width; H = still.height; frame.w = W; frame.h = H; }
      if (!canvas) canvas = Buffer.alloc(W * H * 4);
      if (previous?.dispose) for (let y = previous.y; y < previous.y + previous.h; y++) canvas.fill(0, (y * W + previous.x) * 4, (y * W + previous.x + previous.w) * 4);
      paint(canvas, W, frame, still.rgba);
      durations.push(frame.ms);
      onFrame(i, canvas, frame.ms, W, H);
      previous = frame;
    });
    return { width: W, height: H, loop: info.loop, durations, bytes: statSync(file).size };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
