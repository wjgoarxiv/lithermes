// The numeric QA gate (MO-C-01..14, 25..29, MO-D-02..04) plus every other
// HARD or CAP row the render log can prove (MO-A-*, MO-SH-*, MO-B-00,
// MO-FT-04/05/08). It reads the manifest, the per-frame render log, the flash
// records, ffprobe and file sizes, the contrast measurements, the determinism
// re-renders and the perf run. It never re-detects text or flashes from pixels
// of a decoded export.
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCENT, CONTRAST, EMPTY, EVENTS, FLASH, LOOK_PASSES, OUTPUT, OVERRIDES, PASS_CAPS, PERF, PROVISIONAL, READING, SAFE, TIMING, TYPE,
  chromeFlagLadder, isSoftwareRenderer,
} from './constants.mjs';
import { flashesFromRecords } from './flash.mjs';
import { pickPreset } from './presets.mjs';
import { eojeols, readingCounts, readingFloor } from './type.mjs';
import { hexToHsl, hueDistance, passSeed, srgbToLinear, contrastRatio } from './util.mjs';

const HANGUL_FONTS = new Set(['Pretendard-Regular.otf', 'Pretendard-Bold.otf', 'Galmuri9.ttf']);
const STROKE_FONTS = new Set(['EMSAllure.svg', 'EMSFelix.svg', 'EMSOsmotron.svg', 'EMSReadability.svg', 'EMSTech.svg']);
const EPS = 1e-6;

const pass = (detail = '') => ({ status: 'PASS', detail });
const fail = (detail) => ({ status: 'FAIL', detail });
const warn = (detail) => ({ status: 'WARN', detail });

function frameLines(records) {
  return records.filter((r) => r.pass === null || (r.pass === undefined && r.rgbaSha256)).sort((a, b) => a.frame - b.frame);
}

export function largeType(box) {
  return box.fontSizePx >= CONTRAST.largePx || (box.fontSizePx >= CONTRAST.largeBoldPx && (box.weight ?? 400) >= CONTRAST.largeBoldWeight);
}

// MO-C-06 measurement on one frame: foreground = median linear luminance under
// the glyph mask eroded by 1 px; background = 5th/95th percentiles inside the
// bbox grown by 0.25 cap height, outside the mask dilated by 2 px.
export function measureContrast(rgba, mask, width, height, box, scale = 1) {
  const L = (i) => 0.2126 * srgbToLinear(rgba[i * 4]) + 0.7152 * srgbToLinear(rgba[i * 4 + 1]) + 0.0722 * srgbToLinear(rgba[i * 4 + 2]);
  const on = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] >= 128;
  const [bx0, by0, bx1, by1] = box.bbox.map((v) => v * scale);
  const grow = CONTRAST.bboxExpandCap * box.capHeightPx * scale;
  const x0 = Math.max(0, Math.floor(bx0 - grow)), y0 = Math.max(0, Math.floor(by0 - grow));
  const x1 = Math.min(width - 1, Math.ceil(bx1 + grow)), y1 = Math.min(height - 1, Math.ceil(by1 + grow));
  const fg = [], bg = [];
  const e = CONTRAST.maskErodePx * scale, d = CONTRAST.maskDilatePx * scale;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const inside = x >= bx0 && x <= bx1 && y >= by0 && y <= by1;
    if (inside && on(x, y)) {
      let eroded = true;
      for (let dy = -e; dy <= e && eroded; dy++) for (let dx = -e; dx <= e; dx++) if (!on(x + dx, y + dy)) { eroded = false; break; }
      if (eroded) fg.push(L(y * width + x));
      continue;
    }
    let near = false;
    for (let dy = -d; dy <= d && !near; dy++) for (let dx = -d; dx <= d; dx++) if (on(x + dx, y + dy)) { near = true; break; }
    if (!near) bg.push(L(y * width + x));
  }
  if (fg.length < 8 || bg.length < 8) return null;
  fg.sort((a, b) => a - b); bg.sort((a, b) => a - b);
  const pct = (list, q) => list[Math.min(list.length - 1, Math.max(0, Math.round(q * (list.length - 1))))];
  const flat = box.fill !== 'gradient' && box.fill !== 'mixed';
  const fgValues = flat ? [pct(fg, 0.5)] : [pct(fg, 0.05), pct(fg, 0.95)];
  const bgValues = [pct(bg, 0.05), pct(bg, 0.95)];
  let worst = Infinity;
  for (const a of fgValues) for (const b of bgValues) worst = Math.min(worst, contrastRatio(a, b));
  return { ratio: Math.round(worst * 100) / 100, floor: largeType(box) ? CONTRAST.large : CONTRAST.body, fg: fg.length, bg: bg.length };
}

function coverage(manifest, records) {
  const total = Math.round(manifest.durationSec * manifest.fps);
  const drew = new Map();
  for (const r of records) if (r.pass && LOOK_PASSES.includes(r.pass) && r.draws >= 1) drew.set(`${r.frame}:${r.pass}`, true);
  const ranges = (manifest.passRanges || []).filter((r) => LOOK_PASSES.includes(r.pass));
  if (!ranges.length) return fail('manifest lists no look-library pass');
  for (let f = 0; f < total; f++) {
    if (!ranges.some((r) => f >= r.frameStart && f <= r.frameEnd && drew.get(`${f}:${r.pass}`))) return fail(`frame ${f} has no look pass that issued a draw`);
  }
  return pass(`${total} frames covered`);
}

