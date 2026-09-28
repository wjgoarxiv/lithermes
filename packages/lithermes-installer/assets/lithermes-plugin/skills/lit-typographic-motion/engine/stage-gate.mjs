// Stage-path gate: the Wave 1 rules that apply to a captured page,
// with the stage geometry, plus the sound and text-QA rows their own modules
// measure. MO-C-01, MO-C-02, the glyph-mask MO-C-14 method and MO-D-02 do not
// apply here; MO-C-04, MO-C-06 and MO-C-07/08 are replaced by the text QA.
import { EMPTY, FLASH, OUTPUT } from './constants.mjs';
import { flashesFromRecords } from './flash.mjs';
import { FORMATS } from './treatment.mjs';
import { viewedFiles } from './director.mjs';

const pass = (detail) => ({ status: 'PASS', detail });
const fail = (detail) => ({ status: 'FAIL', detail });
const warn = (detail) => ({ status: 'WARN', detail });

// Near-black runs: the Wave 1 cap at the default 100 BPM (2 x 2 beats = 2.4 s),
// plus 1 s at either end of the film for a fade.
const EMPTY_CAP_SEC = EMPTY.sceneHoldMultiplier * 2 * 0.6;

export function runStageGate({ manifest, treatment, records, previewRecords = [], previewFps = 30, exports, sound = null, qa = null }) {
  const rules = [];
  const add = (id, result) => rules.push({ id, ...result });
  const fps = manifest.fps;
  const frames = [...records].sort((a, b) => a.frame - b.frame);

  const master = flashesFromRecords(frames.map((r) => ({ frame: r.frame, ...(r.flash || {}) })), fps);
  const prev = previewRecords.length ? flashesFromRecords(previewRecords, previewFps, { loop: true }) : { general: 0, red: 0 };
  const flashFail = master.general > FLASH.maxFlashes || master.red > FLASH.maxRedFlashes || prev.general > FLASH.maxFlashes || prev.red > FLASH.maxRedFlashes;
  const grid = manifest.resolution[1] > manifest.resolution[0] ? '180x320 cells, 60x107 window' : '320x180 cells, 107x60 window';
  const flashDetail = `worst window ${Math.max(master.general, prev.general)} general / ${Math.max(master.red, prev.red)} red (limit 3 / 3; ${grid}); master ${master.general}/${master.red}${master.general > 3 ? ` at ${master.worstGeneral.startSec}s` : ''}, preview ${prev.general}/${prev.red}${previewRecords.length ? '' : ' (no preview frames audited)'}`;
  add('MO-C-03', flashFail ? fail(flashDetail) : previewRecords.length || !exports.sizes?.preview ? pass(flashDetail) : fail(`${flashDetail}; the preview frames were never audited`));

  const det = manifest.determinism;
  if (!det?.checks?.length) add('MO-C-09', fail('no determinism replay recorded'));
  else add('MO-C-09', det.checks.every((c) => c.match) ? pass(`decoded RGBA SHA-256 match in a fresh sequential replay at frames ${det.checks.map((c) => c.frame).join(', ')}`) : fail(`frame ${det.checks.find((c) => !c.match).frame} differs`));

  const probe = exports.probe;
  const [W, H] = FORMATS[treatment.format];
  if (!probe) {
    for (const id of ['MO-C-10', 'MO-C-11', 'MO-C-12']) add(id, fail('no MP4 to probe'));
  } else {
    add('MO-C-10', probe.width === W && probe.height === H ? pass(`${probe.width}x${probe.height} for ${treatment.format}`) : fail(`${probe.width}x${probe.height}; ${treatment.format} needs exactly ${W}x${H}`));
    const tagsOk = probe.pix_fmt === 'yuv420p' && probe.color_space === 'bt709' && probe.color_range === 'tv' && probe.color_primaries === 'bt709' && probe.color_transfer === 'bt709';
    add('MO-C-11', tagsOk && probe.fps >= OUTPUT.minFps ? pass(`${probe.fps} fps; ffprobe yuv420p/bt709/tv Y`) : fail(`${probe.fps} fps; tags ${probe.pix_fmt}/${probe.color_space}/${probe.color_primaries}/${probe.color_transfer}/${probe.color_range}`));
    const target = treatment.durationSec;
    const off = Math.abs(probe.duration - target) / target;
    const text = `${probe.duration.toFixed(2)} s against the treatment's ${target} s (${(off * 100).toFixed(1)} % off; limit 10 %)`;
    add('MO-C-12', off <= 0.1 + 1e-9 && probe.duration >= 4 - 0.05 ? (probe.duration > OUTPUT.warnDurationSec ? warn(`${text}; longer than 90 s`) : pass(text)) : fail(text));
  }

  const sizes = exports.sizes || {};
  const sizeText = `mp4 ${sizes.film ?? 'n/a'}, preview ${sizes.preview ?? 'n/a'} (cap 3 MB), poster ${sizes.poster ?? 'n/a'} (cap 1 MB)`;
  const problems = [];
  if (sizes.preview == null || sizes.preview > OUTPUT.previewMaxBytes) problems.push('preview over 3 MB or missing');
  if (sizes.poster == null || sizes.poster > OUTPUT.posterMaxBytes) problems.push('poster over 1 MB or missing');
  const mp4Warn = sizes.film && manifest.durationSec && sizes.film / (manifest.durationSec / 10) > OUTPUT.mp4WarnBytesPer10s;
  add('MO-C-13', problems.length ? fail(`${sizeText}; ${problems.join('; ')}`) : mp4Warn ? warn(`${sizeText}; MP4 above 100 MB per 10 s`) : pass(sizeText));

  add('MO-C-14', sizes.reduced ? pass(`reduced-motion still is the final beat's midpoint (frame ${manifest.stills?.reduced})`) : fail('reduced-motion still missing'));

  const total = frames.length;
  const bad = [];
  let run = 0, start = 0;
  const check = (end) => {
    const allowance = (start === 0 ? EMPTY.fadeAllowanceSec : 0) + (end >= total - 1 ? EMPTY.fadeAllowanceSec : 0);
    if (run / fps > EMPTY_CAP_SEC + allowance + 1e-9) bad.push(`${(run / fps).toFixed(2)} s near-black from frame ${start}`);
  };
  frames.forEach((row, i) => {
    const empty = row.lumP995 < EMPTY.p995Ceiling;
    if (empty) { if (!run) start = i; run++; } else if (run) { check(i - 1); run = 0; }
  });
  if (run) check(total - 1);
  add('MO-D-03', bad.length ? fail(bad[0]) : pass(`no near-black run over ${EMPTY_CAP_SEC.toFixed(1)} s (1 s more at the ends)`));

  for (const row of sound?.rules || []) add(row.id, row);
  for (const row of qa?.rules || []) add(row.id, row);

  const failed = rules.filter((r) => r.status === 'FAIL').map((r) => r.id);
  return { rules, failed, withhold: failed.includes('MO-C-03'), flash: { master, preview: prev } };
}

