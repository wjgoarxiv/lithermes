// Cover mode: a silent, seamless README cover loop (references/cover.md). One round runs, in this
// order: the cover treatment (exit 16), the page's static scan (17, 19), the asset list (22 for a
// missing asset, before any capture), the encoder probe (21) and the pre-warmed driver (14, 15);
// then the master Chrome seeks t = i / N for every frame at device scale 2 and a worker pool
// brings each capture down to the cover size; the same browser draws the title mask of every
// frame; a fresh Chrome repeats every frame (G0); another fresh Chrome draws 16 frames in a seeded
// shuffled order, which must match the master (a page that keeps state between frames fails here,
// exit 18); the flash audit runs on the frames as a loop; img2webp encodes (frame 0 and the frames
// before the seam at a higher quality; gifski is the fallback, never an MP4); the gate measures
// the DECODED file; the decoded stills, the seam pair and the sheet are written, then the
// manifest, the report and run-state.json. A flash-audit FAIL withholds the cover. `--window`
// renders and sheets only the frames around a logged defect and never counts as done.
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COVER, EXIT, FLASH } from './constants.mjs';
import { FlashDetector, flashesFromRecords } from './flash.mjs';
import { artCheck, checkAssets } from './cover-assets.mjs';
import { capturePass, CoverPool, frameName, openCover } from './cover-capture.mjs';
import { coverGate, coverVerdict, finishGate, formatCoverReport, framesIn, readPng } from './cover-gate.mjs';
import { lumaGrid } from './cover-image.mjs';
import { encodePng } from './cover-png.mjs';
import { writeCoverSheet } from './cover-sheet.mjs';
import { loadCoverTreatment, validateCoverTreatment } from './cover-treatment.mjs';
import { which } from './cover-webp.mjs';
import { recordFirstTreatment, writeJson, writeRunState } from './director.mjs';
import { fontRoutes, scanStage } from './stage.mjs';
import { stampStills } from './stills.mjs';
import { findCache, fontState, runtimeRequire, WARM } from '../bin/runtime.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sha = (data) => createHash('sha256').update(data).digest('hex');
const fail = (code, message) => Object.assign(new Error(message), { exitCode: code });

export const COVER_DIR = 'cover';
export const SHEET_TILES = 12;
export const frameMs = (fps) => Math.round(1000 / fps);
export const loopTimes = (frames) => Array.from({ length: frames }, (_, i) => [i, i / frames]);

// img2webp: lossy, loop forever, every frame -d round(1000 / fps) ms, frame 0 and the last
// edgeFrames frames at edgeQ (the seam's two sides carry the least requantisation error).
export function img2webpArgs({ files, fps, encode, output }) {
  const args = ['-loop', '0', '-lossy', '-q', String(encode.q), '-m', String(encode.method)];
  files.forEach((file, i) => args.push('-d', String(frameMs(fps)), '-q', String(i === 0 || i >= files.length - encode.edgeFrames ? encode.edgeQ : encode.q), file));
  return [...args, '-o', output];
}

export function coverEncoder(env = process.env) {
  const img2webp = which('img2webp', env), dwebp = which('dwebp', env);
  if (img2webp && dwebp) return { kind: 'img2webp', bin: img2webp };
  const gifski = which('gifski', env);
  return gifski ? { kind: 'gifski', bin: gifski } : null;
}

function encodeCover({ files, fps, encode, workDir, env }) {
  const encoder = coverEncoder(env);
  if (!encoder) throw fail(EXIT.BLOCKED_NO_COVER_ENCODER, 'BLOCKED_NO_COVER_ENCODER: install libwebp (img2webp and dwebp) or gifski; a cover is never an MP4');
  const output = join(workDir, encoder.kind === 'img2webp' ? 'cover.webp' : 'cover.gif');
  const args = encoder.kind === 'img2webp' ? img2webpArgs({ files, fps, encode, output }) : ['--fps', String(fps), '--quality', '90', '--repeat', '0', '-o', output, ...files];
  const run = spawnSync(encoder.bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.status !== 0) throw fail(1, `${encoder.kind} failed: ${(run.stderr || run.error?.message || '').trim().split(/\r?\n/).at(-1)}`);
  return { file: output, encoder: encoder.kind };
}

