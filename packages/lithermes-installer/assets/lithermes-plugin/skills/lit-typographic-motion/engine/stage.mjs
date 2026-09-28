// Stage path: a model-authored page captured frame by frame. The page is
// served from a synthetic origin through CDP request interception (no socket
// listens), driven by the virtual clock in stage-init.js, captured on the
// software rung, piped into the pinned encode, replayed in a fresh Chrome for
// determinism, and gated. Nothing here fetches or installs.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { ALWAYS_FLAGS, EXIT, OUTPUT } from './constants.mjs';
import { chromeExecutable, launchCause, profileSockets } from './browser.mjs';
import { FlashDetector } from './flash.mjs';
import { encodePreview, ffprobe, hasFfmpeg, pngEncode, startMaster } from './encode.mjs';
import { FORMATS, loadTreatment } from './treatment.mjs';
import { recordFirstTreatment, writeJson, writeRunState } from './director.mjs';
import { stampStills, stillsPlan, writeStillsSet } from './stills.mjs';
import { runStageGate, renderStageReport } from './stage-gate.mjs';
import { produceSound, soundGate } from './sound.mjs';
import { runTextQa } from './stage-qa.mjs';
import { FONT_FILES } from './frame.mjs';
import { findCache, fontFile, fontState, hangulPath, runtimeRequire, WARM } from '../bin/runtime.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ORIGIN = 'http://lit.stage';
const sha = (data) => createHash('sha256').update(data).digest('hex');
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { exitCode: code, ...extra });

export const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.wav': 'audio/wav', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.json': 'application/json',
});
const RASTER = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const TEXTUAL = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json']);
export const RASTER_LIMITS = Object.freeze({ count: 24, bytes: 8 * 1024 * 1024, sameSize: 10 });

// The software rung only (SwiftShader, CPU raster): a mismatch between two
// captures can then only come from the page. Plus the stage set and the two
// keychain flags every Chrome launch carries.
export function stageFlags({ width, height }) {
  return [
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-rasterization',
    '--run-all-compositor-stages-before-draw', '--disable-checker-imaging', '--disable-new-content-rendering-timeout',
    '--disable-threaded-animation', '--disable-threaded-scrolling', '--disable-image-animation-resync', '--disable-lcd-text',
    '--force-color-profile=srgb', '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1', `--window-size=${width},${height}`,
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-pings', '--metrics-recording-only',
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE lit.stage',
    ...ALWAYS_FLAGS,
  ];
}

// ---------------------------------------------------------------------------
// Static pre-flight over the stage dir.

