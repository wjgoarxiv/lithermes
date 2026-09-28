// Headless Chrome driver (the driver half of pdoom's scripts/render.ts, MIT,
// see NOTICE). Chrome is launched over the pipe transport, so no control port
// listens; frames leave the page over a WebSocket bound to 127.0.0.1:0
// (MO-A-02 option 1) or, when listen() is refused, through a per-frame CDP
// pull of the same readback buffer (the sanctioned variant). Each MO-A-51 rung
// counts only after a real getContext('webgl2') in the page.
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT, UNKNOWN_RENDERER, chromeFlagLadder, isSoftwareRenderer } from './constants.mjs';

export const blocked = (code, message) => Object.assign(new Error(message), { exitCode: code });

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];

export function chromeExecutable(env = process.env) {
  if (env.CHROME_PATH) return existsSync(env.CHROME_PATH) ? env.CHROME_PATH : null;
  return CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) || null;
}

// The launcher's first line that names a cause. Crashpad's own complaints are
// a side effect of a failed launch, never the cause, so they rank last.
export function launchCause(error) {
  const lines = String(error?.message || error).split('\n').map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(Boolean);
  const strong = /sandbox initialization failed|Failed to initialize sandbox|error while loading shared|cannot open shared object|No usable sandbox|Permission denied|EACCES|ENOENT|spawn .* (?:ENOENT|EACCES)|Executable doesn't exist/i;
  const hit = lines.find((line) => strong.test(line) && !/Crashpad/i.test(line));
  if (hit) return hit.replace(/^-\s*(?:\[pid=\d+\])?(?:\[err\])?\s*/, '');
  const err = lines.find((line) => /\[err\]/.test(line) && !/Crashpad/i.test(line));
  if (err) return err.replace(/^-\s*(?:\[pid=\d+\])?(?:\[err\])?\s*/, '');
  return lines[0] || 'unknown launch failure';
}

const probeScript = () => {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { webgl2: false, renderer: null };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { webgl2: true, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null };
};

// Walk the flag ladder; returns { context, page, flags, renderer } or throws 10/11.
export async function launchChrome({ chromium, profileRoot, forceSoftware = false, platform = process.platform, env = process.env, timeoutMs = 30000 }) {
  const chrome = chromeExecutable(env);
  if (!chrome) throw blocked(EXIT.BLOCKED_NO_CHROME, 'BLOCKED_NO_CHROME: Chrome/Chromium not found; install Chrome or set CHROME_PATH');
  const ladder = chromeFlagLadder(platform);
  const rungs = forceSoftware ? ladder.slice(-1) : ladder;
  const attempts = [];
  let launchedWithoutWebgl = null;
  mkdirSync(profileRoot, { recursive: true });
  for (let i = 0; i < rungs.length; i++) {
    const flags = rungs[i];
    const profile = join(profileRoot, `p${i}`);
    let context = null;
    try {
      context = await chromium.launchPersistentContext(profile, {
        executablePath: chrome, headless: true, chromiumSandbox: true, args: flags, timeout: timeoutMs,
        viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
      });
      const page = context.pages()[0] || await context.newPage();
      const probe = await page.evaluate(probeScript);
      if (probe.webgl2) {
        return { context, page, flags, profile, chrome, renderer: probe.renderer || UNKNOWN_RENDERER, attempts };
      }
      launchedWithoutWebgl = `Chrome launched with ${flags[0]} but canvas.getContext('webgl2') returned null`;
      attempts.push({ flags, result: 'no-webgl2' });
    } catch (error) {
      attempts.push({ flags, result: 'launch-failed', cause: launchCause(error) });
    }
    await context?.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  }
  if (launchedWithoutWebgl) throw blocked(EXIT.BLOCKED_NO_WEBGL2, `BLOCKED_NO_WEBGL2: ${launchedWithoutWebgl}`);
  const cause = attempts.find((a) => a.cause)?.cause || 'Chrome did not start';
  throw blocked(EXIT.BLOCKED_NO_CHROME, `BLOCKED_NO_CHROME: headless Chrome failed to launch on every rung (${rungs.map((r) => r[0]).join(', ')}): ${cause}`);
}

