// Cover capture. One headless Chrome per pass, on the stage path's software rung (so two captures
// can only differ because of the page), laid out at the cover's page size in CSS px and captured
// at device scale 2. The page is served from the synthetic stage origin through CDP request
// interception (no socket listens), with the loop kit at /lit/loop-kit.js and the faces at
// /lit/fonts.css; the cover init script runs before any page script. The renderer SEEKS: it calls
// window.renderFrame(t, { mask }) for any t in [0, 1), in any order, and a worker pool brings each
// capture down to the cover size with Lanczos and writes it as a PNG. The master, the replay and
// the seek-order pass each open their own browser.
import { mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { EXIT } from './constants.mjs';
import { chromeExecutable, launchCause } from './browser.mjs';
import { CONTENT_TYPES, ORIGIN, stageFile, stageFlags } from './stage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fail = (code, message) => Object.assign(new Error(message), { exitCode: code });
const within = (promise, ms, message) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms).unref())]);

export const coverFlags = ({ width, height, scale }) => stageFlags({ width, height })
  .map((flag) => (flag === '--force-device-scale-factor=1' ? `--force-device-scale-factor=${scale}` : flag));

// The init script as Chrome runs it, plus a paint wait that keeps the native frame callback the
// init script takes away from the page.
function initSource() {
  const init = readFileSync(join(here, 'cover-init.js'), 'utf8').replace(/^\/\/.*\n/gmu, '').trim();
  const paint = 'const nativeRAF = window.requestAnimationFrame.bind(window); window.__litCoverPaint = () => new Promise((done) => nativeRAF(() => nativeRAF(done)));';
  return `(() => { ${paint} })(); try { ${init}(); } catch (error) { window.__litCoverInitError = String(error && error.stack || error); }`;
}

export async function openCover({ runtime, coverDir, fonts, width, height, scale, profileRoot, env = process.env }) {
  const chrome = chromeExecutable(env);
  if (!chrome) throw fail(EXIT.BLOCKED_NO_CHROME, 'BLOCKED_NO_CHROME: Chrome/Chromium not found; install Chrome or set CHROME_PATH');
  const { chromium } = runtime('playwright-core');
  mkdirSync(profileRoot, { recursive: true });
  const profile = join(profileRoot, 'p');
  const flags = coverFlags({ width, height, scale });
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: chrome, headless: true, chromiumSandbox: true, args: flags, timeout: 30000,
      viewport: { width, height }, deviceScaleFactor: scale, serviceWorkers: 'block',
    });
  } catch (error) {
    rmSync(profile, { recursive: true, force: true });
    throw fail(EXIT.BLOCKED_NO_CHROME, `BLOCKED_NO_CHROME: headless Chrome failed to launch on the software rung: ${launchCause(error)}`);
  }
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(0);
  const cdp = await context.newCDPSession(page);
  const kit = readFileSync(join(here, 'loop-kit.js'));
  const root = realpathSync(coverDir);
  const refused = [], contract = [], errors = [];
  page.on('pageerror', (error) => errors.push(String(error.message || error).split('\n')[0]));
  cdp.on('Fetch.requestPaused', async ({ requestId, request }) => {
    let url = null;
    try { url = new URL(request.url); } catch { /* an unparsable URL is refused below */ }
    if (!url || url.origin !== ORIGIN) {
      refused.push(request.url.slice(0, 160));
      return cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    }
    const reply = (status, type, body) => cdp.send('Fetch.fulfillRequest', {
      requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Cache-Control', value: 'no-store' }],
      body: Buffer.from(body).toString('base64'),
    }).catch(() => {});
    const path = decodeURIComponent(url.pathname);
    if (path === '/lit/loop-kit.js') return reply(200, CONTENT_TYPES['.js'], kit);
    if (path === '/lit/fonts.css') return reply(200, CONTENT_TYPES['.css'], fonts.css);
    if (fonts.routes.has(path)) return reply(200, CONTENT_TYPES[`.${path.split('.').pop()}`] || 'font/ttf', readFileSync(fonts.routes.get(path)));
    const found = stageFile(root, path);
    if (found.status === 403) { contract.push(found.reason); return reply(403, 'text/plain', 'forbidden'); }
    if (found.status === 404) return reply(404, 'text/plain', 'not found');
    return reply(200, found.type, readFileSync(found.file));
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await page.addInitScript({ content: initSource() });

  const evaluate = (fn, arg, what) => within(page.evaluate(fn, arg), 120000, `the cover page did not answer within 120 s (${what})`);
  const browser = {
    flags, errors,
    // Throw the named exit for anything a cover page may not do.
    async check(where) {
      if (refused.length) throw fail(EXIT.STAGE_NETWORK_REQUEST, `STAGE_NETWORK_REQUEST: the cover page requested ${refused[0]}${refused.length > 1 ? ` (+${refused.length - 1} more)` : ''} ${where}; everything is local`);
      if (contract.length) throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: ${contract[0]}`);
      const misuse = await evaluate(() => (window.__litCoverMisuse ? window.__litCoverMisuse() : []), null, 'misuse check').catch(() => []);
      if (misuse.length) throw fail(EXIT.STAGE_NONDETERMINISTIC, `STAGE_NONDETERMINISTIC: the cover page called ${misuse.join(', ')} ${where}; a cover frame is a function of t alone (LitLoop.rng(seed) for layout)`);
    },
    async load() {
      await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'load', timeout: 120000 });
      const deadline = Date.now() + 60000;
      for (;;) {
        const state = await evaluate(() => ({ ready: window.ready === true, render: typeof window.renderFrame, init: window.__litCoverInitError || null }), null, 'ready');
        if (state.init) throw fail(1, `cover init failed: ${state.init}`);
        // A page that threw before it was ready (for example ART.lights has no entry for the hero
        // bay N) never becomes ready; say so now instead of after the 60 s wait.
        if (!state.ready && errors.length) {
          await browser.check('while loading');
          throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: the cover page threw before it set window.ready, so it stopped at once instead of waiting 60 s; first page error: ${errors[0]}`);
        }
        if (state.ready) {
          await browser.check('while loading');
          if (state.render !== 'function') throw fail(EXIT.STAGE_CONTRACT_ERROR, 'STAGE_CONTRACT_ERROR: the cover page set window.ready but defines no window.renderFrame(t)');
          return;
        }
        if (Date.now() > deadline) {
          await browser.check('while loading');
          throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: the cover page never set window.ready = true within 60 s${errors.length ? `; first page error: ${errors[0]}` : ''}`);
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    // Draw loop time t (or its title mask) and wait until it is painted.
    async frame(t, { mask = false } = {}) {
      const at = `at t = ${t.toFixed(4)}`;
      try {
        await evaluate(async ([time, m]) => {
          await window.renderFrame(time, { mask: m });
          if (document.fonts) await document.fonts.ready;
          await window.__litCoverPaint();
        }, [t, mask], at);
      } catch (error) {
        await browser.check(at);
        throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: renderFrame(${t.toFixed(4)}${mask ? ', { mask: true }' : ''}) threw: ${String(error.message).split('\n')[0]}`);
      }
      await browser.check(at);
    },
    async capture() {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, captureBeyondViewport: false, fromSurface: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
      return Buffer.from(shot.data, 'base64');
    },
    async close() {
      await context.close().catch(() => {});
      rmSync(profile, { recursive: true, force: true });
    },
  };
  try { await browser.load(); } catch (error) { await browser.close(); throw error; }
  return browser;
}

