// The offline Blender rung (references/depth.md): the runner (engine/blender/runner.py, in
// Blender's own Python, no venv) renders the film's scene.py with Cycles on the GPU when it has
// one, else the CPU, and writes receipt.json. Call it `motion.mjs blender --out <dir>` for one
// still at every beat midpoint, `--final` for the plate sequence: preview first, compare with any
// reference frames the user gave and with what the GPU rung built, then render the final plate.
// The stage shows the plate under its type and treats a 3-D-of-any-kind page the same with or
// without one. The run is sequenced (not parallel), and the same scene.py, receipt and frames
// render exactly the same plate again: same seed, same Blender, same bytes.
import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './constants.mjs';
import { FORMATS, loadTreatment } from './treatment.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { exitCode: code, ...extra });

export const BLENDER = Object.freeze({
  // Preview: fast enough to compare against the GPU rung (CPU 32 spp renders a 100 % frame in
  // seconds). Final: within 2 dB of a 1024-spp reference, seams included. Quality bands calibrated
  // 2026-10-24 on this machine (Apple M3 Max): preview landed at 1.1 s median d, stills look right.
  preview: Object.freeze({ percent: 50, samples: 32 }),
  final: Object.freeze({ percent: 100, samples: 128 }),
  runner: join(here, 'blender', 'runner.py'),
  macApp: '/Applications/Blender.app/Contents/MacOS/Blender',
  device: 'METAL',
  plateFps: 30,
});