function imageSize(bytes, ext) {
  try {
    if (ext === '.png' && bytes.readUInt32BE(12) === 0x49484452) return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    if (ext === '.gif') return [bytes.readUInt16LE(6), bytes.readUInt16LE(8)];
    if (ext === '.webp' && bytes.toString('ascii', 0, 4) === 'RIFF') {
      const kind = bytes.toString('ascii', 12, 16);
      if (kind === 'VP8X') return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
      if (kind === 'VP8L') { const b = bytes.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
      if (kind === 'VP8 ') return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
    }
    if (ext === '.jpg' || ext === '.jpeg') {
      let at = 2;
      while (at < bytes.length) {
        if (bytes[at] !== 0xff) { at++; continue; }
        const marker = bytes[at + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [bytes.readUInt16BE(at + 7), bytes.readUInt16BE(at + 5)];
        at += 2 + bytes.readUInt16BE(at + 2);
      }
    }
  } catch { /* an unreadable header is reported as an unknown size */ }
  return null;
}

export function isAnimatedRaster(bytes, ext) {
  if (ext === '.png') {
    for (let at = 8; at + 8 <= bytes.length;) {
      const length = bytes.readUInt32BE(at), type = bytes.toString('ascii', at + 4, at + 8);
      if (type === 'acTL') return true;
      if (type === 'IDAT' || type === 'IEND') return false;
      at += 12 + length;
    }
    return false;
  }
  if (ext === '.webp') {
    if (bytes.toString('ascii', 12, 16) === 'VP8X' && (bytes[20] & 0x02)) return true;
    return bytes.includes(Buffer.from('ANIM'));
  }
  if (ext === '.gif') {
    // Count image descriptors by walking the block structure.
    let at = 13;
    if (bytes[10] & 0x80) at += 3 * (2 ** ((bytes[10] & 0x07) + 1));
    let frames = 0;
    while (at < bytes.length) {
      const block = bytes[at];
      if (block === 0x3b) break;
      if (block === 0x21) { at += 2; while (at < bytes.length && bytes[at]) at += bytes[at] + 1; at++; continue; }
      if (block === 0x2c) {
        frames++;
        if (frames > 1) return true;
        const packed = bytes[at + 9];
        at += 10;
        if (packed & 0x80) at += 3 * (2 ** ((packed & 0x07) + 1));
        at++;
        while (at < bytes.length && bytes[at]) at += bytes[at] + 1;
        at++;
        continue;
      }
      break;
    }
    return false;
  }
  return false;
}

const URL_ABSOLUTE = /\bhttps?:\/\/(?!www\.w3\.org\/|lit\.stage\/)[^\s"'<>)`]+/giu;
const URL_PROTOCOL_RELATIVE = /(?:["'(=]\s*)\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/gu;
const HINT_LINK = /rel\s*=\s*["']?\s*(?:preconnect|prefetch|dns-prefetch)\b/giu;
const FORBIDDEN_MARKUP = /<\s*(video|audio|iframe|object|embed|frame)\b/giu;
const FORBIDDEN_CREATE = /createElement(?:NS)?\s*\([^)]*?["'`](video|audio|iframe|object|embed|frame)["'`]\s*\)/giu;

function walk(dir, root, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = lstatSync(path);
    if (st.isSymbolicLink()) {
      const real = realpathSync(path);
      if (real !== root && !real.startsWith(root + sep)) out.push({ path, escape: true });
      else if (statSync(real).isDirectory()) walk(path, root, out);
      else out.push({ path, real });
    } else if (st.isDirectory()) walk(path, root, out);
    else if (st.isFile()) out.push({ path, real: path });
  }
  return out;
}

export function scanStage(stageDir) {
  const root = realpathSync(stageDir);
  const contract = [], network = [];
  const files = walk(root, root);
  const rasters = [];
  for (const file of files) {
    const rel = relative(root, file.path);
    if (file.escape) { contract.push(`${rel} is a symlink that leaves the stage dir`); continue; }
    const ext = extname(file.path).toLowerCase();
    const bytes = readFileSync(file.real);
    if (RASTER.has(ext)) {
      rasters.push({ rel, bytes: bytes.length, size: imageSize(bytes, ext) });
      if (isAnimatedRaster(bytes, ext)) contract.push(`${rel} is an animated ${ext.slice(1).toUpperCase()}; rasters are textures and stills, never motion`);
    }
    if (!TEXTUAL.has(ext)) continue;
    const text = bytes.toString('utf8');
    for (const m of text.matchAll(URL_ABSOLUTE)) network.push(`${rel}: absolute URL ${m[0].slice(0, 80)}`);
    for (const m of text.matchAll(URL_PROTOCOL_RELATIVE)) network.push(`${rel}: protocol-relative URL ${m[0].replace(/^["'(=]\s*/u, '').slice(0, 80)}`);
    for (const m of text.matchAll(HINT_LINK)) network.push(`${rel}: ${m[0].replace(/\s+/gu, ' ')} link`);
    if (ext === '.html' || ext === '.svg') for (const m of text.matchAll(FORBIDDEN_MARKUP)) contract.push(`${rel}: <${m[1].toLowerCase()}> is forbidden on the stage`);
    if (ext === '.html' || ext === '.js' || ext === '.mjs') for (const m of text.matchAll(FORBIDDEN_CREATE)) contract.push(`${rel}: createElement("${m[1].toLowerCase()}") is forbidden on the stage`);
  }
  const total = rasters.reduce((sum, r) => sum + r.bytes, 0);
  if (rasters.length > RASTER_LIMITS.count) contract.push(`${rasters.length} raster images; the stage allows at most ${RASTER_LIMITS.count}`);
  if (total > RASTER_LIMITS.bytes) contract.push(`rasters total ${total} bytes; the stage allows at most 8 MB`);
  const bySize = new Map();
  for (const r of rasters) if (r.size) { const key = r.size.join('x'); bySize.set(key, (bySize.get(key) || 0) + 1); }
  for (const [key, count] of bySize) if (count >= RASTER_LIMITS.sameSize) contract.push(`${count} rasters of the same size ${key} read as a flipbook; draw motion, do not play frames`);
  return { contract: [...new Set(contract)], network: [...new Set(network)], files: files.length, rasters: { count: rasters.length, bytes: total } };
}

// ---------------------------------------------------------------------------
// Fonts: the verified faces, served from the pre-warmed cache (and the reused
// lit-pptx Pretendard pair), never shipped under this skill.

const FACE_ROUTES = [
  ['Pretendard', 400, '100%', 'pretendard-400'], ['Pretendard', 700, '100%', 'pretendard-700'],
  ...[75, 100, 125].flatMap((w) => [500, 700, 900].map((wt) => ['Archivo', wt, `${w}%`, `archivo-w${w}-${wt}`])),
  ['Galmuri9', 400, '100%', 'galmuri9'], ['VT323', 400, '100%', 'vt323'], ['MesloLGS NF', 400, '100%', 'meslo'],
  ['Silkscreen', 400, '100%', 'silkscreen-400'], ['Silkscreen', 700, '100%', 'silkscreen-700'],
];

export function fontRoutes(cache) {
  const routes = new Map();
  const faces = [];
  for (const [family, weight, stretch, id] of FACE_ROUTES) {
    const entry = FONT_FILES[id];
    const file = entry.startsWith('lit-pptx:') ? hangulPath(entry.slice(9)) : fontFile(cache, entry);
    const name = entry.split('/').pop().replace(/^lit-pptx:/, '');
    routes.set(`/lit/fonts/${name}`, file);
    const format = name.endsWith('.otf') ? 'opentype' : 'truetype';
    faces.push(`@font-face { font-family: "${family}"; src: url("/lit/fonts/${name}") format("${format}"); font-weight: ${weight}; font-stretch: ${stretch}; font-style: normal; font-display: block; }`);
  }
  return { routes, css: `${faces.join('\n')}\n` };
}

// ---------------------------------------------------------------------------
// Chrome + serving.

// Resolve a request path inside the stage dir: only files whose realpath lies
// inside it, with a known content type. `..` segments and symlinks that leave
// the dir are refused (and recorded as a contract break), never served.
export function stageFile(root, pathname) {
  let path;
  try { path = decodeURIComponent(pathname); } catch { return { status: 403, reason: `request for ${pathname} is not a valid path` }; }
  if (path.split(/[/\\]/u).includes('..') || path.includes('\0')) return { status: 403, reason: `request for ${path} tried to leave the stage dir` };
  const target = resolve(root, `.${path === '/' ? '/index.html' : path}`);
  if (target !== root && !target.startsWith(root + sep)) return { status: 403, reason: `request for ${path} tried to leave the stage dir` };
  let real = null;
  try { real = realpathSync(target); } catch { return { status: 404 }; }
  if (real !== root && !real.startsWith(root + sep)) return { status: 403, reason: `request for ${path} resolves outside the stage dir` };
  const type = CONTENT_TYPES[extname(target).toLowerCase()];
  if (!type || !statSync(real).isFile()) return { status: 404 };
  return { status: 200, file: real, type };
}

export async function openStage({ runtime, stageDir, profileRoot, width, height, seed, fontCss, fontFiles, env = process.env }) {
  const chrome = chromeExecutable(env);
  if (!chrome) throw fail(EXIT.BLOCKED_NO_CHROME, 'BLOCKED_NO_CHROME: Chrome/Chromium not found; install Chrome or set CHROME_PATH');
  const { chromium } = runtime('playwright-core');
  const flags = stageFlags({ width, height });
  mkdirSync(profileRoot, { recursive: true });
  const profile = join(profileRoot, 'p');
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: chrome, headless: true, chromiumSandbox: true, args: flags, timeout: 30000,
      viewport: { width, height }, deviceScaleFactor: 1, serviceWorkers: 'block',
    });
  } catch (error) {
    rmSync(profile, { recursive: true, force: true });
    throw fail(EXIT.BLOCKED_NO_CHROME, `BLOCKED_NO_CHROME: headless Chrome failed to launch on the software rung: ${launchCause(error)}`);
  }
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(0);
  const cdp = await context.newCDPSession(page);
  const root = realpathSync(stageDir);
  const kit = readFileSync(join(here, 'stage-kit.js'));
  const blocked = [], contract = [];
  const serve = async (event) => {
    const { requestId, request } = event;
    let url;
    try { url = new URL(request.url); } catch { url = null; }
    if (!url || url.origin !== ORIGIN) {
      blocked.push(request.url.slice(0, 160));
      return cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    }
    const reply = (status, type, body) => cdp.send('Fetch.fulfillRequest', {
      requestId, responseCode: status,
      responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Cache-Control', value: 'no-store' }],
      body: Buffer.from(body).toString('base64'),
    }).catch(() => {});
    const path = decodeURIComponent(url.pathname);
    if (path === '/lit/stage-kit.js') return reply(200, CONTENT_TYPES['.js'], kit);
    if (path === '/lit/fonts.css') return reply(200, CONTENT_TYPES['.css'], fontCss);
    if (fontFiles.has(path)) return reply(200, CONTENT_TYPES[extname(path).toLowerCase()] || 'font/ttf', readFileSync(fontFiles.get(path)));
    const found = stageFile(root, path);
    if (found.status === 403) { contract.push(found.reason); return reply(403, 'text/plain', 'forbidden'); }
    if (found.status === 404) return reply(404, 'text/plain', 'not found');
    return reply(200, found.type, readFileSync(found.file));
  };
  cdp.on('Fetch.requestPaused', (event) => { serve(event); });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  const init = readFileSync(join(here, 'stage-init.js'), 'utf8').replace(/^\/\/.*\n/gmu, '');
  await page.addInitScript({ content: `try { ${init.trim()}(${JSON.stringify({ seed, epochMs: 1767225600000 })}); } catch (error) { window.__litStageInitError = String(error && error.stack || error); }` });
  const sockets = profileSockets(profile);
  return {
    page, cdp, flags, blocked, contract, sockets,
    async load() {
      await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'load', timeout: 120000 });
      return page.evaluate(() => {
        const S = window.__litStage || {};
        const film = S.film || window.litStage || null;
        return { film: film && { width: film.width, height: film.height, fps: film.fps, duration: film.duration, hasRender: typeof film.render === 'function' }, violations: S.violations || [], errors: S.errors || [], initError: window.__litStageInitError || (typeof S.step === 'function' ? null : 'the stage init script did not run') };
      });
    },
    prepare: (imageUrls) => page.evaluate((urls) => window.__litStage.prepare(urls), imageUrls),
    step: (t, paint) => page.evaluate(([time, p]) => window.__litStage.step(time, { paint: p }), [t, paint]),
    async capture() {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, captureBeyondViewport: false, fromSurface: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
      return Buffer.from(shot.data, 'base64');
    },
    async close() {
      await context.close().catch(() => {});
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// A small pool that decodes captured PNGs and measures them off the main thread.

class DecodePool {
  constructor(size, requireFrom) {
    this.workers = Array.from({ length: size }, () => new Worker(new URL('./stage-worker.mjs', import.meta.url), { workerData: { requireFrom } }));
    this.idle = [...this.workers];
    this.queue = [];
    this.pending = new Map();
    this.next = 1;
    for (const worker of this.workers) {
      worker.on('message', (msg) => {
        const job = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        this.idle.push(worker);
        this.pump();
        if (msg.error) job.reject(new Error(msg.error)); else job.resolve(msg);
      });
      worker.on('error', (error) => { for (const job of this.pending.values()) job.reject(error); this.pending.clear(); });
    }
  }
  run(png, options) {
    return new Promise((resolve, reject) => { this.queue.push({ png, options, resolve, reject }); this.pump(); });
  }
  pump() {
    while (this.idle.length && this.queue.length) {
      const worker = this.idle.pop();
      const job = this.queue.shift();
      const id = this.next++;
      this.pending.set(id, job);
      const copy = job.png.buffer.slice(job.png.byteOffset, job.png.byteOffset + job.png.byteLength);
      worker.postMessage({ id, png: copy, ...job.options }, [copy]);
    }
  }
  async close() { await Promise.all(this.workers.map((w) => w.terminate())); }
}

// ---------------------------------------------------------------------------
// Determinism samples: frame 0, the last frame and every beat's first frame,
// spread evenly to at most 16, then beat midpoints until there are at least 8.

export function determinismSamples(totalFrames, beatFrames) {
  const firsts = [...new Set([0, totalFrames - 1, ...beatFrames.map((b) => b.first)])].filter((f) => f >= 0 && f < totalFrames).sort((a, b) => a - b);
  let picked = firsts;
  if (picked.length > 16) {
    const keep = new Set([0, totalFrames - 1]);
    const inner = firsts.filter((f) => !keep.has(f));
    for (let i = 0; i < 14; i++) keep.add(inner[Math.round((i * (inner.length - 1)) / 13)]);
    picked = [...keep].sort((a, b) => a - b);
  }
  const set = new Set(picked);
  for (const b of beatFrames) { if (set.size >= 8) break; set.add(b.mid); }
  for (let k = 1; set.size < 8 && k < totalFrames; k++) set.add(Math.round((k * (totalFrames - 1)) / 9));
  return [...set].sort((a, b) => a - b);
}

function firstDifference(a, b, width, height) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

// ---------------------------------------------------------------------------

function beatFramesOf(treatment, fps, totalFrames) {
  return treatment.beats.map((beat, index) => {
    const first = Math.min(totalFrames - 1, Math.max(0, Math.round(beat.t0 * fps)));
    const last = Math.min(totalFrames - 1, Math.max(first, Math.round(beat.t1 * fps) - 1));
    return { index, first, last, mid: Math.round((first + last) / 2) };
  });
}

function imageUrlsIn(stageDir) {
  const root = realpathSync(stageDir);
  return walk(root, root).filter((f) => !f.escape && RASTER.has(extname(f.path).toLowerCase()))
    .map((f) => `${ORIGIN}/${relative(root, f.path).split(sep).map(encodeURIComponent).join('/')}`);
}

async function loadStage(session, stage) {
  const loaded = await stage.load();
  if (loaded.initError) throw fail(1, `stage init failed: ${loaded.initError}`);
  if (stage.blocked.length) throw fail(EXIT.STAGE_NETWORK_REQUEST, `STAGE_NETWORK_REQUEST: the page requested ${stage.blocked[0]}${stage.blocked.length > 1 ? ` (+${stage.blocked.length - 1} more)` : ''}; the stage is served offline`);
  checkStep({ violations: loaded.violations, webglNull: false }, stage, 'load');
  if (!loaded.film) throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: the page never called LitStage.define (or set window.litStage)${loaded.errors.length ? `; page error: ${loaded.errors[0]}` : ''}`);
  const [w, h] = session.size;
  if (loaded.film.width !== w || loaded.film.height !== h) {
    throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: LitStage.define says ${loaded.film.width}x${loaded.film.height} but the treatment's ${session.treatment.format} format is ${w}x${h}`);
  }
  const fps = loaded.film.fps ?? 60;
  if (!(fps === 60 || (fps === 30 && session.treatment.fps === 30))) throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: fps ${fps}; the stage runs at 60 (30 only when the treatment sets "fps": 30)`);
  if (!(loaded.film.duration > 0 && loaded.film.duration <= 120)) throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: duration ${loaded.film.duration}`);
  const prepared = await stage.prepare(imageUrlsIn(session.stageDir));
  return { film: { ...loaded.film, fps }, faces: prepared.faces, errors: loaded.errors };
}

// Socket and peer APIs are network requests (exit 19); the other stubs are
// contract breaks (exit 17).
const NETWORK_APIS = new Set(['WebSocket', 'WebTransport', 'RTCPeerConnection', 'webkitRTCPeerConnection']);

function checkStep(result, stage, frame) {
  if (stage.blocked.length) throw fail(EXIT.STAGE_NETWORK_REQUEST, `STAGE_NETWORK_REQUEST: frame ${frame} requested ${stage.blocked[0]}; the stage is served offline`);
  const network = result.violations.filter((v) => NETWORK_APIS.has(v));
  if (network.length) throw fail(EXIT.STAGE_NETWORK_REQUEST, `STAGE_NETWORK_REQUEST: the page used ${network.join(', ')} (seen by frame ${frame}); the stage is served offline`);
  const problems = [...result.violations, ...stage.contract];
  if (problems.length) throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: ${problems.join('; ')} (seen by frame ${frame})`);
  if (result.webglNull) throw fail(EXIT.BLOCKED_NO_WEBGL2, 'BLOCKED_NO_WEBGL2: the page asked for a WebGL context and the software renderer returned none');
}

class StageSession {
  constructor(flags) {
    this.flags = flags;
    this.out = resolve(flags.out || 'motion-output');
    this.round = Number(flags.round || 1);
    this.stillsOnly = Boolean(flags['stills-only']);
    this.mode = this.stillsOnly ? 'stage-stills' : 'stage';
    this.stageDir = join(this.out, 'stage');
    this.warnings = [];
    this.timing = [];
  }

  prepare() {
    if (![1, 2, 3].includes(this.round)) throw fail(2, '--round must be 1, 2 or 3');
    const { treatment } = loadTreatment(this.out, EXIT.BLOCKED_TREATMENT_INVALID);
    if (treatment.path !== 'stage') throw fail(EXIT.BLOCKED_TREATMENT_INVALID, 'BLOCKED_TREATMENT_INVALID: field path: this treatment takes the type path; render it with `run --out DIR`');
    recordFirstTreatment(this.out, treatment);
    this.treatment = treatment;
    this.size = FORMATS[treatment.format];
    this.seed = Number.parseInt(sha(treatment.request).slice(0, 8), 16) >>> 0;
    if (!existsSync(join(this.stageDir, 'index.html'))) throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: no stage/index.html in ${this.out}; author the page first (references/stage.md)`);
    const scan = scanStage(this.stageDir);
    this.scan = scan;
    if (scan.contract.length) throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: ${scan.contract.join('; ')}`);
    if (scan.network.length) throw fail(EXIT.STAGE_NETWORK_REQUEST, `STAGE_NETWORK_REQUEST: ${scan.network.join('; ')}; the stage is served offline`);
    this.require = runtimeRequire();
    this.cache = findCache();
    const fonts = fontState();
    if (!fonts.ok) throw fail(EXIT.BLOCKED_FONT_FETCH, `BLOCKED_FONT_FETCH: ${[...fonts.missing.map((f) => `missing ${f}`), ...fonts.mismatched.map((f) => `sha256 mismatch ${f}`)].join('; ')}; run \`${WARM}\` outside this session`);
    this.PNG = this.require('pngjs').PNG;
    this.fonts = fontRoutes(this.cache);
    this.ffmpeg = hasFfmpeg();
  }

  open(tag) {
    return openStage({
      runtime: this.require, stageDir: this.stageDir, profileRoot: join(this.out, '.run', `${tag}${process.pid % 100000}`),
      width: this.size[0], height: this.size[1], seed: this.seed, fontCss: this.fonts.css, fontFiles: this.fonts.routes,
    });
  }

  // The master pass. With stills-only, every frame is still stepped (a page
  // may keep state) but only the stills frames are painted and captured.
  async master() {
    const [W, H] = this.size;
    const stage = await this.open('c');
    this.stage = stage;
    try {
      const loaded = await loadStage(this, stage);
      this.film = loaded.film;
      this.faces = loaded.faces;
      if (loaded.errors.length) this.warnings.push(`page errors while loading: ${loaded.errors.slice(0, 3).join(' / ')}`);
      const fps = this.film.fps;
      this.fps = fps;
      this.totalFrames = Math.max(1, Math.round(this.film.duration * fps));
      this.durationSec = this.totalFrames / fps;
      this.beats = beatFramesOf(this.treatment, fps, this.totalFrames);
      this.plan = stillsPlan({ totalFrames: this.totalFrames, beats: this.beats });
      this.samples = determinismSamples(this.totalFrames, this.beats);
      const wanted = new Set([...this.plan.frames, ...(this.stillsOnly ? [] : this.samples)]);
      const pngs = new Map();
      const encode = !this.stillsOnly && this.ffmpeg;
      const pool = new DecodePool(3, join(this.cache, 'node', 'package.json'));
      const runDir = join(this.out, '.run');
      mkdirSync(runDir, { recursive: true });
      const encoder = encode ? startMaster({ width: W, height: H, fps, output: join(runDir, 'video.mp4') }) : null;
      const detector = new FlashDetector(W, H);
      const previewDir = join(runDir, 'preview-src');
      rmSync(previewDir, { recursive: true, force: true });
      if (encode) mkdirSync(previewDir, { recursive: true });
      const previewEvery = Math.max(1, Math.round(fps / 30));
      const previewLong = OUTPUT.previewLadder[0][0];
      const previewWidth = Math.round((W * previewLong) / Math.max(W, H));
      this.records = [];
      this.previewFrames = [];
      let writing = Promise.resolve();
      const inflight = [];
      const started = process.hrtime.bigint();
      for (let f = 0; f < this.totalFrames; f++) {
        const capture = encode || wanted.has(f);
        const t0 = process.hrtime.bigint();
        const result = await stage.step(f / fps, capture);
        checkStep(result, stage, f);
        if (result.errors.length) this.warnings.push(`frame ${f}: ${result.errors[0]}`);
        if (!capture) continue;
        const png = await stage.capture();
        this.timing.push(Number(process.hrtime.bigint() - t0) / 1e6);
        if (wanted.has(f)) pngs.set(f, png);
        if (!encode) continue;
        const job = pool.run(png, { preview: f % previewEvery === 0 ? previewWidth : 0, width: W, height: H });
        inflight.push(job);
        const frame = f;
        writing = writing.then(async () => {
          const decoded = await job;
          if (decoded.width !== W || decoded.height !== H) throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: frame ${frame} captured at ${decoded.width}x${decoded.height}, not ${W}x${H}`);
          const rgba = Buffer.from(decoded.rgba);
          const flash = detector.push(rgba);
          await encoder.write(rgba);
          if (decoded.small) {
            const file = join(previewDir, `s${String(frame).padStart(5, '0')}.png`);
            writeFileSync(file, pngEncode(this.PNG, Buffer.from(decoded.small), decoded.smallWidth, decoded.smallHeight, { level: 1, scratch: true }));
            this.previewFrames[frame] = file;
          }
          this.records.push({ frame, rgbaSha256: decoded.sha, lumP995: decoded.lumP995, flash: { general: flash.general, generalBoth: flash.generalBoth, red: flash.red, redBoth: flash.redBoth }, fullFrameStep: Number(flash.fullFrameStep.toFixed(4)) });
        });
        if (inflight.length > 6) await inflight.shift();
        if (f % 60 === 59) {
          process.stderr.write(`motion stage: ${f + 1}/${this.totalFrames} frames\n`);
          writeJson(join(runDir, 'progress.json'), { phase: 'master', frame: f + 1, totalFrames: this.totalFrames, elapsedSec: Number(process.hrtime.bigint() - started) / 1e9 });
        }
      }
      await writing;
      await pool.close();
      this.masterSec = Number(process.hrtime.bigint() - started) / 1e9;
      if (encoder) {
        const done = await encoder.finish();
        if (done.code !== 0) throw fail(1, `ffmpeg master encode failed: ${done.stderr.split('\n').filter(Boolean).at(-1) || done.code}`);
      }
      this.pngs = pngs;
    } finally {
      await stage.close();
    }
  }

  // A fresh Chrome replays the clock from 0 and re-captures the samples. It
  // paints and captures every frame, as the master did: Chrome re-rasters only
  // what changed, and a capture is itself part of that history, so a replay
  // that skipped paints or captures would carry a different raster state.
  async determinism() {
    const [W, H] = this.size;
    const stage = await this.open('d');
    const checks = [];
    try {
      await loadStage(this, stage);
      const wanted = new Set(this.samples);
      const last = Math.max(...this.samples);
      for (let f = 0; f <= last; f++) {
        const result = await stage.step(f / this.fps, true);
        checkStep(result, stage, f);
        const png = await stage.capture();
        if (!wanted.has(f)) continue;
        const rgba = this.PNG.sync.read(png).data;
        const replay = sha(rgba);
        const master = this.records.find((r) => r.frame === f)?.rgbaSha256;
        const entry = { frame: f, master, replay, match: master === replay };
        if (!entry.match) {
          const original = this.PNG.sync.read(this.pngs.get(f)).data;
          entry.region = firstDifference(original, rgba, W, H);
        }
        checks.push(entry);
        if (!entry.match) break;
      }
    } finally {
      await stage.close();
    }
    this.determinismResult = { checks, samples: this.samples };
    const bad = checks.find((c) => !c.match);
    if (bad) {
      const r = bad.region ? `x ${bad.region[0]}-${bad.region[2]}, y ${bad.region[1]}-${bad.region[3]}` : 'no pixel region found';
      throw fail(EXIT.STAGE_NONDETERMINISTIC, `STAGE_NONDETERMINISTIC: frame ${bad.frame} differs in a fresh replay (first differing region ${r}); something on the page reads a clock or randomness the virtual clock does not cover`, { determinism: this.determinismResult });
    }
  }

  manifest(extra = {}) {
    const [W, H] = this.size;
    const timing = [...this.timing].sort((a, b) => a - b);
    const pick = (q) => (timing.length ? Number(timing[Math.min(timing.length - 1, Math.ceil(q * timing.length) - 1)].toFixed(1)) : null);
    return {
      schemaVersion: 2, path: 'stage', format: this.treatment.format, fps: this.fps, resolution: [W, H], durationSec: this.durationSec,
      targetDurationSec: this.treatment.durationSec, totalFrames: this.totalFrames, round: this.round, mode: this.mode,
      treatment: { file: join(this.out, 'treatment.json'), sha256: sha(readFileSync(join(this.out, 'treatment.json'))) },
      chromeFlags: this.stage?.flags || [], chromeSockets: this.stage?.sockets || [], renderer: 'SwiftShader (software rung)',
      faces: this.faces, scan: this.scan, beats: this.beats, stills: this.plan, determinism: this.determinismResult || null,
      frameTimeMs: { p50: pick(0.5), p95: pick(0.95), captured: timing.length }, masterSec: this.masterSec, warnings: this.warnings,
      generatedAt: new Date().toISOString(), ...extra,
    };
  }
}

export async function stageCommand(flags) {
  if (flags.detach) return detach(flags);
  const session = new StageSession(flags);
  writeRunState(session.out, { exitCode: null, mode: session.mode, round: session.round, finished: false, path: 'stage' });
  try {
    session.prepare();
    await session.master();
    const stills = writeStillsSet({ out: session.out, PNG: session.PNG, pngs: session.pngs, plan: session.plan, size: session.size, round: session.round, mode: session.mode });
    if (session.stillsOnly || !session.ffmpeg) {
      const manifest = session.manifest({ stillsSet: stills.file });
      writeJson(join(session.out, 'manifest.json'), manifest);
      stampStills(session.out);
      if (!session.ffmpeg && !session.stillsOnly) throw fail(EXIT.BLOCKED_NO_FFMPEG_FOR_VIDEO, `BLOCKED_NO_FFMPEG_FOR_VIDEO: stills and the contact sheet are in ${session.out}; ffmpeg is not on PATH, so no film was encoded`);
      writeRunState(session.out, { exitCode: 0, mode: session.mode, round: session.round, finished: true, failed: [], path: 'stage' });
      console.log(`stills: ${stills.files.map((f) => join(session.out, f.file)).join(' ')}`);
      console.log('View every still, strip and the contact sheet, then record the round with `look` before the full render.');
      return 0;
    }
    await session.determinism();
    const run = join(session.out, '.run');
    const sound = await produceSound({ out: session.out, treatment: session.treatment, fps: session.fps, totalFrames: session.totalFrames, cuts: session.beats.slice(1).map((b) => b.first / session.fps), video: join(run, 'video.mp4'), output: join(run, 'film.mp4') });
    const [W, H] = session.size;
    const poster = session.pngs.get(session.plan.poster);
    writeFileSync(join(run, 'poster.png'), pngEncode(session.PNG, session.PNG.sync.read(poster).data, W, H, { level: 9 }));
    const reduced = session.pngs.get(session.plan.reduced);
    writeFileSync(join(run, 'reduced-motion.png'), pngEncode(session.PNG, session.PNG.sync.read(reduced).data, W, H, { level: 9 }));
    const preview = encodePreview({ PNG: session.PNG, sourceFrames: session.previewFrames, masterFps: session.fps, durationSec: session.durationSec, workDir: run, minGlyphPx: 64, sourceWidth: W, sourceHeight: H });
    rmSync(join(run, 'preview-src'), { recursive: true, force: true });
    const qa = await runTextQa(session);
    const films = join(run, 'film.mp4');
    const exportsInfo = {
      probe: existsSync(films) ? ffprobe(films) : null,
      sizes: { film: existsSync(films) ? statSync(films).size : null, preview: preview.file ? statSync(preview.file).size : null, poster: statSync(join(run, 'poster.png')).size, reduced: statSync(join(run, 'reduced-motion.png')).size },
      previewName: preview.encoder === 'gif' ? 'preview.gif' : 'preview.webp',
    };
    const manifest = session.manifest({ preview: { encoder: preview.encoder, width: preview.width, fps: preview.fps, attempts: preview.attempts }, sound: sound.summary, textQa: qa.summary, stillsSet: stills.file });
    const gate = runStageGate({ manifest, treatment: session.treatment, records: session.records, previewRecords: preview.records, previewFps: preview.fps, exports: exportsInfo, sound, qa });
    promoteStage(session.out, { withhold: gate.withhold, previewName: exportsInfo.previewName });
    writeJson(join(session.out, 'manifest.json'), manifest);
    stampStills(session.out);
    writeFileSync(join(session.out, 'render.jsonl'), `${session.records.map((r) => JSON.stringify(r)).join('\n')}\n`);
    writeJson(join(run, 'gate-data.json'), { previewRecords: preview.records, previewFps: preview.fps, previewName: exportsInfo.previewName, qa: qa.rules, soundMode: sound.summary.mode });
    writeFileSync(join(session.out, 'gate-report.txt'), renderStageReport(manifest, gate, { out: session.out, previewName: exportsInfo.previewName }));
    const code = gate.failed.length ? EXIT.GATE_FAIL_QA : EXIT.OK;
    writeRunState(session.out, { exitCode: code, mode: session.mode, round: session.round, finished: true, failed: gate.failed, withheld: gate.withhold, path: 'stage' });
    console.log(`motion stage ${gate.failed.length ? `QA FAIL (${gate.failed.join(', ')})` : 'QA PASS'}; report ${join(session.out, 'gate-report.txt')}${gate.withhold ? '; exports WITHHELD in withheld/' : ''}`);
    console.log(`frame time p50 ${manifest.frameTimeMs.p50} ms, p95 ${manifest.frameTimeMs.p95} ms; master ${session.masterSec.toFixed(1)} s for ${session.totalFrames} frames`);
    console.log('View the new stills set and record the last look round with `look` before `complete`.');
    return code;
  } catch (error) {
    const code = error.exitCode ?? 1;
    console.error(error.exitCode ? error.message : `motion internal error: ${error.stack || error.message}`);
    writeRunState(session.out, { exitCode: code, mode: session.mode, round: session.round, finished: true, failed: [], path: 'stage', message: String(error.message).split('\n')[0] });
    return code;
  }
}

// `gate --out DIR` on a stage render: re-measure the exports and the sound,
// reuse the recorded frame, preview and text-QA rows, and rewrite only the
// report (manifest.json stays, so a recorded look round stays valid).
export async function stageRegate(out) {
  try {
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    const { treatment } = loadTreatment(out, EXIT.BLOCKED_TREATMENT_INVALID);
    const data = JSON.parse(readFileSync(join(out, '.run', 'gate-data.json'), 'utf8'));
    const records = readFileSync(join(out, 'render.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const where = (name) => [join(out, name), join(out, 'withheld', name)].find((f) => existsSync(f));
    const film = where('film.mp4'), prev = where(data.previewName), poster = where('poster.png'), reduced = where('reduced-motion.png');
    const exportsInfo = { probe: film ? ffprobe(film) : null, sizes: { film: film && statSync(film).size, preview: prev && statSync(prev).size, poster: poster && statSync(poster).size, reduced: reduced && statSync(reduced).size }, previewName: data.previewName };
    const sound = data.soundMode === 'none' || !film ? { rules: [{ id: 'sound-stream', status: 'PASS', detail: 'no sound planned' }] } : { rules: soundGate({ file: film, mode: data.soundMode }).rules };
    const gate = runStageGate({ manifest, treatment, records, previewRecords: data.previewRecords, previewFps: data.previewFps, exports: exportsInfo, sound, qa: { rules: data.qa } });
    writeFileSync(join(out, 'gate-report.txt'), renderStageReport(manifest, gate, { out, previewName: data.previewName }));
    const code = gate.failed.length ? EXIT.GATE_FAIL_QA : EXIT.OK;
    writeRunState(out, { exitCode: code, mode: manifest.mode, round: manifest.round, finished: true, failed: gate.failed, withheld: gate.withhold, path: 'stage' });
    console.log(readFileSync(join(out, 'gate-report.txt'), 'utf8'));
    return code;
  } catch (error) {
    console.error(error.exitCode ? error.message : `motion internal error: ${error.stack || error.message}`);
    return error.exitCode ?? 1;
  }
}

function promoteStage(out, { withhold, previewName }) {
  const destination = withhold ? join(out, 'withheld') : out;
  mkdirSync(destination, { recursive: true });
  for (const name of ['film.mp4', previewName, 'poster.png', 'reduced-motion.png']) {
    const staged = join(out, '.run', name);
    if (withhold) rmSync(join(out, name), { force: true });
    if (!existsSync(staged)) continue;
    rmSync(join(destination, name), { force: true });
    writeFileSync(join(destination, name), readFileSync(staged));
    rmSync(staged, { force: true });
  }
  if (!withhold) rmSync(join(out, 'withheld'), { recursive: true, force: true });
}

// --detach: the same render in a detached child that writes progress and
// run-state.json; the caller polls them instead of holding a long call open.
async function detach(flags) {
  const { spawn } = await import('node:child_process');
  const out = resolve(flags.out || 'motion-output');
  mkdirSync(join(out, '.run'), { recursive: true });
  const args = [join(here, '..', 'bin', 'motion.mjs'), 'stage', '--out', out, '--round', String(flags.round || 1), ...(flags['stills-only'] ? ['--stills-only'] : [])];
  const log = join(out, '.run', 'stage.log');
  const { openSync } = await import('node:fs');
  const fd = openSync(log, 'w');
  const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  console.log(`stage render detached (pid ${child.pid}); poll ${join(out, '.run', 'progress.json')} and ${join(out, 'run-state.json')} (finished: true); log ${log}`);
  return 0;
}
