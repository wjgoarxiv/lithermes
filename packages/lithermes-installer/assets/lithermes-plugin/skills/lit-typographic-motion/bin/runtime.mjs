#!/usr/bin/env node
// LitHermes motion runtime: install-time pre-warm and read-only status.
// Cache mechanics follow this product's office runtime (lockfile-digest cache
// under ${XDG_CACHE_HOME:-$HERMES_HOME/.cache}, an exclusive install lock,
// `npm ci --omit=dev --ignore-scripts` into a staging dir, atomic rename), but
// nothing here ever runs on first render: `lithermes motion-runtime install`
// and the product installer are the only callers of install() (MO-A-42/43).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSpawnFailure, pickPython, spawnTool, venvPython } from '../engine/hostexec.mjs';

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
  { id: 'pretendard-400', file: 'Pretendard-Regular.otf', sha256: '3ffbacde6ab8411f1d2db54bb9b1f0b3ee2a738932033722cf0388c06aed1c93' },
  { id: 'pretendard-700', file: 'Pretendard-Bold.otf', sha256: '2e91915fab54df71cc9598ebf608b2bdb54c6fe3c066ac61dff0bc44fca71cc7' },
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
  const result = spawnTool(cmd, args, { encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || '').trim().split(/\r?\n/).slice(-3).join(' ');
    throw new Error(`${describeSpawnFailure(`${cmd} ${args[0] || ''}`.trim(), { ...result, stderr: detail })}`);
  }
  return result.stdout;
}

// Pinned URL + sha256, verified before it lands; a mirror (file:// or http://127.0.0.1)
// replaces the host part for offline tests.
const FONT_FETCH_LIMIT = 32 * 1024 * 1024;

/** True only for a public unicast address (mirrors the hijack capture guard). */
const isPublicUnicastIp = (ip) => {
  if (isIP(ip) === 4) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 127 || parts[0] === 10) return false;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    if (parts[0] === 192 && parts[1] === 168) return false;
    if (parts[0] === 169 && parts[1] === 254) return false;
    if (parts.every((part) => part === 0)) return false;
    if (parts[0] >= 224 && parts[0] <= 239) return false;
    return true;
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::' || lower.startsWith('ff')) return false;
    const first = Number.parseInt(lower.split(':', 1)[0] || '0', 16);
    if (first >= 0xfe80 && first <= 0xfebf) return false;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u);
    if (mapped) return isPublicUnicastIp(mapped[1]);
    return true;
  }
  return false;
};

const resolvePublicHost = async (hostname, lookupImpl) => {
  let records;
  try {
    records = await lookupImpl(hostname, { all: true });
  } catch (error) {
    throw new Error(`cannot resolve ${hostname}: ${error.message}`);
  }
  if (!records.length) throw new Error(`${hostname} resolves to nothing`);
  for (const record of records) {
    if (!isPublicUnicastIp(record.address)) {
      throw new Error(`${hostname} resolves to ${record.address}, which is not a public unicast address`);
    }
  }
  return { address: records[0].address, family: records[0].family };
};

const pinnedSend = (requestImpl) => (href, init, pin) => new Promise((resolveResponse, rejectResponse) => {
  const pinLookup = (_host, options, callback) => (
    options?.all
      ? callback(null, [{ address: pin.address, family: pin.family }])
      : callback(null, pin.address, pin.family)
  );
  const req = requestImpl(href, { signal: init.signal, lookup: pinLookup }, (res) => {
    const answer = new Headers();
    for (const [name, value] of Object.entries(res.headers)) {
      for (const item of [value].flat()) if (item !== undefined) answer.append(name, String(item));
    }
    const empty = [204, 205, 304].includes(res.statusCode);
    if (empty) res.resume();
    try {
      resolveResponse(new Response(empty ? null : Readable.toWeb(res), { status: res.statusCode, headers: answer }));
    } catch (error) {
      res.destroy();
      rejectResponse(error);
    }
  });
  req.on('error', rejectResponse);
  req.end();
});

const PINNED_REQUESTS = { 'http:': httpRequest, 'https:': httpsRequest };