export function renderStageReport(manifest, gate, { out, previewName }) {
  const lines = [];
  const outputs = gate.withhold ? `withheld/film.mp4, withheld/${previewName}, withheld/poster.png, withheld/reduced-motion.png (WITHHELD)` : `film.mp4, ${previewName}, poster.png, reduced-motion.png`;
  lines.push('lit-typographic-motion — stage render report');
  lines.push(`outputs: ${outputs}`);
  lines.push(`path: stage; format ${manifest.format} (${manifest.resolution.join('x')}); ${manifest.durationSec.toFixed(2)} s at ${manifest.fps} fps (${manifest.totalFrames} frames); treatment ${manifest.targetDurationSec} s`);
  lines.push(`renderer: ${manifest.renderer}; flags: ${manifest.chromeFlags.join(' ')}`);
  lines.push(`frame time: p50 ${manifest.frameTimeMs.p50} ms, p95 ${manifest.frameTimeMs.p95} ms over ${manifest.frameTimeMs.captured} captures; master ${manifest.masterSec?.toFixed(1)} s`);
  if (manifest.sound) lines.push(`sound: ${manifest.sound.label}`);
  lines.push(`QA gate: ${gate.failed.length ? 'FAIL' : 'PASS'}`);
  for (const rule of gate.rules) lines.push(`${rule.id}: ${rule.status} — ${rule.detail}`);
  lines.push(`craft round: ${manifest.round} / 3 max`);
  lines.push(`frames viewed (look.json): ${viewedFiles(out).length}`);
  if (manifest.warnings?.length) lines.push(`warnings: ${manifest.warnings.slice(0, 8).join(' | ')}`);
  lines.push(`failed rules: ${gate.failed.join(', ') || 'none'}`);
  if (gate.withhold) lines.push('WITHHELD: the WCAG 2.3.1 flash gate failed; the MP4, preview and poster are diagnostics only and must not be delivered.');
  return `${lines.join('\n')}\n`;
}