// Unix sockets Chrome left in the profile (or behind its symlinks) and their path lengths.
export function profileSockets(profile) {
  const out = [];
  const visit = (dir, depth) => {
    if (depth > 2 || !existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      let st;
      try { st = lstatSync(path); } catch { continue; }
      if (st.isSocket()) out.push({ path, bytes: Buffer.byteLength(path) });
      else if (st.isSymbolicLink() && /Singleton/.test(name)) {
        const target = readlinkSync(path);
        if (target.startsWith('/')) out.push({ path: target, bytes: Buffer.byteLength(target), via: path });
      } else if (st.isDirectory()) visit(path, depth + 1);
    }
  };
  visit(profile, 0);
  return out;
}

export async function openRenderer({ runtime, pageScript, profileRoot, scale = 1, forceSoftware = false, env = process.env }) {
  const { chromium } = runtime('playwright-core');
  const launched = await launchChrome({ chromium, profileRoot, forceSoftware, env });
  const { context, page } = launched;
  page.setDefaultTimeout(0);
  await page.addScriptTag({ path: pageScript });
  const setup = await page.evaluate((config) => window.motionSetup(config), { width: 1920, height: 1080, scale });
  if (!setup.webgl2 || setup.error) {
    await context.close().catch(() => {});
    throw blocked(EXIT.BLOCKED_NO_WEBGL2, `BLOCKED_NO_WEBGL2: ${setup.error || 'no WebGL2 context in the render page'} (renderer: ${setup.renderer || launched.renderer})`);
  }
  const renderer = setup.renderer || launched.renderer;
  const sockets = profileSockets(launched.profile);
  let server = null, egress = 'websocket', listenError = null, pending = null;
  try {
    const { WebSocketServer } = runtime('ws');
    if (env.LITHERMES_MOTION_FAULT_LISTEN) {
      throw Object.assign(new Error(`listen ${env.LITHERMES_MOTION_FAULT_LISTEN}: operation not permitted 127.0.0.1:0 (injected)`), { code: env.LITHERMES_MOTION_FAULT_LISTEN });
    }
    server = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 1920 * 1080 * 4 * scale * scale + 1024 });
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    server.on('connection', (socket) => {
      socket.on('message', (data) => {
        const current = pending;
        pending = null;
        current?.resolve(Buffer.isBuffer(data) ? data : Buffer.from(data));
      });
    });
    await page.evaluate((port) => window.motionConnect(port), server.address().port);
  } catch (error) {
    listenError = `${error.code || 'error'}: ${String(error.message).split('\n')[0]}`;
    try { server?.close(); } catch {}
    server = null;
    egress = 'cdp-pull';
  }
  let lastFrame = null;
  return {
    renderer, flags: launched.flags, software: isSoftwareRenderer(renderer), egress, listenError, sockets, attempts: launched.attempts,
    get lastFrame() { return lastFrame; },
    async frame(spec) {
      spec.egress = egress;
      if (spec.prime) {
        await page.evaluate((s) => window.motionFrame(s), spec);
        lastFrame = spec.frame;
        return null;
      }
      if (server) {
        const bytes = new Promise((resolve, reject) => { pending = { resolve, reject }; });
        const meta = await page.evaluate((s) => window.motionFrame(s), spec);
        lastFrame = spec.frame;
        return { bytes: await bytes, meta };
      }
      let meta;
      try {
        meta = await page.evaluate((s) => window.motionFrame(s), spec);
      } catch (error) {
        throw blocked(EXIT.BLOCKED_NO_WEBGL2, `frame egress failed after listen was refused (${listenError}): ${String(error.message).split('\n')[0]}`);
      }
      lastFrame = spec.frame;
      const bytes = Buffer.from(meta.rgbaBase64, 'base64');
      delete meta.rgbaBase64;
      return { bytes, meta };
    },
    async close() {
      try { server?.close(); } catch {}
      await context.close().catch(() => {});
      rmSync(launched.profile, { recursive: true, force: true });
    },
  };
}