// mulberry32-seeded Fisher-Yates over the frame indices; the first `count` are re-drawn.
export function seekOrder(frames, seed, count = COVER.seekSamples) {
  let s = seed >>> 0;
  const next = () => { s = (s + 0x6d2b79f5) >>> 0; let z = Math.imul(s ^ (s >>> 15), s | 1); z ^= z + Math.imul(z ^ (z >>> 7), z | 61); return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
  const all = Array.from({ length: frames }, (_, i) => i);
  for (let i = frames - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  return all.slice(0, Math.min(count, frames));
}

export function maxLevelDiff(fileA, fileB) {
  const a = readPng(fileA), b = readPng(fileB);
  if (a.width !== b.width || a.height !== b.height) return 255;
  let max = 0;
  for (let i = 0; i < a.rgba.length; i++) { const d = Math.abs(a.rgba[i] - b.rgba[i]); if (d > max) max = d; }
  return max;
}

// WCAG 2.3.1 on the frames as a loop: the last two frames prime the detector, so frame 0 is judged
// against the frame the reader saw just before it.
function flashAudit(files, fps) {
  const first = readPng(files[0]);
  const detector = new FlashDetector(first.width, first.height);
  const order = [files.length - 2, files.length - 1, ...files.keys()].filter((i) => i >= 0);
  const records = [];
  order.forEach((i, k) => {
    const r = detector.push(i === 0 ? first.rgba : readPng(files[i]).rgba);
    if (k >= order.length - files.length) records.push({ frame: i, ...r });
  });
  const counted = flashesFromRecords(records, fps, { loop: true });
  return { pass: counted.general <= FLASH.maxFlashes && counted.red <= FLASH.maxRedFlashes, general: counted.general, red: counted.red, worstAtSec: counted.worstGeneral?.startSec ?? 0 };
}

// Everything checked before the first capture.
function prepare(out, env) {
  const plan = loadCoverTreatment(out);
  recordFirstTreatment(out, plan.treatment);
  const coverDir = join(out, COVER_DIR);
  if (!existsSync(join(coverDir, 'index.html'))) throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: no ${COVER_DIR}/index.html in ${out}; write the cover page first (references/cover.md)`);
  const scan = scanStage(coverDir);
  if (scan.contract.length) throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: ${scan.contract.join('; ')}`);
  if (scan.network.length) throw fail(EXIT.STAGE_NETWORK_REQUEST, `STAGE_NETWORK_REQUEST: ${scan.network.join('; ')}; a cover is served offline`);
  const assets = checkAssets({ out, recipe: plan.treatment.recipe, rasters: scan.rasters.paths, coverDir: COVER_DIR });
  if (!coverEncoder(env)) throw fail(EXIT.BLOCKED_NO_COVER_ENCODER, 'BLOCKED_NO_COVER_ENCODER: install libwebp (img2webp and dwebp) or gifski; a cover is never an MP4');
  const runtime = runtimeRequire(env);
  const fonts = fontState(env);
  if (!fonts.ok) throw fail(EXIT.BLOCKED_FONT_FETCH, `BLOCKED_FONT_FETCH: ${[...fonts.missing.map((f) => `missing ${f}`), ...fonts.mismatched.map((f) => `sha256 mismatch ${f}`)].join('; ')}; run \`${WARM}\` outside this session`);
  return { ...plan, coverDir, scan, assets, runtime, fonts: fontRoutes(findCache(env)) };
}

const open = (p, tag, runDir, env) => openCover({ runtime: p.runtime, coverDir: p.coverDir, fonts: p.fonts, width: p.page[0], height: p.page[1], scale: COVER.captureScale, profileRoot: join(runDir, `chrome-${tag}-${process.pid % 100000}`), env });

// The decoded frame on screen at `ms`.
export function frameAt(durations, ms) {
  let end = 0;
  for (let i = 0; i < durations.length; i++) { end += durations[i]; if (ms < end) return i; }
  return durations.length - 1;
}

// stills/: twelve decoded frames at t = k/12, the poster (decoded frame 0), the seam pair (last
// decoded frame beside frame 0) and the sheet, listed in stills/stills.json like the film set.
function writeCoverStills({ out, round, gate }) {
  const dir = join(out, 'stills');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const { width: W, height: H, durations, kept } = gate;
  const total = durations.reduce((a, b) => a + b, 0);
  const files = [], tiles = [];
  const put = (name, bytes, extra) => { writeFileSync(join(dir, name), bytes); files.push({ file: `stills/${name}`, sha256: sha(bytes), ...extra }); };
  for (let k = 0; k < SHEET_TILES; k++) {
    const index = frameAt(durations, (k / SHEET_TILES) * total);
    put(`frame-${String(k).padStart(2, '0')}.png`, encodePng(kept.get(index), W, H), { kind: 'frame', t: Number(((k / SHEET_TILES) * total / 1000).toFixed(3)), decodedFrame: index });
    tiles.push({ rgba: kept.get(index), width: W, height: H, t: (k / SHEET_TILES) * total / 1000 });
  }
  put('poster.png', encodePng(kept.get(0), W, H, { level: 9 }), { kind: 'poster', decodedFrame: 0 });
  const last = durations.length - 1, pair = Buffer.alloc(2 * W * H * 4);
  for (let y = 0; y < H; y++) {
    kept.get(last).copy(pair, y * 2 * W * 4, y * W * 4, (y + 1) * W * 4);
    kept.get(0).copy(pair, (y * 2 * W + W) * 4, y * W * 4, (y + 1) * W * 4);
  }
  put('seam.png', encodePng(pair, 2 * W, H), { kind: 'seam', decodedFrames: [last, 0] });
  writeCoverSheet({ file: join(dir, 'sheet.png'), tiles, diffs: gate.diffs, medianD: gate.medianD, durationSec: gate.durationSec });
  const sheet = readFileSync(join(dir, 'sheet.png'));
  files.push({ file: 'stills/sheet.png', sha256: sha(sheet), kind: 'sheet' });
  const set = { schema: 'lithermes.stills/v1', round, mode: 'cover', size: [W, H], durationSec: total / 1000, files, required: files.filter((f) => ['sheet', 'poster', 'seam'].includes(f.kind)).map((f) => f.file), manifestSha256: null };
  writeJson(join(dir, 'stills.json'), set);
  return set;
}

export async function renderCover({ out, round = 1, env = process.env, log = (line) => process.stderr.write(`${line}\n`) }) {
  const p = prepare(out, env);
  const runDir = join(out, '.run', 'cover');
  rmSync(runDir, { recursive: true, force: true });
  const dirs = Object.fromEntries(['frames', 'masks', 'frames2', 'seek'].map((k) => [k, join(runDir, k)]));
  const times = loopTimes(p.frames), order = seekOrder(p.frames, p.seed);
  const pool = new CoverPool();
  const pass = (browser, list, dir, prefix, mask = false) => capturePass({ browser, pool, times: list, dir, prefix, mask, size: p.size, page: p.page, scale: COVER.captureScale });
  const started = Date.now();
  let master, replay, sought;
  try {
    let b = await open(p, 'master', runDir, env);
    try { master = await pass(b, times, dirs.frames, 'f'); await pass(b, times, dirs.masks, 'm', true); } finally { await b.close(); }
    log(`cover: master and mask passes done (${p.frames} frames)`);
    b = await open(p, 'replay', runDir, env);
    try { replay = await pass(b, times, dirs.frames2, 'f'); } finally { await b.close(); }
    b = await open(p, 'seek', runDir, env);
    try { sought = await pass(b, order.map((i) => times[i]), dirs.seek, 's'); } finally { await b.close(); }
  } finally { await pool.close(); }
  const captureSec = (Date.now() - started) / 1000;
  const ms = frameMs(p.treatment.fps);
  const differing = times.filter(([i]) => master.get(i) !== replay.get(i));
  if (differing.length) throw fail(EXIT.STAGE_NONDETERMINISTIC, `STAGE_NONDETERMINISTIC: a fresh capture differs at ${differing.slice(0, 4).map(([i, t]) => `frame ${i} (t = ${t.toFixed(4)})`).join(', ')}${differing.length > 4 ? ` (+${differing.length - 4})` : ''}; draw every pixel from t and LitLoop.rng(seed)`);
  // A sought frame within one level per channel is the rasterizer's rounding when opacity and a
  // transform change together; state kept between frames differs by far more.
  let oneLevel = 0;
  for (const [k, i] of order.entries()) {
    if (sought.get(i) === master.get(i)) continue;
    const levels = maxLevelDiff(join(dirs.frames, frameName('f', i)), join(dirs.seek, frameName('s', i)));
    if (levels <= COVER.seekLevels) { oneLevel++; continue; }
    throw fail(EXIT.STAGE_NONDETERMINISTIC, `STAGE_NONDETERMINISTIC: frame ${i} (t = ${((i * ms) / 1000).toFixed(3)} s) differs by up to ${levels} levels when sought out of order (a fresh page drew it ${k ? `after frame ${order[k - 1]}` : 'first'}); the page keeps state between frames: clear every canvas and draw each frame from t alone`);
  }
  const files = framesIn(dirs.frames, 'f');
  const flash = flashAudit(files, p.treatment.fps);
  const encoded = encodeCover({ files, fps: p.treatment.fps, encode: p.encode, workDir: runDir, env });
  const planned = p.frames * ms;
  const wanted = Array.from({ length: SHEET_TILES }, (_, k) => (k / SHEET_TILES) * planned);
  let clock = 0;
  const keep = (i, dur) => { const start = clock; clock += dur; return i === 0 || start + dur >= planned - 1e-6 || wanted.some((x) => x >= start && x < start + dur); };
  const paintedTitle = p.treatment.title.kind === 'painted' ? p.assets.find((a) => a.role === 'base-art' && a.title) : null;
  const measured = coverGate(encoded.file, { frames: dirs.frames, frames2: dirs.frames2, masks: dirs.masks, title: p.treatment.title.box, glyph: { exempt: paintedTitle ? `painted into the declared base art ${paintedTitle.path}` : null }, fps: p.treatment.fps, keep, env });
  const gates = { ...measured.gates, SEEK: { pass: true, sampled: order.length, identical: order.length - oneLevel, oneLevel } };
  for (const a of p.assets.filter((x) => x.role === 'base-art')) {
    let art = null;
    try { art = readPng(join(out, a.path)); } catch { art = null; }
    const check = art && artCheck({ frame0: measured.kept.get(0), width: measured.width, height: measured.height, art, box: a.box, checkBox: a.checkBox });
    gates.ART = check ? { pass: check.pass, ssim: check.ssim, checked: check.checked.join(',') } : { pass: false, reason: `${a.path} is not a PNG this gate can read; list a PNG base art` };
  }
  gates.FLASH = { pass: flash.pass, generalFlashes: flash.general, redFlashes: flash.red, worstAtSec: flash.worstAtSec };
  const gate = finishGate({ input: encoded.file, src: measured.src, m: measured.m, gates });
  const stills = writeCoverStills({ out, round, gate });
  const name = basename(encoded.file);
  for (const stale of ['cover.webp', 'cover.gif', 'poster.png']) rmSync(join(out, stale), { force: true });
  const destination = flash.pass ? out : join(out, 'withheld');
  mkdirSync(destination, { recursive: true });
  renameSync(encoded.file, join(destination, name));
  if (flash.pass) {
    writeFileSync(join(out, 'poster.png'), readFileSync(join(out, 'stills', 'poster.png')));
    rmSync(join(out, 'withheld'), { recursive: true, force: true });
  }
  const verdict = coverVerdict(gate);
  const missed = Object.entries(gate.gates).filter(([, g]) => g.pass === false || g.target === false).map(([id]) => id);
  const report = `${formatCoverReport(gate, { strict: true })}${flash.pass ? '' : `  WITHHELD: the flash audit failed; ${name} sits in withheld/ and is not a deliverable\n`}`;
  writeFileSync(join(out, 'gate-report.txt'), report);
  const manifest = {
    schemaVersion: 1, path: 'cover', mode: 'cover', round, recipe: p.treatment.recipe,
    treatment: { file: p.file, sha256: sha(readFileSync(p.file)) }, page: p.page, size: p.size, scale: COVER.captureScale,
    fps: p.treatment.fps, frames: p.frames, frameMs: ms, encoder: encoded.encoder, encode: p.encode, file: flash.pass ? name : `withheld/${name}`,
    bytes: gate.bytes, captureSec, stills: stills.files.length, assets: p.assets.map(({ path, role, source }) => ({ path, role, source })),
    gate: { verdict, medianD: gate.medianD, movingFrac: gate.movingFrac, longestStillSec: gate.longestStillSec, spike: gate.spike, seamLocal: gate.seamLocal, missed },
    generatedAt: new Date().toISOString(),
  };
  writeJson(join(out, 'manifest.json'), manifest);
  stampStills(out);
  const code = verdict === 'PASS+TARGET' && flash.pass ? EXIT.OK : EXIT.GATE_FAIL_QA;
  writeRunState(out, { exitCode: code, mode: 'cover', round, finished: true, failed: missed, withheld: !flash.pass, path: 'cover' });
  const summary = `cover: ${manifest.file} ${gate.bytes} bytes, ${p.frames} frames at ${p.treatment.fps} fps, ${p.size.join('x')} (captured ${p.page[0] * COVER.captureScale}x${p.page[1] * COVER.captureScale}) in ${captureSec.toFixed(0)} s; stills and sheet in ${join(out, 'stills')}`;
  return { code, verdict, report, summary, missed, withheld: !flash.pass };
}

// The master pass alone, encoded and gated on the decoded file (G1-G4): how the shipped negatives
// and the recipe rows are re-checked without a whole round. treatment is a cover treatment object.
export async function renderQuick({ coverDir, treatment, workDir, env = process.env }) {
  const valid = validateCoverTreatment(treatment);
  if (!valid.ok) throw fail(EXIT.BLOCKED_TREATMENT_INVALID, `BLOCKED_TREATMENT_INVALID: field ${valid.field}: ${valid.message}`);
  const p = { ...valid.plan, treatment, coverDir, runtime: runtimeRequire(env), fonts: fontRoutes(findCache(env)) };
  const dir = join(workDir, 'frames');
  rmSync(dir, { recursive: true, force: true });
  const pool = new CoverPool();
  const browser = await open(p, 'quick', workDir, env);
  try {
    await capturePass({ browser, pool, times: loopTimes(p.frames), dir, prefix: 'f', size: p.size, page: p.page, scale: COVER.captureScale });
  } finally { await browser.close(); await pool.close(); }
  const encoded = encodeCover({ files: framesIn(dir, 'f'), fps: treatment.fps, encode: p.encode, workDir, env });
  return coverGate(encoded.file, { env });
}

// --window t0,t1 (seconds into the loop): capture only the frames from t0 - 0.5 s to t1 + 0.5 s,
// wrapping at the seam, in a fresh page, and sheet them with the span shaded. It writes only under
// windows/round-N/; the stills, the cover file, the report and the manifest stay as they were.
export async function renderCoverWindow({ out, round = 1, span: [t0, t1], env = process.env }) {
  const p = prepare(out, env);
  const ms = frameMs(p.treatment.fps), loop = (p.frames * ms) / 1000;
  if (!(Number.isFinite(t0) && Number.isFinite(t1) && t0 >= 0 && t1 >= t0 && t1 <= loop)) throw fail(2, `--window takes t0,t1 in seconds with 0 <= t0 <= t1 <= ${loop.toFixed(3)}`);
  const lo = t0 - COVER.windowPadSec, hi = t1 + COVER.windowPadSec, picks = [];
  for (let i = 0; i < p.frames; i++) for (const lap of [-1, 0, 1]) {
    const t = (i * ms) / 1000 + lap * loop;
    if (t >= lo - 1e-9 && t <= hi + 1e-9) picks.push({ index: i, t: Number(t.toFixed(3)) });
  }
  picks.sort((a, b) => a.t - b.t);
  const dir = join(out, 'windows', `round-${round}`, `${t0.toFixed(3)}-${t1.toFixed(3)}`);
  rmSync(dir, { recursive: true, force: true });
  const pool = new CoverPool();
  const browser = await open(p, 'window', join(out, '.run', 'cover-window'), env);
  try {
    await capturePass({ browser, pool, times: [...new Set(picks.map((x) => x.index))].map((i) => [i, i / p.frames]), dir, prefix: 'f', size: p.size, page: p.page, scale: COVER.captureScale });
  } finally { await browser.close(); await pool.close(); }
  const images = picks.map((x) => readPng(join(dir, frameName('f', x.index))));
  const lumas = images.map((img) => lumaGrid(img.rgba, img.width, img.height).luma);
  const diffs = lumas.slice(1).map((l, k) => { let s = 0; for (let i = 0; i < l.length; i++) s += Math.abs(l[i] - lumas[k][i]); return s / l.length / 255; });
  const ordered = [...diffs].sort((a, b) => a - b);
  const count = Math.min(SHEET_TILES, picks.length);
  const tiles = Array.from({ length: count }, (_, k) => Math.round((k * (picks.length - 1)) / Math.max(1, count - 1)))
    .map((j) => ({ rgba: images[j].rgba, width: images[j].width, height: images[j].height, t: picks[j].t }));
  writeCoverSheet({ file: join(dir, 'sheet.png'), tiles, diffs: diffs.length ? diffs : [0], medianD: ordered[ordered.length >> 1] ?? 0, durationSec: hi - lo, marks: [{ t0: t0 - lo, t1: t1 - lo }] });
  writeJson(join(dir, 'window.json'), { schema: 'lithermes.cover-window/v1', round, t0, t1, padSec: COVER.windowPadSec, frames: picks, note: 'frames before encoding; a window render never counts as done' });
  return { code: EXIT.OK, summary: `WINDOW round ${round}: ${picks.length} frames from ${lo.toFixed(3)} to ${hi.toFixed(3)} s; sheet ${join(dir, 'sheet.png')}\na window render never counts as done: fix the cause, then render the full cover` };
}

export async function coverCommand(flags) {
  const out = resolve(flags.out || 'motion-output');
  const round = Number(flags.round || 1);
  if (flags.detach) return detach(out, round);
  try {
    if (![1, 2, 3].includes(round)) throw fail(2, '--round must be 1, 2 or 3');
    if (flags.window) {
      const span = String(flags.window).split(',').map(Number);
      if (span.length !== 2) throw fail(2, '--window takes t0,t1 in seconds');
      const r = await renderCoverWindow({ out, round, span });
      console.log(r.summary);
      return r.code;
    }
    writeRunState(out, { exitCode: null, mode: 'cover', round, finished: false, path: 'cover' });
    const r = await renderCover({ out, round });
    console.log(`${r.report}${r.summary}`);
    if (r.code === EXIT.OK) console.log('View stills/sheet.png, stills/poster.png and stills/seam.png with vision_analyze, then record the round with `look`.');
    else console.log(`GATE_FAIL_QA: ${r.missed.join(', ')} ${r.verdict === 'FAIL' ? 'fail' : 'miss the cover TARGET'}${r.withheld ? ' (flash audit failed: the cover is withheld)' : ''}; ${round >= 3 ? 'round 3 of 3: deliver with the open items stated plainly' : `fix the cause and render --round ${round + 1}`}`);
    return r.code;
  } catch (error) {
    const code = error.exitCode ?? 1;
    console.error(error.exitCode ? error.message : `motion internal error: ${error.stack || error.message}`);
    if (!flags.window && existsSync(out)) writeRunState(out, { exitCode: code, mode: 'cover', round, finished: true, failed: [], path: 'cover', message: String(error.message).split('\n')[0] });
    return code;
  }
}

// `cover-gate FILE`: the same gate on any cover file or PNG frame folder.
export function coverGateCommand(flags) {
  const target = flags._[1];
  if (!target) { console.error('cover-gate needs a cover file (cover.webp, cover.gif) or a PNG frame folder'); return 2; }
  try {
    const r = coverGate(resolve(target), {
      frames: flags.frames ? resolve(flags.frames) : null, frames2: flags.frames2 ? resolve(flags.frames2) : null, masks: flags.masks ? resolve(flags.masks) : null,
      title: flags.title ? String(flags.title).split(',').map(Number) : null, fps: Number(flags.fps || 16),
    });
    if (flags.json) { const { kept, src, m, diffs, durations, ...row } = r; console.log(JSON.stringify(row, null, 1)); }
    else console.log(formatCoverReport(r, { strict: Boolean(flags.strict) }).trimEnd());
    return r.pass && (!flags.strict || r.target) ? EXIT.OK : EXIT.GATE_FAIL_QA;
  } catch (error) {
    console.error(`cover-gate: ${error.message}`);
    return 1;
  }
}

// --detach: the same render in a detached child that leaves run-state.json; the caller polls it.
function detach(out, round) {
  mkdirSync(join(out, '.run'), { recursive: true });
  const log = join(out, '.run', 'cover.log');
  const fd = openSync(log, 'w');
  const child = spawn(process.execPath, [join(here, '..', 'bin', 'motion.mjs'), 'cover', '--out', out, '--round', String(round)], { detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  console.log(`cover render detached (pid ${child.pid}); poll ${join(out, 'run-state.json')} (finished: true); log ${log}`);
  return 0;
}
