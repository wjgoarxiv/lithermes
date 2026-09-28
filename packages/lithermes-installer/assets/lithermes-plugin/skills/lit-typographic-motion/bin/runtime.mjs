#!/usr/bin/env node
// LitHermes motion runtime: install-time pre-warm and read-only status.
// Cache mechanics follow this product's office runtime (lockfile-digest cache
// under ${XDG_CACHE_HOME:-$HERMES_HOME/.cache}, an exclusive install lock,
// `npm ci --omit=dev --ignore-scripts` into a staging dir, atomic rename), but
// nothing here ever runs on first render: `lithermes motion-runtime install`
// and the product installer are the only callers of install() (MO-A-42/43).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const runtimeRoot = join(skillRoot, 'runtime');
const pins = JSON.parse(readFileSync(join(runtimeRoot, 'fonts.json'), 'utf8'));
const wordTiming = JSON.parse(readFileSync(join(runtimeRoot, 'word-timing.json'), 'utf8'));
const lockBytes = readFileSync(join(runtimeRoot, 'package-lock.json'));
const audioLockBytes = readFileSync(join(runtimeRoot, 'requirements.lock'));
const sha = (data) => createHash('sha256').update(data).digest('hex');
export const digest = createHash('sha256').update(lockBytes).update(readFileSync(join(runtimeRoot, 'fonts.json'))).digest('hex').slice(0, 16);
export const audioDigest = sha(audioLockBytes).slice(0, 16);
export const WARM = 'lithermes motion-runtime install';
export const FONT_PINS = pins.entries;

// This product's own lit-pptx Hangul pair, checked against its recorded hashes (MO-A-55).
export const HANGUL_PAIR = Object.freeze([
  { id: 'pretendard-400', file: 'PretendardGOV-Regular.otf', sha256: 'e8c1d911bda79376b2029be4f1c61c1d5b48a9459123a80d5ea23dd055f70bb6' },
  { id: 'pretendard-700', file: 'PretendardGOV-Bold.otf', sha256: 'a3cd22c442e4ddb8e29501ca2136bfd9d187c70d608cd9feeaead09e4da7be19' },
]);
export const hangulPath = (file) => join(skillRoot, '..', 'lit-pptx', 'pretendard-font', 'public', 'static', file);

// Cache roots, first match wins for reads; the first entry receives installs.
export function cacheRoots(env = process.env) {
  const roots = [];
  if (env.XDG_CACHE_HOME) roots.push(env.XDG_CACHE_HOME);
  if (env.HERMES_HOME) roots.push(join(env.HERMES_HOME, '.cache'));
  const marker = `${sep}plugins${sep}lithermes${sep}skills${sep}`;
  if (skillRoot.includes(marker)) roots.push(join(skillRoot.slice(0, skillRoot.indexOf(marker)), '.cache'));
  roots.push(join(env.HOME || homedir(), '.cache'));
  return [...new Set(roots)].map((root) => join(root, 'lithermes', 'motion', digest));
}

const readyAt = (cache) => existsSync(join(cache, 'READY')) && readFileSync(join(cache, 'READY'), 'utf8') === `${digest}\n`
  && existsSync(join(cache, 'node', 'node_modules', 'playwright-core', 'package.json'));

export function findCache(env = process.env) {
  return cacheRoots(env).find(readyAt) || null;
}

export function depState(env = process.env) {
  const cache = findCache(env);
  return cache ? { ready: true, cache } : { ready: false, cache: cacheRoots(env)[0], missing: ['node dependencies (playwright-core, ws, opentype.js, pngjs)'] };
}

export function runtimeRequire(env = process.env) {
  const cache = findCache(env);
  if (!cache) throw Object.assign(new Error(`BLOCKED_DEPS_NOT_PREWARMED: pinned engine dependencies are not in the product cache; run \`${WARM}\` outside this session`), { exitCode: 14 });
  const require = createRequire(join(cache, 'node', 'package.json'));
  return (name) => require(name);
}

export function fontFile(cache, entryPath) {
  return join(cache, 'assets', entryPath);
}