// Workers that downsample a 2x capture to the cover size and write it as an RGB PNG.
export class CoverPool {
  constructor(size = Math.max(2, Math.min(4, cpus().length - 2))) {
    this.workers = Array.from({ length: size }, () => new Worker(new URL('./cover-worker.mjs', import.meta.url)));
    this.turn = 0;
    this.id = 0;
    this.waiting = new Map();
    for (const worker of this.workers) {
      worker.on('message', (msg) => {
        const job = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        if (msg.error) job.reject(new Error(msg.error)); else job.resolve(msg);
      });
      worker.on('error', (error) => { for (const job of this.waiting.values()) job.reject(error); this.waiting.clear(); });
    }
  }

  run(png, width, height, file) {
    const id = ++this.id, worker = this.workers[this.turn++ % this.workers.length];
    const copy = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
    return new Promise((resolve, reject) => { this.waiting.set(id, { resolve, reject }); worker.postMessage({ id, png: copy, width, height, file }, [copy]); });
  }

  async close() { await Promise.all(this.workers.map((w) => w.terminate())); }
}

export const frameName = (prefix, index) => `${prefix}${String(index).padStart(4, '0')}.png`;

// Capture [index, t] pairs in the given order into dir as <prefix><index>.png at the cover size;
// returns Map index -> SHA-256 of the written PNG.
export async function capturePass({ browser, pool, times, dir, prefix = 'f', mask = false, size, page, scale }) {
  mkdirSync(dir, { recursive: true });
  const hashes = new Map(), jobs = [];
  const expected = `${page[0] * scale}x${page[1] * scale}`;
  for (const [index, t] of times) {
    await browser.frame(t, { mask });
    const png = await browser.capture();
    const job = pool.run(png, size[0], size[1], join(dir, frameName(prefix, index))).then((r) => {
      if (r.captured !== expected) throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: a capture came back ${r.captured}, not ${expected}; the page must not resize its viewport`);
      hashes.set(index, r.sha256);
    });
    job.catch(() => {}); // awaited below; this only keeps an early failure from going unhandled
    jobs.push(job);
    if (jobs.length > 8) await jobs.shift();
  }
  await Promise.all(jobs);
  return hashes;
}