function clusters(frames) {
  const found = [];
  for (const row of frames) for (const fill of row.fills || []) {
    if (!/^#[0-9a-f]{6}$/i.test(fill.hex) || fill.w < ACCENT.minFillPx || fill.h < ACCENT.minFillPx) continue;
    const { h, s } = hexToHsl(fill.hex);
    if (s < ACCENT.saturationFloor) continue;
    let c = found.find((k) => hueDistance(k.hue, h) <= ACCENT.hueTolerance);
    if (!c) { c = { hue: h, hex: fill.hex, frames: new Set(), shots: new Set() }; found.push(c); }
    c.frames.add(row.frame);
    c.shots.add(`${row.sceneId}#${row.shotIndex}`);
  }
  return found.sort((a, b) => b.frames.size - a.frames.size);
}

export function runGate({ manifest, records, preview = [], exports = {}, contrast = [], preflight = {}, notice = null }) {
  const rules = [];
  const add = (id, result) => rules.push({ id, ...result, provisional: PROVISIONAL.has(id) || id === 'MO-C-07/08' });
  const fps = manifest.fps;
  const frames = frameLines(records);
  const total = Math.round(manifest.durationSec * fps);
  const lx = manifest.lithermes || {};
  const beat = 60 / (manifest.bpm || TIMING.defaultBpm);
  const shots = (manifest.timeline || []).filter((u) => u.kind === 'line' || u.kind === 'scene');

  // MO-C-01
  add('MO-C-01', coverage(manifest, records));
  // MO-C-02
  const software = isSoftwareRenderer(manifest.renderer);
  if (!manifest.renderer) add('MO-C-02', fail('no WebGL2 renderer recorded'));
  else if (software && !(manifest.softwareRenderer && manifest.samples === 1)) add('MO-C-02', fail(`software renderer "${manifest.renderer}" is not labelled with --samples lowered`));
  else add('MO-C-02', pass(`${software ? 'software (labelled, --samples 1)' : 'hardware'} — ${manifest.renderer}`));
  // MO-C-03 (master non-looping + exact preview frames looping)
  const master = flashesFromRecords(frames.map((r) => ({ frame: r.frame, ...(r.flash || {}) })), fps);
  const prev = preview.length ? flashesFromRecords(preview, lx.previewFps || 30, { loop: true }) : { general: 0, red: 0 };
  const flashFail = master.general > FLASH.maxFlashes || master.red > FLASH.maxRedFlashes || prev.general > FLASH.maxFlashes || prev.red > FLASH.maxRedFlashes;
  const flashDetail = `worst window ${Math.max(master.general, prev.general)} general / ${Math.max(master.red, prev.red)} red (limit 3 / 3); master ${master.general}/${master.red}${master.general > 3 ? ` at ${master.worstGeneral.startSec}s [${master.worstGeneral.transitions.join(' ')}]` : ''}, preview ${prev.general}/${prev.red}${preview.length ? '' : ' (no preview frames audited)'}`;
  add('MO-C-03', flashFail ? fail(flashDetail) : preview.length || !exports.present?.preview ? pass(flashDetail) : fail(`${flashDetail}; the preview frames were never audited`));
  // MO-C-04 / MO-C-05
  const titleSafe = [], actionSafe = [];
  for (const row of frames) {
    for (const box of row.textBoxes || []) {
      const [x0, y0, x1, y1] = box.bbox;
      if (x0 < SAFE.titleX - EPS || y0 < SAFE.titleY - EPS || x1 > 1920 - SAFE.titleX + EPS || y1 > 1080 - SAFE.titleY + EPS) titleSafe.push(`${box.elementId}@${row.frame}`);
    }
    for (const g of row.graphics || []) {
      const [x0, y0, x1, y1] = g.bbox;
      if (x0 < SAFE.actionX - EPS || y0 < SAFE.actionY - EPS || x1 > 1920 - SAFE.actionX + EPS || y1 > 1080 - SAFE.actionY + EPS) actionSafe.push(`${g.id}@${row.frame}`);
    }
  }
  add('MO-C-04', titleSafe.length ? fail(`violations: ${[...new Set(titleSafe)].slice(0, 8).join(', ')}`) : pass('all glyph ink inside [96,54]-[1824,1026]'));
  add('MO-C-05', actionSafe.length ? fail(`violations: ${[...new Set(actionSafe)].slice(0, 8).join(', ')}`) : pass('all graphics inside [48,27]-[1872,1053]'));
  // MO-C-06
  if (!contrast.length) add('MO-C-06', fail('no contrast sample was measured'));
  else {
    const rows = contrast.map((c) => ({ ...c, floor: (c.fontSizePx ?? 0) >= CONTRAST.largePx || ((c.fontSizePx ?? 0) >= CONTRAST.largeBoldPx && (c.weight ?? 400) >= CONTRAST.largeBoldWeight) ? CONTRAST.large : CONTRAST.body }));
    const bad = rows.filter((c) => c.ratio < c.floor);
    const min = rows.reduce((m, c) => (c.ratio < m.ratio ? c : m), rows[0]);
    add('MO-C-06', bad.length ? fail(`min ratio ${bad[0].ratio}:1 at frame ${bad[0].frame} "${bad[0].elementId}" (floor ${bad[0].floor}:1)`) : pass(`min ratio ${min.ratio}:1 at frame ${min.frame} (floor ${min.floor}:1)`));
  }
  // MO-C-07 / MO-C-08
  let tightest = null;
  const readFails = { en: [], ko: [] };
  for (const unit of manifest.timeline || []) {
    const floor = readingFloor(unit.text, unit.kind);
    const slack = unit.holdSec - floor;
    if (!tightest || slack < tightest.slack) tightest = { unit, floor, slack };
    const hangul = readingCounts(unit.text).H > 0;
    if (unit.holdSec < floor - 1 / fps - EPS) (hangul ? readFails.ko : readFails.en).push(`"${unit.text}" (${unit.kind}) hold ${unit.holdSec}s < floor ${floor.toFixed(2)}s`);
    if ((unit.kind === 'line' || unit.kind === 'scene') && readingCounts(unit.text).C / unit.holdSec > READING.englishCps + EPS) readFails.en.push(`"${unit.text}" runs ${(readingCounts(unit.text).C / unit.holdSec).toFixed(1)} cps > 17`);
  }
  const tightText = tightest ? `tightest unit "${tightest.unit.text}" (${tightest.unit.kind}) hold ${tightest.unit.holdSec}s vs floor ${tightest.floor.toFixed(2)}s` : 'no timeline';
  if (readFails.en.length) add('MO-C-07', fail(readFails.en[0]));
  if (readFails.ko.length) add('MO-C-08', fail(readFails.ko[0]));
  add('MO-C-07/08', readFails.en.length || readFails.ko.length ? fail(tightText) : pass(tightText));
  // MO-C-09 and MO-A-25 (the child is a seeked render in a fresh process)
  const det = lx.determinism;
  if (!det?.checks?.length) add('MO-C-09', fail('no frame was re-rendered in an independent process'));
  else {
    const bad = det.checks.filter((c) => !c.match && !(c.software && c.software.first === c.software.second));
    const soft = det.checks.filter((c) => !c.match && c.software && c.software.first === c.software.second);
    const listed = det.checks.map((c) => c.frame).join(', ');
    if (bad.length) add('MO-C-09', fail(`rgbaSha256 mismatch at frame ${bad[0].frame}: ${bad[0].sequential} vs ${bad[0].seeked}`));
    else if (soft.length) add('MO-C-09', warn(`hardware-nondeterminism at frames ${soft.map((c) => c.frame).join(', ')}; SwiftShader re-check matched (frames re-rendered: ${listed})`));
    else add('MO-C-09', pass(`rgbaSha256 match Y (frames re-rendered: ${listed})`));
  }
  // MO-C-10/11/12 (+ MO-A-03 tags)
  const probe = exports.probe;
  if (!probe) add('MO-C-10/11/12', fail('no MP4 to probe'));
  else {
    const problems = [];
    if (probe.width < OUTPUT.minWidth || probe.height < OUTPUT.minHeight) problems.push(`resolution ${probe.width}x${probe.height}`);
    if (probe.fps < OUTPUT.minFps) problems.push(`fps ${probe.fps}`);
    if (probe.duration < OUTPUT.minDurationSec - 0.05) problems.push(`duration ${probe.duration}s`);
    if (probe.pix_fmt !== 'yuv420p' || probe.color_space !== 'bt709' || probe.color_range !== 'tv') problems.push(`tags ${probe.pix_fmt}/${probe.color_space}/${probe.color_range}`);
    const tagsOk = probe.pix_fmt === 'yuv420p' && probe.color_space === 'bt709' && probe.color_range === 'tv';
    const text = `${probe.duration.toFixed(2)} s @ ${probe.fps} fps, ${probe.width}x${probe.height}; ffprobe yuv420p/bt709/tv ${tagsOk ? 'Y' : 'N'}`;
    add('MO-C-10/11/12', problems.length ? fail(`${text}; ${problems.join('; ')}`) : probe.duration > OUTPUT.warnDurationSec ? warn(`${text}; longer than 90 s`) : pass(text));
  }
  // MO-C-13
  const sizes = exports.sizes || {};
  const sizeText = `mp4 ${sizes.film ?? 'n/a'}, preview ${sizes.preview ?? 'n/a'} (cap 3 MB), poster ${sizes.poster ?? 'n/a'} (cap 1 MB)`;
  const sizeProblems = [];
  if (sizes.preview == null || sizes.preview > OUTPUT.previewMaxBytes) sizeProblems.push('preview over 3 MB or missing');
  if (sizes.poster == null || sizes.poster > OUTPUT.posterMaxBytes) sizeProblems.push('poster over 1 MB or missing');
  const mp4Warn = sizes.film && manifest.durationSec && sizes.film / (manifest.durationSec / 10) > OUTPUT.mp4WarnBytesPer10s;
  add('MO-C-13', sizeProblems.length ? fail(`${sizeText}; ${sizeProblems.join('; ')}`) : mp4Warn ? warn(`${sizeText}; MP4 above 100 MB per 10 s`) : pass(sizeText));
  // MO-C-14
  const lastText = [...shots].reverse().find((s) => s.text);
  const refRow = lastText && [...frames].reverse().find((r) => r.frame <= Math.round(lastText.end * fps) - 1 && r.glyphInk > 0);
  const refInk = refRow?.glyphInk || 0;
  if (!exports.present?.reduced) add('MO-C-14', fail('reduced-motion still missing'));
  else if (lx.reducedInk == null) add('MO-C-14', fail('reduced-motion still ink was not measured'));
  else if (lx.reducedInk < OUTPUT.reducedInkFraction * refInk) add('MO-C-14', fail(`present Y, ink ${lx.reducedInk} < 0.9 x ${refInk} (frame ${refRow?.frame})`));
  else add('MO-C-14', pass(`present Y, ink ${lx.reducedInk} vs ${refInk} at frame ${refRow?.frame}`));
  // MO-C-25
  const trackBad = [];
  for (const row of frames) for (const box of row.textBoxes || []) {
    const t = box.trackingEm || 0;
    if (box.voice === 'display' && t < TYPE.displayTrackingMinEm - EPS) trackBad.push(`${box.elementId} ${t}em (display)`);
    if ((box.voice === 'machine' || box.voice === 'body' || box.voice === 'label') && t < TYPE.machineTrackingMinEm - EPS) trackBad.push(`${box.elementId} ${t}em (${box.voice})`);
  }
  add('MO-C-25', trackBad.length ? fail(trackBad[0]) : pass('display >= -0.04em, machine/body >= 0'));
  // MO-C-26
  const lhBad = [];
  for (const row of frames) {
    for (const box of row.textBoxes || []) {
      const n = (box.lines || []).length;
      if (n < 2) continue;
      const cjk = box.script !== 'latin';
      const floor = n >= 3 ? TYPE.lineHeightThreePlus : cjk ? TYPE.lineHeightCjk : TYPE.lineHeightLatin;
      if ((box.lineHeight ?? 0) < floor - EPS) lhBad.push(`${box.elementId} ${box.lineHeight} < ${floor}`);
    }
    if (row.block && row.block.lines >= 2) {
      const floor = row.block.lines >= 3 ? TYPE.lineHeightThreePlus : TYPE.lineHeightLatin;
      if (row.block.lineHeight < floor - EPS) lhBad.push(`${row.block.id} ${row.block.lineHeight} < ${floor}`);
    }
  }
  add('MO-C-26', lhBad.length ? fail(lhBad[0]) : pass('multi-line blocks meet 1.5 Latin / 1.6 CJK / 1.4 at 3+ lines'));
  // MO-C-27
  const measureBad = [], measureNote = [];
  for (const row of frames) for (const box of row.textBoxes || []) {
    if (!box.paragraph) continue;
    if (box.script === 'latin' && (box.measureCh < TYPE.paragraphChMin || box.measureCh > TYPE.paragraphChMax)) measureBad.push(`${box.elementId} ${box.measureCh}ch`);
    if (box.script !== 'latin' && (box.measureCh < TYPE.cjkChAdvisoryMin || box.measureCh > TYPE.cjkChAdvisoryMax)) measureNote.push(`${box.elementId} ${box.measureCh}ch (CJK advisory)`);
  }
  add('MO-C-27', measureBad.length ? fail(measureBad[0]) : pass(measureNote.length ? `advisory: ${measureNote[0]}` : 'no Latin paragraph card outside 60-75ch'));
  // MO-C-29
  const found = clusters(frames);
  const accent = found[1];
  const accentShots = accent ? accent.shots.size : 0;
  const accentShare = accent ? accent.frames.size / Math.max(1, frames.length) : 0;
  const clusterText = found.map((c) => `${c.hex}~${Math.round(c.hue)}° in ${c.frames.size} frames`).join(', ') || 'none';
  if (found.length > ACCENT.maxClusters) add('MO-C-29', fail(`${found.length} saturated clusters: ${clusterText}`));
  else if (accent && (accentShots > ACCENT.maxEntries || accentShare > ACCENT.maxFrameFraction + EPS)) add('MO-C-29', fail(`accent ${accent.hex} in ${accentShots} entries and ${(accentShare * 100).toFixed(1)}% of frames`));
  else add('MO-C-29', pass(`clusters: ${clusterText}`));
  // MO-D-02
  const perf = lx.perf;
  const ceiling = manifest.softwareRenderer ? PERF.softwareP95Ms : PERF.hardwareP95Ms;
  if (!perf || !(perf.frames >= PERF.frames)) add('MO-D-02', fail('perf mode did not measure 120 frames'));
  else add('MO-D-02', perf.p95Ms > ceiling ? fail(`p95 ${perf.p95Ms.toFixed(1)} ms > ${ceiling} ms; lower samples or tidal octaves`) : pass(`p95 ${perf.p95Ms.toFixed(1)} ms <= ${ceiling} ms over ${perf.frames} frames`));
  // MO-D-03
  const emptyBad = [];
  for (const shot of shots) {
    const a = Math.round(shot.start * fps), b = Math.round(shot.end * fps) - 1;
    let run = 0, startF = a;
    const check = (endF) => {
      const allowance = (startF === 0 ? EMPTY.fadeAllowanceSec : 0) + (endF >= total - 1 ? EMPTY.fadeAllowanceSec : 0);
      const cap = EMPTY.sceneHoldMultiplier * TIMING.minSceneBeats * beat + allowance;
      if (run / fps > cap + EPS) emptyBad.push(`${shot.id}: ${run} empty dark frames from ${startF}`);
    };
    for (let f = a; f <= b; f++) {
      const row = frames[f];
      const empty = row && row.glyphInk === 0 && row.lumP995 < EMPTY.p995Ceiling;
      if (empty) { if (!run) startF = f; run++; } else if (run) { check(f - 1); run = 0; }
    }
    if (run) check(b);
  }
  add('MO-D-03', emptyBad.length ? fail(emptyBad[0]) : pass('no empty dark run past 2x the scene hold floor'));
  // MO-D-04
  const missing = preflight.missingGlyphs || [];
  add('MO-D-04', missing.length ? fail(`missing ${missing.map((m) => `${JSON.stringify(m.ch)} in ${m.font}`).join(', ')}`) : pass('every codepoint resolves in its assigned font'));

  // ---- other enforced MO-A / MO-SH / MO-B / MO-FT rows, in rule-index order ----
  if (probe) add('MO-A-03', probe.codec_name === 'h264' && probe.color_primaries === 'bt709' && probe.color_transfer === 'bt709' && probe.color_space === 'bt709' && probe.color_range === 'tv'
    ? pass('h264, BT.709 matrix/primaries/transfer, tv range') : fail(`encode ${probe.codec_name} ${probe.color_space}/${probe.color_primaries}/${probe.color_transfer}/${probe.color_range}`));
  add('MO-A-04', software && manifest.samples !== 1 ? fail('software GL without --samples 1') : pass(software ? 'software GL reported, samples 1' : 'hardware renderer'));
  const splitBad = [];
  for (const unit of (manifest.timeline || []).filter((u) => u.kind === 'reveal' || u.kind === 'word')) {
    const parent = shots.find((s) => s.sceneId === unit.sceneId && s.shotIndex === unit.shotIndex);
    const words = eojeols(parent?.text || '');
    const part = eojeols(unit.text);
    const ok = words.some((_, i) => part.every((w, j) => words[i + j] === w)) || (parent?.text || '').split(/\s*(?:·|•|\||;|,|\/)\s*/u).includes(unit.text.trim());
    if (!ok) splitBad.push(`"${unit.text}" in "${parent?.text}"`);
  }
  add('MO-A-13', splitBad.length ? fail(`reveal splits a 어절: ${splitBad[0]}`) : pass('reveal steps keep whole 어절'));
  const offBeat = (manifest.timeline || []).filter((u) => Math.abs(u.start - u.beatSec) > TIMING.cutToleranceFrames / fps + EPS);
  add('MO-A-15', offBeat.length ? fail(`"${offBeat[0].id}" starts ${offBeat[0].start}s, beat ${offBeat[0].beatSec}s`) : pass('every start within 1 frame of its beat'));
  const shortShots = shots.filter((s) => s.holdSec < TIMING.minSceneBeats * beat - 1 / fps - EPS);
  add('MO-A-16', shortShots.length ? fail(`"${shortShots[0].id}" holds ${shortShots[0].holdSec}s < 2 beats`) : pass('every shot holds at least 2 beats'));
  if (det?.checks?.length) {
    const seekBad = det.checks.filter((c) => !c.match && !(c.software && c.software.first === c.software.second));
    add('MO-A-25', seekBad.length ? fail(`seeked frame ${seekBad[0].frame} differs from the sequential frame line`) : pass('seeked renders match sequential frame lines'));
  } else add('MO-A-25', fail('no seeked re-render'));
  const sampleBad = frames.filter((row) => {
    if (!row.sampleTimes) return false;
    const n = row.sampleTimes.length;
    if (n === 1 && manifest.samples === 1) return Math.abs(row.sampleTimes[0] - row.frame / fps) > 1e-5;
    return n !== manifest.samples || row.sampleTimes.some((t, i) => Math.abs(t - Math.max(0, row.frame / fps + (manifest.shutter / fps) * ((i + 0.5) / n - 0.5))) > 1e-5);
  });
  add('MO-A-28', sampleBad.length ? fail(`frame ${sampleBad[0].frame} sub-sample times off the pinned formula`) : pass('sub-sample times pinned'));
  const flashLogged = frames.every((row) => typeof row.overrides?.flash === 'number');
  add('MO-A-30', flashLogged ? pass('flash override logged per frame') : fail('a frame line lacks its flash override value'));
  const fakeHangul = [];
  for (const row of frames) for (const box of row.textBoxes || []) {
    for (const run of box.runs || []) if (run.script === 'hangul' && (!HANGUL_FONTS.has(run.fontFile) || run.widthStep)) fakeHangul.push(`${box.elementId}: ${run.fontFile} width ${run.widthStep}`);
    if ((box.script !== 'latin') && Math.abs((box.scaleX ?? 1) - (box.scaleY ?? 1)) > EPS) fakeHangul.push(`${box.elementId}: scaleX ${box.scaleX} != scaleY ${box.scaleY}`);
  }
  add('MO-A-33', fakeHangul.length ? fail(fakeHangul[0]) : pass('Hangul only from the lit-pptx pair or Galmuri, no synthetic scale'));
  const haloed = frames.flatMap((row) => (row.textBoxes || []).filter((b) => b.outline || b.halo));
  add('MO-A-35', haloed.length ? fail(`${haloed[0].elementId} is outlined or haloed`) : pass('no outlined or haloed type'));
  if (notice !== null) add('MO-A-36', notice ? pass('NOTICE present, byte-identical') : fail('NOTICE missing or altered'));
  const present = exports.present || {};
  const missingArtifacts = ['film', 'preview', 'poster', 'reduced', 'manifest'].filter((k) => !present[k]);
  add('MO-A-37–41', missingArtifacts.length ? fail(`missing: ${missingArtifacts.join(', ')}`) : pass('MP4, preview, poster, reduced-motion still and manifest present'));
  const schemaBad = (manifest.timeline || []).filter((u) => ['id', 'sceneId', 'shotIndex', 'start', 'end', 'holdSec', 'kind', 'text', 'script', 'beatSec'].some((k) => u[k] === undefined) || Math.abs(u.holdSec - (u.end - u.start)) > 1e-4);
  add('MO-A-41a', !manifest.timeline?.length || schemaBad.length ? fail(`timeline entry ${schemaBad[0]?.id || '(none)'} incomplete`) : pass('canonical timeline complete'));
  const ladder = [...chromeFlagLadder('darwin'), ...chromeFlagLadder('linux'), ...chromeFlagLadder('win32')].map((r) => r.join(' '));
  add('MO-A-51', ladder.includes((manifest.chromeFlags || []).join(' ')) ? pass(`rung: ${(manifest.chromeFlags || [])[0]}`) : fail(`chromeFlags not an MO-A-51 rung: ${(manifest.chromeFlags || []).join(' ')}`));
  const overrideBad = [];
  for (const row of frames) for (const [key, value] of Object.entries(row.overrides || {})) {
    const range = OVERRIDES[key];
    if (!range || typeof value !== 'number') continue;
    if (value < range[0] - EPS || (range[1] != null && value > range[1] + EPS)) overrideBad.push(`${key}=${value} at ${row.frame}`);
  }
  const cutFrames = new Set(shots.map((s) => Math.round(s.start * fps)));
  let lastInvert = false, invertSince = 0;
  const invertBad = [];
  for (const row of frames) {
    const inv = Boolean(row.overrides?.invert);
    if (inv !== lastInvert) {
      if (!cutFrames.has(row.frame)) invertBad.push(`invert changes off a cut at ${row.frame}`);
      else if (row.frame > 0 && row.frame - invertSince < TIMING.minSceneBeats * beat * fps - 1) invertBad.push(`invert held ${row.frame - invertSince} frames`);
      invertSince = row.frame; lastInvert = inv;
    }
  }
  if (lastInvert && total - invertSince < TIMING.minSceneBeats * beat * fps - 1) invertBad.push(`invert held ${total - invertSince} frames at the end`);
  add('MO-A-58', overrideBad.length || invertBad.length ? fail(overrideBad[0] || invertBad[0]) : pass('override values in range; invert only on cuts, held >= 2 beats'));
  const rangeBad = (manifest.passRanges || []).filter((r) => !LOOK_PASSES.includes(r.pass) || ['frameStart', 'frameEnd', 'sceneId', 'shotIndex', 'params', 'downgraded'].some((k) => r[k] === undefined) || !('seed' in r));
  add('MO-SH-00', rangeBad.length ? fail(`passRanges entry ${rangeBad[0].pass} malformed`) : pass(`${(manifest.passRanges || []).length} passRanges entries`));
  const logged = new Set(records.filter((r) => r.pass).map((r) => `${r.frame}:${r.pass}`));
  let gap = null;
  for (const r of manifest.passRanges || []) {
    for (let f = r.frameStart; f <= r.frameEnd && !gap; f++) if (!logged.has(`${f}:${r.pass}`)) gap = `${r.pass}@${r.sceneId}#${r.shotIndex} frame ${f}`;
    if (gap) break;
  }
  add('MO-SH-00a', gap ? fail(`no render-log line for ${gap}`) : pass('every range frame has a log line'));
  const seedBad = (manifest.passRanges || []).filter((r) => (r.pass === 'swiss-grid' ? r.seed !== null : r.seed !== passSeed(manifest.seed, r.sceneId, r.shotIndex, r.pass)));
  add('MO-SH-01', seedBad.length ? fail(`${seedBad[0].pass}@${seedBad[0].sceneId} seed ${seedBad[0].seed} != fnv1a32 formula`) : pass('seeds follow fnv1a32(runSeed:sceneId:shotIndex:pass)'));
  const events = [...(lx.events || [])];
  let lastFlash = 0;
  for (const row of frames) {
    const f = row.overrides?.flash || 0;
    if (f > EVENTS.flashRiseThreshold && lastFlash <= EVENTS.flashRiseThreshold) events.push({ kind: 'flash', t: row.frame / fps, sceneId: row.sceneId, shotIndex: row.shotIndex });
    lastFlash = f;
  }
  lastInvert = false;
  for (const row of frames) { const inv = Boolean(row.overrides?.invert); if (inv !== lastInvert) events.push({ kind: 'invert', t: row.frame / fps, sceneId: row.sceneId, shotIndex: row.shotIndex }); lastInvert = inv; }
  let eventBad = null;
  const byShot = new Map();
  for (const e of events) { const k = `${e.sceneId}#${e.shotIndex}`; byShot.set(k, [...(byShot.get(k) || []), e]); }
  for (const [key, list] of byShot) {
    const times = list.map((e) => e.t).sort((a, b) => a - b);
    for (let i = 0; i < times.length; i++) {
      const n = times.filter((t) => t >= times[i] - EPS && t < times[i] + EVENTS.perShotWindowSec - EPS).length;
      if (n > EVENTS.maxPerShotWindow) { eventBad = `${key}: ${n} events in 1 s from ${times[i].toFixed(2)}s`; break; }
    }
    if (eventBad) break;
  }
  add('MO-SH-03', eventBad ? fail(eventBad) : pass(`${events.length} events, at most 2 per shot per second`));
  const stepBad = frames.find((row) => (row.fullFrameStep || 0) > FLASH.fullFrameFraction + EPS);
  add('MO-SH-04a', stepBad ? fail(`frame ${stepBad.frame}: ${(stepBad.fullFrameStep * 100).toFixed(1)}% of the frame stepped >= 0.1`) : pass('no full-frame luminance step'));
  const byPass = (p) => (manifest.passRanges || []).filter((r) => r.pass === p);
  const glitchBad = byPass('glitch').find((r) => r.params.hitRatePerSec > PASS_CAPS.glitchHitsPerSec + EPS || (r.params.hitRatePerSecRealized ?? 0) > PASS_CAPS.glitchHitsPerSec + EPS || r.params.areaCapPct > PASS_CAPS.glitchAreaPct + EPS || (r.params.hits || []).some((h) => h.areaPct > PASS_CAPS.glitchAreaPct + EPS));
  add('MO-SH-05', glitchBad ? fail(`glitch@${glitchBad.sceneId}: rate ${glitchBad.params.hitRatePerSec}/s, area ${glitchBad.params.areaCapPct}%`) : pass(byPass('glitch').length ? 'glitch <= 2.0 hits/s, <= 20% area' : 'glitch not used'));
  const surgeBad = byPass('tidal-gradient').find((r) => r.params.surgeCapPerSec > PASS_CAPS.surgePerSec + EPS || r.params.surgeAttackSec < PASS_CAPS.surgeAttackSec - EPS || r.params.surgeDecaySec < PASS_CAPS.surgeDecaySec - EPS || (r.params.surges || []).some((s) => s.attack < PASS_CAPS.surgeAttackSec - EPS || s.decay < PASS_CAPS.surgeDecaySec - EPS));
  add('MO-SH-06', surgeBad ? fail(`tidal-gradient@${surgeBad.sceneId}: cap ${surgeBad.params.surgeCapPerSec}/s, attack ${surgeBad.params.surgeAttackSec}s`) : pass(byPass('tidal-gradient').length ? 'surges <= 2/s, attack and decay >= 0.1 s' : 'tidal-gradient not used'));
  const statefulShots = new Set((lx.shots || []).filter((s) => s.stateful).map((s) => `${s.sceneId}#${s.shotIndex}`));
  const crtBad = byPass('crt').find((r) => Math.max(r.params.flickerAmp ?? 0, r.params.bootFlickerAmp ?? 0, r.params.flickerAmpRealized ?? 0) > PASS_CAPS.crtFlickerPeakToPeak + EPS || (r.params.persistenceEnabled && !statefulShots.has(`${r.sceneId}#${r.shotIndex}`)));
  add('MO-SH-07', crtBad ? fail(`crt@${crtBad.sceneId}: flicker ${crtBad.params.flickerAmpRealized}, persistence ${crtBad.params.persistenceEnabled} on a ${statefulShots.has(`${crtBad.sceneId}#${crtBad.shotIndex}`) ? 'stateful' : 'non-stateful'} shot`) : pass(byPass('crt').length ? 'flicker <= 0.06; persistence only on stateful shots' : 'crt not used'));
  let reseed = null;
  for (const r of byPass('dither')) {
    const seeds = new Set(records.filter((x) => x.pass === 'dither' && x.frame >= r.frameStart && x.frame <= r.frameEnd && x.uniforms && 'u_seed' in x.uniforms).map((x) => x.uniforms.u_seed));
    if (seeds.size > 1) { reseed = `dither@${r.sceneId}#${r.shotIndex} used ${seeds.size} seeds`; break; }
  }
  add('MO-SH-08', reseed ? fail(reseed) : pass(byPass('dither').length ? 'dither seeded once per shot' : 'dither not used'));
  if (software) {
    const notDown = (manifest.passRanges || []).find((r) => !r.downgraded || (r.pass === 'crt' && r.params.persistenceEnabled) || (r.pass === 'tidal-gradient' && r.params.octaves !== Math.max(3, Math.floor(4 / 2))));
    add('MO-SH-09', notDown || manifest.samples !== 1 ? fail(`software GL without the downgrade formula (${notDown ? `${notDown.pass}@${notDown.sceneId}` : 'samples'})`) : pass('software downgrade applied: samples 1, octaves 3, persistence off'));
  } else add('MO-SH-09', pass('hardware renderer; no downgrade needed'));
  const guides = byPass('swiss-grid').find((r) => r.params.showGuides) || records.find((x) => x.pass === 'swiss-grid' && x.uniforms?.u_showGuides === true);
  add('MO-SH-10', guides ? fail('swiss-grid showGuides is true in an export') : pass(byPass('swiss-grid').length ? 'guides off' : 'swiss-grid not used'));
  const layers = byPass('terminal-ui').find((r) => (r.params.layers ?? 1) > PASS_CAPS.terminalLayersMax);
  add('MO-SH-11', layers ? fail(`terminal-ui uses ${layers.params.layers} layers`) : pass(byPass('terminal-ui').length ? '<= 2 terminal-ui layers' : 'terminal-ui not used'));
  if (lx.presetReason) {
    // A style named in the brief (by the user or chosen by the agent) is the pick; only an auto-pick is recomputed from the copy.
    const briefStyle = lx.presetReason === 'user-specified' || lx.presetReason === 'agent default';
    const expected = briefStyle ? manifest.presetId : pickPreset({ text: shots.map((s) => s.text) }).id;
    add('MO-B-00', expected === manifest.presetId ? pass(`${manifest.presetId} (${lx.presetReason})`) : fail(`auto-pick says ${expected}, manifest says ${manifest.presetId}`));
  }
  const trackHangul = [];
  for (const row of frames) for (const box of row.textBoxes || []) for (const run of box.runs || []) if (run.script === 'hangul' && ((run.trackingEm || 0) !== 0 || run.widthStep)) trackHangul.push(`${box.elementId} at ${row.frame}`);
  add('MO-FT-04', trackHangul.length ? fail(`tracking or width motion on a Hangul run: ${trackHangul[0]}`) : pass('Hangul runs untracked, no width motion'));
  const breakBad = [];
  for (const row of frames) for (const box of row.textBoxes || []) {
    if ((box.lines || []).length < 2) continue;
    const words = new Set(eojeols(box.text));
    if (box.lines.join(' ').replace(/\s+/g, ' ') !== box.text.replace(/\s+/g, ' ') || box.lines.some((line) => eojeols(line).some((w) => !words.has(w)))) breakBad.push(box.elementId);
  }
  add('MO-FT-05', breakBad.length ? fail(`line break inside a word in ${breakBad[0]}`) : pass('breaks only at 어절 boundaries'));
  const strokeBad = frames.flatMap((row) => (row.textBoxes || []).filter((b) => b.voice === 'stroke' && !STROKE_FONTS.has(b.fontFile)));
  add('MO-FT-08', strokeBad.length ? fail(`stroke text uses ${strokeBad[0].fontFile}`) : pass('stroke text only from the five EMS fonts'));

  const failed = rules.filter((r) => r.status === 'FAIL').map((r) => r.id);
  return { rules, failed, withhold: failed.includes('MO-C-03'), flash: { master, preview: prev } };
}

// Pre-flight (before any frame): fonts, glyph coverage and timeline floors.
export function preflightGate(manifest, { missingGlyphs = [], fontIssues = [] } = {}) {
  const rules = [];
  if (fontIssues.length) rules.push({ id: 'MO-A-55', status: 'FAIL', detail: fontIssues.join('; ') });
  rules.push(missingGlyphs.length ? { id: 'MO-D-04', status: 'FAIL', detail: `missing ${missingGlyphs.map((m) => `${JSON.stringify(m.ch)} in ${m.font}`).join(', ')}` } : { id: 'MO-D-04', status: 'PASS', detail: 'coverage complete' });
  const fps = manifest.fps, beat = 60 / (manifest.bpm || TIMING.defaultBpm);
  for (const unit of manifest.timeline) {
    const floor = readingFloor(unit.text, unit.kind);
    if (unit.holdSec < floor - 1 / fps - EPS) rules.push({ id: readingCounts(unit.text).H ? 'MO-C-08' : 'MO-C-07', status: 'FAIL', detail: `"${unit.text}" hold ${unit.holdSec}s < ${floor.toFixed(2)}s` });
    if (Math.abs(unit.start - unit.beatSec) > 1 / fps + EPS) rules.push({ id: 'MO-A-15', status: 'FAIL', detail: `${unit.id} off the beat` });
    if ((unit.kind === 'line' || unit.kind === 'scene') && unit.holdSec < TIMING.minSceneBeats * beat - 1 / fps - EPS) rules.push({ id: 'MO-A-16', status: 'FAIL', detail: `${unit.id} under 2 beats` });
  }
  const failed = rules.filter((r) => r.status === 'FAIL').map((r) => r.id);
  return { rules, failed, withhold: false, preflight: true };
}

const LABELS = {
  'MO-C-01': 'GLSL presence', 'MO-C-02': 'WebGL2 tier', 'MO-C-03': 'flash audit', 'MO-C-04': 'title-safe', 'MO-C-05': 'action-safe',
  'MO-C-06': 'type contrast', 'MO-C-07/08': 'reading time', 'MO-C-09': 'determinism', 'MO-C-10/11/12': 'duration/fps/res',
  'MO-C-13': 'file sizes', 'MO-C-14': 'reduced-motion still', 'MO-C-25': 'tracking', 'MO-C-26': 'line-height', 'MO-C-27': 'paragraph measure',
  'MO-C-29': 'one accent', 'MO-D-02': 'frame-time p95', 'MO-D-03': 'near-black run', 'MO-D-04': 'glyph coverage',
};
const MAIN_ORDER = ['MO-C-01', 'MO-C-02', 'MO-C-03', 'MO-C-04', 'MO-C-05', 'MO-C-06', 'MO-C-07/08', 'MO-C-09', 'MO-C-10/11/12', 'MO-C-13', 'MO-C-14',
  'MO-C-25', 'MO-C-26', 'MO-C-27', 'MO-C-29', 'MO-D-02', 'MO-D-03', 'MO-D-04'];

export function renderReport(manifest, gate, { outputs = {}, framesViewed = [], egress = 'websocket', withheld = false, preflight = false } = {}) {
  const lx = manifest.lithermes || {};
  const byId = new Map(gate.rules.map((r) => [r.id, r]));
  const pad = (s) => `${s}:`.padEnd(30);
  const prov = (id) => (['MO-C-05', 'MO-C-06', 'MO-C-07/08', 'MO-C-13', 'MO-C-14', 'MO-C-25', 'MO-C-29', 'MO-D-02', 'MO-D-03', 'MO-D-04'].includes(id) ? ' [provisional]' : '');
  const passes = (manifest.passRanges || []).map((r) => `${r.pass}@${r.sceneId}#${r.shotIndex}:${r.frameStart}-${r.frameEnd}`).join(', ');
  const soft = manifest.softwareRenderer;
  const lines = [
    'lit-typographic-motion — render report',
    `outputs: ${outputs.film || 'film.mp4'} · ${outputs.preview || 'preview'} (encoder: ${manifest.previewEncoder || 'none'}) · ${outputs.poster || 'poster.png'} · ${outputs.reduced || 'reduced-motion.png'}${withheld ? '  (WITHHELD: exports are in withheld/, not deliverables)' : ''}`,
    `preset: ${manifest.presetId}  (chosen because: ${lx.presetReason === 'user-specified' ? 'user-specified' : lx.presetReason || 'n/a'})`,
    `duration / fps / resolution: ${manifest.durationSec} s @ ${manifest.fps} fps, ${manifest.resolution?.join('x')}`,
    `GLSL passes (manifest): ${passes || 'none'}`,
    `WebGL2: ${soft ? 'software' : 'hardware'} — ${manifest.renderer || 'n/a'}  (flags: ${(manifest.chromeFlags || []).join(' ')})${soft ? '  software-rendered, --samples lowered to 1' : ''}`,
    ...(lx.sound?.label ? [`sound: ${lx.sound.label}`] : []),
    '',
    `QA gate: ${gate.failed.length ? 'FAIL' : 'PASS'}${preflight ? ' (pre-flight; nothing rendered)' : ''}`,
  ];
  for (const id of MAIN_ORDER) {
    const rule = byId.get(id);
    const status = rule ? (rule.status === 'PASS' ? '' : `${rule.status} `) : 'not measured ';
    lines.push(`  ${id} ${pad(LABELS[id]).slice(0, 30)} ${status}${rule?.detail || (preflight ? 'not reached (pre-flight stop)' : '')}${prov(id)}`.replace(/\s+$/, ''));
  }
  for (const rule of gate.rules) {
    if (MAIN_ORDER.includes(rule.id) || rule.id === 'MO-C-07' || rule.id === 'MO-C-08') continue;
    lines.push(`  ${rule.id} ${rule.status}: ${rule.detail}`);
  }
  lines.push('');
  lines.push(`craft rounds run: ${lx.round || 1} / 3 max`);
  lines.push(`frames actually viewed this run: ${framesViewed.length} (confirmed looked, not just rendered)`);
  lines.push(`frame egress: ${egress}${lx.listenError ? ` (listen refused: ${lx.listenError})` : ''}`);
  lines.push(`failed rules: ${gate.failed.join(', ') || 'none'}`);
  if (gate.withhold) lines.push('WITHHELD: the WCAG 2.3.1 flash gate failed; the MP4, preview and poster are diagnostics only and must not be delivered.');
  return `${lines.join('\n')}\n`;
}

// Promote staged exports to their deliverable names, or withhold all four.
export function promoteExports(out, { withhold, previewName }) {
  const names = ['film.mp4', previewName, 'poster.png', 'reduced-motion.png'].filter(Boolean);
  const destination = withhold ? join(out, 'withheld') : out;
  mkdirSync(destination, { recursive: true });
  for (const name of names) {
    const staged = join(out, '.run', name);
    const deliverable = join(out, name);
    if (withhold && existsSync(deliverable)) renameSync(deliverable, join(destination, name));
    if (!existsSync(staged)) continue;
    rmSync(join(destination, name), { force: true });
    renameSync(staged, join(destination, name));
  }
  if (!withhold) rmSync(join(out, 'withheld'), { recursive: true, force: true });
  return destination;
}