export async function fetchPinned(entry, targetFile, { mirror = process.env.LITHERMES_MOTION_FONT_MIRROR, fetchImpl = null, requestImpls = PINNED_REQUESTS, lookupImpl = lookup } = {}) {
  const url = mirror ? `${mirror.replace(/\/$/, '')}/${entry.path}` : entry.url;
  let bytes;
  if (url.startsWith('file://')) bytes = readFileSync(fileURLToPath(url));
  else {
    // Every hop is resolved and checked before connecting, with a timeout, and
    // no hop may leave the entry host: a rebinding mirror must not smuggle the
    // fetch onto loopback, and a compromised CDN must not redirect it away. The
    // socket connects to the address the check approved, even if the name
    // rebinds afterwards; TLS still verifies the certificate for the name.
    const send = fetchImpl
      ? (href, init) => fetchImpl(href, init)
      : (href, init, pin) => pinnedSend({ ...PINNED_REQUESTS, ...requestImpls }[new URL(href).protocol])(href, init, pin);
    const pinned = new URL(url).host;
    const limit = FONT_FETCH_LIMIT;
    let current = url;
    let chunks = null;
    for (let hop = 0; hop <= 5; hop += 1) {
      const checked = new URL(current);
      if (checked.host !== pinned) {
        throw new Error(`${entry.path}: refusing font redirect off ${pinned} to ${checked.host}`);
      }
      let pin;
      if (isIP(checked.hostname)) {
        if (!isPublicUnicastIp(checked.hostname)) {
          throw new Error(`${checked.hostname} is not a public unicast address`);
        }
        pin = { address: checked.hostname, family: isIP(checked.hostname) };
      } else {
        pin = await resolvePublicHost(checked.hostname, lookupImpl);
      }
      const response = await send(current, { redirect: 'manual', signal: AbortSignal.timeout(30_000) }, pin);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`${entry.path}: font redirect without a location`);
        current = new URL(location, current).toString();
        continue;
      }
      if (!response.ok) throw new Error(`${entry.path}: HTTP ${response.status} from ${current}`);
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > limit) {
        throw new Error(`${entry.path}: declares ${declared} bytes, over the ${limit} byte cap`);
      }
      const reader = response.body.getReader();
      chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          try { await reader.cancel(); } catch { /* the server side already went away */ }
          throw new Error(`${entry.path}: larger than ${limit} bytes`);
        }
        chunks.push(value);
      }
      break;
    }
    if (!chunks) throw new Error(`${entry.path}: redirected more than 5 times`);
    bytes = Buffer.concat(chunks);
  }
  const got = sha(bytes);
  if (got !== entry.sha256) throw new Error(`${entry.path}: sha256 mismatch (got ${got}, pinned ${entry.sha256})`);
  mkdirSync(dirname(targetFile), { recursive: true });
  writeFileSync(targetFile, bytes, { flag: 'wx' });
}

// The audio venv takes the office runtime's supported-python pick, with a 3.11 floor: the lock pins
// numpy 2.4 and scipy 1.17, which start at Python 3.11.
export const pickAudioPython = (env = process.env) => pickPython({ env, override: 'LITHERMES_MOTION_PYTHON', min: [3, 11] });

export const audioDir = (cache) => join(cache, `audio-${audioDigest}`);

// Tier 2 state: absent, pins drifted, or ready. Never repaired in session (MO-A-54).
export function audioState(env = process.env) {
  const cache = findCache(env) || cacheRoots(env)[0];
  const dir = audioDir(cache);
  const python = venvPython(join(dir, 'venv'));
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
  if (check.status !== 0) return { state: 'mismatched', python, dir, detail: (check.stderr || '').trim().split(/\r?\n/).at(-1) };
  const bad = JSON.parse(check.stdout || '[]');
  return bad.length ? { state: 'mismatched', python, dir, detail: `pins drifted: ${bad.join(', ')}` } : { state: 'ready', python, dir };
}

async function installAudio(cache, env) {
  const py = pickAudioPython(env);
  if (!py.python) throw new Error(`${py.detail}; the --audio venv needs one (install Python 3.14 or set LITHERMES_MOTION_PYTHON)`);
  const dir = audioDir(cache);
  const stage = `${dir}.stage-${process.pid}`;
  rmSync(stage, { recursive: true, force: true });
  run(py.python, ['-m', 'venv', join(stage, 'venv')]);
  run(venvPython(join(stage, 'venv')), ['-m', 'pip', 'install', '--disable-pip-version-check', '--require-hashes', '--only-binary=:all:', '-r', join(runtimeRoot, 'requirements.lock')], { timeout: 900000 });
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

function coverEncoderLine(env) {
  const tool = (name) => { const probe = spawnSync(name, ['-version'], { encoding: 'utf8', timeout: 10000, env }); return probe.status === 0 ? (/\d+\.\d+(?:\.\d+)?/.exec(`${probe.stdout}${probe.stderr}`)?.[0] || 'unknown version') : null; };
  const img2webp = tool('img2webp'), dwebp = tool('dwebp');
  if (img2webp && dwebp) return `img2webp ${img2webp} and dwebp ${dwebp}; README covers encode as animated WebP and gate the decoded file`;
  if (spawnSync('gifski', ['--version'], { encoding: 'utf8', timeout: 10000, env }).status === 0) return `gifski (GIF fallback; img2webp${img2webp ? '' : ' missing'}, dwebp${dwebp ? '' : ' missing'})`;
  return 'not found: install libwebp (img2webp, dwebp) or gifski; cover renders stop with exit 21';
}

const chromeProbeScript = () => {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return null;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown (debug-info extension unavailable)';
};

// MO-A-44: five probes on every run, in this product's "name: value" status style, plus the
// cover encoder that cover mode needs (img2webp and dwebp, or the gifski fallback).
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
      glLine = `no WebGL2 context obtainable: ${String(error.message).split(/\r?\n/)[0]}`;
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
    `ffmpeg: ${ffmpeg.status === 0 ? `${ffmpeg.stdout.split(/\r?\n/)[0]}; preview encoder: ${preview}` : 'not found on PATH (video export blocked; stills and sheet still work)'}`,
    `WebGL2 renderer: ${glLine}`,
    `software GL: ${software}`,
    `pre-warm: ${warm}; ${audioText}`,
    `cover encoder: ${coverEncoderLine(env)}`,
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