// MO-A-55: every pinned font and licence present with its recorded sha256, plus
// the reused lit-pptx pair against this product's own hashes.
export function fontState(env = process.env) {
  const cache = findCache(env) || cacheRoots(env)[0];
  const missing = [], mismatched = [];
  for (const entry of pins.entries) {
    const file = fontFile(cache, entry.path);
    if (!existsSync(file)) missing.push(entry.path);
    else if (sha(readFileSync(file)) !== entry.sha256) mismatched.push(entry.path);
  }
  for (const pair of HANGUL_PAIR) {
    const file = hangulPath(pair.file);
    if (!existsSync(file)) missing.push(`lit-pptx/${pair.file}`);
    else if (sha(readFileSync(file)) !== pair.sha256) mismatched.push(`lit-pptx/${pair.file}`);
  }
  for (const name of ['EMS-OFL.txt', 'CREDITS']) if (!existsSync(join(runtimeRoot, 'licenses', name))) missing.push(`licenses/${name}`);
  return { cache, missing, mismatched, ok: !missing.length && !mismatched.length };
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || (result.stderr || '').trim().split('\n').slice(-3).join(' ') || `exit ${result.status}`;
    throw new Error(`${cmd} ${args[0] || ''} failed: ${detail}`);
  }
  return result.stdout;
}