// Where Blender lives: a LITHERMES_BLENDER override first (pinned and never second-guessed), then
// the macOS app, then `blender` on PATH. Returns { path, source } or null.
export function findBlender({ env = process.env, exists = existsSync, platform = process.platform } = {}) {
  if (env.LITHERMES_BLENDER) return exists(env.LITHERMES_BLENDER) ? { path: env.LITHERMES_BLENDER, source: 'LITHERMES_BLENDER' } : null;
  if (platform === 'darwin' && exists(BLENDER.macApp)) return { path: BLENDER.macApp, source: 'app' };
  for (const dir of String(env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const file = join(dir, 'blender');
    if (exists(file)) return { path: file, source: 'PATH' };
  }
  return null;
}

const plateFrames = (treatment) => Math.round(treatment.durationSec * BLENDER.plateFps);

export function blenderArgs({ treatment, scene, out, quality }) {
  const q = BLENDER[quality];
  if (!q) throw new Error(`blenderArgs: quality is preview or final (got ${quality})`);
  const [width, height] = FORMATS[treatment.format];
  const seed = Number.isInteger(treatment.seed)
    ? treatment.seed >>> 0
    : parseInt(createHash('sha256').update(String(treatment.request)).digest('hex').slice(0, 8), 16) >>> 0;
  const args = ['-b', '--factory-startup', '-P', BLENDER.runner, '--',
    '--scene', scene, '--out', out, '--width', String(width), '--height', String(height),
    '--percent', String(q.percent), '--samples', String(q.samples), '--device', BLENDER.device,
    '--fps', String(BLENDER.plateFps), '--seed', String(seed % 2147483648)];
  if (quality === 'preview') args.push('--stills', treatment.beats.map((b) => +((b.t0 + b.t1) / 2).toFixed(3)).join(','));
  else args.push('--frames', `1-${plateFrames(treatment)}`);
  return args;
}

const FALLBACK = (out) => [
  'FALLBACK: no Blender found (LITHERMES_BLENDER, /Applications/Blender.app, blender on PATH), so nothing was rendered.',
  `Set render3d to "three" in ${join(out, 'treatment.json')} and build the world in three.js on the GPU rung (references/depth.md),`,
  'and say in the reply that the film used the GPU rung because Blender is not installed.',
].join('\n');

const listPngs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.png')).sort() : []);

function runBlender({ bin, args, dir, expected, progress }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const keep = (chunk) => {
      tail = (tail + chunk).slice(-4000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = progress ? setInterval(() => progress(listPngs(dir).length, expected), 2000) : null;
    child.on('close', (code) => {
      if (timer) clearInterval(timer);
      resolve({ code, tail });
    });
    child.on('error', (error) => {
      if (timer) clearInterval(timer);
      resolve({ code: -1, tail: error.message });
    });
  });
}

// `motion.mjs blender --out <dir> [--final]`. Preview: stills in stage/plate-preview/. Final: the
// plate sequence in stage/plate/ plus plate.json naming every frame with its size, carrying the
// device, samples and Blender version from the runner's receipt.
export async function blenderCommand({ out, final = false, env = process.env, log = () => {}, progress = null }) {
  const { treatment } = loadTreatment(out, EXIT.BLOCKED_TREATMENT_INVALID);
  if (treatment.path !== 'stage') throw fail(EXIT.BLOCKED_TREATMENT_INVALID, `BLOCKED_TREATMENT_INVALID: field path: blender renders the stage path (this treatment takes the ${treatment.path} path)`);
  if (treatment.render3d !== 'blender') throw fail(2, `blender renders a treatment with render3d "blender" (this one is ${treatment.render3d ?? 'three'})`);
  const stageDir = join(out, 'stage');
  const scene = join(stageDir, 'scene.py');
  if (!existsSync(scene)) throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: ${scene} is missing; write the Blender scene first (references/depth.md, the Blender rung)`);
  const found = findBlender({ env });
  if (!found) return { code: EXIT.OK, message: FALLBACK(out) };
  const quality = final ? 'final' : 'preview';
  const dir = join(stageDir, final ? 'plate' : 'plate-preview');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const args = blenderArgs({ treatment, scene, out: dir, quality });
  const expected = final ? plateFrames(treatment) : treatment.beats.length;
  log(`blender ${quality}: ${found.path} (${found.source}), ${expected} ${final ? 'frames' : 'stills'}`);
  const run = await runBlender({ bin: found.path, args, dir, expected, progress });
  const receiptFile = join(dir, 'receipt.json');
  if (run.code !== 0 || !existsSync(receiptFile)) {
    throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: Blender ${quality} failed (exit ${run.code}); fix stage/scene.py and run it again. Last output: ${run.tail.trim().split('\n').slice(-8).join(' | ')}`);
  }
  const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
  const frames = receipt.files.map((name) => ({ name, bytes: statSync(join(dir, name)).size }));
  if (frames.length !== expected) throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: Blender wrote ${frames.length} of ${expected} ${final ? 'frames' : 'stills'}`);
  const plate = { kind: quality, blender: receipt.blender, engine: receipt.engine, device: receipt.device, samples: receipt.samples, percent: receipt.percent, fps: BLENDER.plateFps, frames };
  writeFileSync(join(dir, 'plate.json'), `${JSON.stringify(plate, null, 1)}\n`);
  const label = `Blender ${receipt.blender}, ${receipt.engine} ${receipt.device}, ${receipt.samples} spp at ${receipt.percent} %`;
  if (!final) {
    return { code: EXIT.OK, message: `BLENDER preview: ${frames.length} stills at the beat midpoints in ${dir} (${label}). Open them, compare them with any reference frames the user gave, fix scene.py, then render the plate: blender --out ${out} --final` };
  }
  return { code: EXIT.OK, message: `BLENDER plate: ${frames.length} frames at ${BLENDER.plateFps} fps in ${dir} (${label}). Show it with LitStage.plate() under the type, then render the stage: stage --out ${out} --round N` };
}

// The plate a stage dir carries: { dir, frames, device, ... } when plate.json lists frames all present as listed, else null.
export function readPlate(stageDir, sub = 'plate') {
  const file = join(stageDir, sub, 'plate.json');
  if (!existsSync(file)) return null;
  let plate;
  try {
    plate = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(plate.frames)) return null;
  const ok = plate.frames.every((f) => {
    const p = join(stageDir, sub, String(f.name));
    return basename(String(f.name)) === f.name && existsSync(p) && statSync(p).size === f.bytes;
  });
  return ok ? { ...plate, dir: sub } : null;
}

// Blender's own version for the plate receipt (null when Blender is not installed here).
export function blenderVersion({ env = process.env } = {}) {
  const found = findBlender({ env });
  if (!found) return null;
  try {
    return execSync(`"${found.path}" --version`, { encoding: 'utf8' }).split('\n')[0].trim() || null;
  } catch {
    return null;
  }
}