// Pinned URL + sha256, verified before it lands; a mirror (file:// or http://127.0.0.1)
// replaces the host part for offline tests.
export async function fetchPinned(entry, targetFile, { mirror = process.env.LITHERMES_MOTION_FONT_MIRROR } = {}) {
  const url = mirror ? `${mirror.replace(/\/$/, '')}/${entry.path}` : entry.url;
  let bytes;
  if (url.startsWith('file://')) bytes = readFileSync(fileURLToPath(url));
  else {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`${entry.path}: HTTP ${response.status} from ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const got = sha(bytes);
  if (got !== entry.sha256) throw new Error(`${entry.path}: sha256 mismatch (got ${got}, pinned ${entry.sha256})`);
  mkdirSync(dirname(targetFile), { recursive: true });
  writeFileSync(targetFile, bytes, { flag: 'wx' });
}

function pythonFor(env) {
  const candidates = [env.LITHERMES_MOTION_PYTHON, 'python3.11', 'python3.12', 'python3.13', 'python3'].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', 'import sys; print(sys.version.split()[0])'], { encoding: 'utf8' });
    if (probe.status === 0) return { python: candidate, version: probe.stdout.trim() };
  }
  return null;
}

export const audioDir = (cache) => join(cache, `audio-${audioDigest}`);

// Tier 2 state: absent, pins drifted, or ready. Never repaired in session (MO-A-54).
export function audioState(env = process.env) {
  const cache = findCache(env) || cacheRoots(env)[0];
  const dir = audioDir(cache);
  const python = join(dir, 'venv', 'bin', 'python');
  if (!existsSync(python) || !existsSync(join(dir, 'AUDIO_READY'))) return { state: 'absent', python: null, dir };
  const expected = [...audioLockBytes.toString().matchAll(/^([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+-]+)/gm)].map(([, name, version]) => [name, version]);
  const script = [
    'import importlib.metadata as m, json, sys',
    'bad = []',
    'for name, version in json.loads(sys.argv[1]):',
    '    try:',
    '        if m.version(name) != version: bad.append(name)',
    '    except Exception: bad.append(name)',
    'print(json.dumps(bad))',
  ].join('\n');
  const check = spawnSync(python, ['-c', script, JSON.stringify(expected)], { encoding: 'utf8', timeout: 20000 });
  if (check.status !== 0) return { state: 'mismatched', python, dir, detail: (check.stderr || '').trim().split('\n').at(-1) };
  const bad = JSON.parse(check.stdout || '[]');
  return bad.length ? { state: 'mismatched', python, dir, detail: `pins drifted: ${bad.join(', ')}` } : { state: 'ready', python, dir };
}

async function installAudio(cache, env) {
  const py = pythonFor(env);
  if (!py) throw new Error('no python3 interpreter found for the --audio venv (set LITHERMES_MOTION_PYTHON)');
  const dir = audioDir(cache);
  const stage = `${dir}.stage-${process.pid}`;
  rmSync(stage, { recursive: true, force: true });
  run(py.python, ['-m', 'venv', join(stage, 'venv')]);
  run(join(stage, 'venv', 'bin', 'python'), ['-m', 'pip', 'install', '--disable-pip-version-check', '--require-hashes', '--only-binary=:all:', '-r', join(runtimeRoot, 'requirements.lock')], { timeout: 900000 });
  writeFileSync(join(stage, 'AUDIO_READY'), `${audioDigest}\n`);
  rmSync(dir, { recursive: true, force: true });
  renameSync(stage, dir);
  return `audio venv READY (${py.python} ${py.version})`;
}

export function wordTimingPlan() {
  const lines = ['word-timing models (Tier 3, opt-in):'];
  for (const m of wordTiming.models) lines.push(`  ${m.role}: ${m.id || 'NOT PINNED'} revision=${m.revision || 'none'} licence=${m.license || 'unknown'}${m.note ? ` (${m.note})` : ''}`);
  lines.push(`  download size: ${wordTiming.status === 'pinned' ? wordTiming.downloadBytes + ' bytes' : '0 bytes (nothing is downloaded: fail-closed)'}`);
  return { lines, pinned: wordTiming.status === 'pinned', reason: wordTiming.reason };
}

export function wordTimingReady(env = process.env) {
  if (wordTiming.status !== 'pinned') return false;
  const cache = findCache(env);
  return Boolean(cache && existsSync(join(cache, 'word-timing', 'READY')));
}

export async function install({ audio = false, wordTiming: wantWords = false, env = process.env } = {}) {
  if (wantWords) {
    const plan = wordTimingPlan();
    const error = new Error(`${plan.lines.join('\n')}\nword-timing install refused (fail-closed): ${plan.reason}`);
    error.exitCode = 14;
    throw error;
  }
  const roots = cacheRoots(env);
  const existing = findCache(env);
  const cache = existing || roots[0];
  const receipts = [];
  if (!existing || !fontState(env).ok) {
    mkdirSync(dirname(cache), { recursive: true });
    const lockPath = `${cache}.lock`;
    let fd;
    try { fd = openSync(lockPath, 'wx'); } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`another motion-runtime install holds ${lockPath}`);
      throw error;
    }
    const stage = `${cache}.stage-${process.pid}`;
    try {
      rmSync(stage, { recursive: true, force: true });
      mkdirSync(join(stage, 'node'), { recursive: true });
      for (const name of ['package.json', 'package-lock.json']) writeFileSync(join(stage, 'node', name), readFileSync(join(runtimeRoot, name)));
      run(env.LITHERMES_MOTION_NPM || 'npm', ['ci', '--prefix', join(stage, 'node'), '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
        { env: { ...env, npm_config_cache: join(dirname(cache), 'npm-cache') }, timeout: 600000 });
      for (const entry of pins.entries) await fetchPinned(entry, join(stage, 'assets', entry.path), { mirror: env.LITHERMES_MOTION_FONT_MIRROR });
      for (const pair of HANGUL_PAIR) {
        const file = hangulPath(pair.file);
        if (!existsSync(file) || sha(readFileSync(file)) !== pair.sha256) throw new Error(`reused Hangul font missing or changed: lit-pptx/${pair.file}`);
      }
      writeFileSync(join(stage, 'READY'), `${digest}\n`);
      if (existing) rmSync(existing, { recursive: true, force: true });
      rmSync(cache, { recursive: true, force: true });
      renameSync(stage, cache);
      receipts.push(`motion-runtime READY cache=${cache}`);
    } finally {
      rmSync(stage, { recursive: true, force: true });
      closeSync(fd);
      rmSync(lockPath, { force: true });
    }
  } else receipts.push(`motion-runtime READY cache=${cache} (already warm)`);
  if (audio) receipts.push(audioState(env).state === 'ready' ? 'audio venv READY (already warm)' : await installAudio(findCache(env), env));
  return receipts.join('\n');
}

const chromeProbeScript = () => {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return null;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown (debug-info extension unavailable)';
};

// MO-A-44: five probes on every run, in this product's "name: value" status style.
export async function status(env = process.env) {
  const { chromeExecutable, launchChrome } = await import('../engine/browser.mjs');
  const { isSoftwareRenderer, UNKNOWN_RENDERER } = await import('../engine/constants.mjs');
  const chrome = chromeExecutable(env);
  const version = chrome ? spawnSync(chrome, ['--version'], { encoding: 'utf8', timeout: 10000 }).stdout?.trim() : '';
  const ffmpeg = spawnSync('ffmpeg', ['-hide_banner', '-version'], { encoding: 'utf8', timeout: 10000, env });
  let preview = 'none';
  if (ffmpeg.status === 0) {
    const encoders = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 10000, env }).stdout || '';
    preview = /libwebp_anim/.test(encoders) ? 'libwebp_anim'
      : spawnSync('img2webp', ['-version'], { encoding: 'utf8', timeout: 10000, env }).status === 0 ? 'img2webp' : 'gif';
  }
  const deps = depState(env);
  const fonts = fontState(env);
  const audio = audioState(env);
  let renderer = null, glLine;
  if (!chrome) glLine = 'no WebGL2 context obtainable (Chrome not found)';
  else if (!deps.ready) glLine = `not probed: pinned driver not pre-warmed (run \`${WARM}\`)`;
  else {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const profileRoot = mkdtempSync(join(tmpdir(), 'lhm-'));
    try {
      const launched = await launchChrome({ chromium: runtimeRequire(env)('playwright-core').chromium, profileRoot, env, timeoutMs: 25000 });
      renderer = (await launched.page.evaluate(chromeProbeScript)) || launched.renderer;
      glLine = `${renderer} (flags: ${launched.flags.join(' ')})`;
      await launched.context.close().catch(() => {});
    } catch (error) {
      glLine = `no WebGL2 context obtainable: ${String(error.message).split('\n')[0]}`;
    } finally { rmSync(profileRoot, { recursive: true, force: true }); }
  }
  const software = !renderer ? 'unknown (no renderer probed)'
    : renderer === UNKNOWN_RENDERER ? 'warning: renderer type unknown - debug-info extension unavailable'
      : isSoftwareRenderer(renderer) ? `warning: software GL detected (${renderer}); renders will be slower, --samples lowered automatically`
        : 'none (hardware renderer)';
  const warmParts = [];
  if (!deps.ready) warmParts.push(`missing ${deps.missing.join(', ')}`);
  if (fonts.missing.length) warmParts.push(`missing fonts/licences: ${fonts.missing.join(', ')}`);
  if (fonts.mismatched.length) warmParts.push(`hash mismatch: ${fonts.mismatched.join(', ')}`);
  const audioText = audio.state === 'ready' ? 'audio venv READY' : audio.state === 'mismatched'
    ? `audio venv present but ${audio.detail || 'pins drifted'} (Tier 1 fallback; fix: ${WARM} --audio)` : `audio venv not installed (optional: ${WARM} --audio)`;
  const warm = warmParts.length ? `NOT READY - ${warmParts.join('; ')}; fix: ${WARM}` : `READY cache=${deps.cache}`;
  return [
    `Chrome: ${chrome ? `${chrome} (${version || 'version unknown'})` : 'not found on PATH / not installed (set CHROME_PATH)'}`,
    `ffmpeg: ${ffmpeg.status === 0 ? `${ffmpeg.stdout.split('\n')[0]}; preview encoder: ${preview}` : 'not found on PATH (video export blocked; stills and sheet still work)'}`,
    `WebGL2 renderer: ${glLine}`,
    `software GL: ${software}`,
    `pre-warm: ${warm}; ${audioText}`,
  ];
}

function isMain() {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

const USAGE = 'LitHermes motion-runtime usage: install|status [--audio] [--word-timing]';
if (isMain()) {
  const [action, ...rest] = process.argv.slice(2);
  const flags = new Set(rest);
  if (!action || action === '--help' || action === 'help') console.log(USAGE);
  else if (action === 'status') {
    console.log((await status()).join('\n'));
    if (flags.has('--word-timing')) console.log(wordTimingPlan().lines.join('\n'));
  } else if (action === 'install') {
    try {
      console.log(await install({ audio: flags.has('--audio'), wordTiming: flags.has('--word-timing') }));
    } catch (error) {
      console.error(String(error.message));
      process.exitCode = error.exitCode || 1;
    }
  } else { console.error(USAGE); process.exitCode = 2; }
}
