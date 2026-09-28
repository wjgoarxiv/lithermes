// Stage init script: evaluated in every stage document before any page script
// (Playwright addInitScript carrying this script's own clock, not page.clock). It replaces the page's clocks
// with one virtual clock, seeds Math.random, stubs every forbidden media,
// worker and socket API (recording a violation), watches for forbidden
// elements, and exposes step(t), the per-frame algorithm the renderer drives.
// The renderer calls this function expression with its config object.
(function litStageInit(cfg) {
  'use strict';
  const S = (window.__litStage = window.__litStage || {});
  Object.assign(S, { now: 0, film: S.film || null, violations: [], errors: [], canvasTexts: [], webglRequested: false, webglNull: false });
  const anims = new Map();
  const svgBirth = new Map();
  const record = (what) => { if (!S.violations.includes(what)) S.violations.push(what); };
  const report = (error) => { S.errors.push(String((error && error.stack) || error).split('\n').slice(0, 3).join(' | ')); };

  // --- clocks -----------------------------------------------------------------
  const NativeDate = Date;
  const epoch = cfg.epochMs;
  function VirtualDate(...args) {
    if (!new.target) return new NativeDate(epoch + S.now * 1000).toString();
    return Reflect.construct(NativeDate, args.length ? args : [epoch + S.now * 1000], new.target);
  }
  VirtualDate.prototype = NativeDate.prototype;
  VirtualDate.now = () => epoch + S.now * 1000;
  VirtualDate.parse = NativeDate.parse;
  VirtualDate.UTC = NativeDate.UTC;
  Object.defineProperty(window, 'Date', { value: VirtualDate, writable: true, configurable: true });
  Object.defineProperty(Performance.prototype, 'now', { value: function now() { return S.now * 1000; }, writable: true, configurable: true });
  try {
    Object.defineProperty(document.timeline, 'currentTime', { get() { return S.now * 1000; }, configurable: true });
  } catch (error) { report(error); }

  const timers = new Map();
  let nextTimer = 1;
  const schedule = (fn, ms, args, repeat) => {
    const id = nextTimer++;
    const call = typeof fn === 'function' ? fn : () => (0, eval)(String(fn));
    const delay = Math.max(0, Number(ms) || 0) / 1000;
    timers.set(id, { due: S.now + delay, call, args, every: repeat ? Math.max(0.001, delay) : 0 });
    return id;
  };
  window.setTimeout = (fn, ms, ...args) => schedule(fn, ms, args, false);
  window.setInterval = (fn, ms, ...args) => schedule(fn, ms, args, true);
  window.clearTimeout = (id) => { timers.delete(id); };
  window.clearInterval = (id) => { timers.delete(id); };
  function runTimers() {
    for (let guard = 0; guard < 20000; guard++) {
      let pick = null;
      for (const [id, timer] of timers) {
        if (timer.due > S.now + 1e-9) continue;
        if (!pick || timer.due < pick[1].due || (timer.due === pick[1].due && id < pick[0])) pick = [id, timer];
      }
      if (!pick) return;
      const [id, timer] = pick;
      if (timer.every) timer.due += timer.every; else timers.delete(id);
      try { timer.call(...timer.args); } catch (error) { report(error); }
    }
    record('a timer loop that never settles');
  }

  const nativeRAF = window.requestAnimationFrame.bind(window);
  S.nativeRAF = nativeRAF;
  const rafs = new Map();
  let nextRaf = 1;
  window.requestAnimationFrame = (fn) => { const id = nextRaf++; rafs.set(id, fn); return id; };
  window.cancelAnimationFrame = (id) => { rafs.delete(id); };
  const idles = new Map();
  let nextIdle = 1;
  window.requestIdleCallback = (fn) => { const id = nextIdle++; idles.set(id, fn); return id; };
  window.cancelIdleCallback = (id) => { idles.delete(id); };
  function runFrameCallbacks() {
    const due = [...rafs.values()];
    rafs.clear();
    for (const fn of due) { try { fn(S.now * 1000); } catch (error) { report(error); } }
    const idle = [...idles.values()];
    idles.clear();
    for (const fn of idle) { try { fn({ didTimeout: false, timeRemaining: () => 0 }); } catch (error) { report(error); } }
  }

  // mulberry32 seeded from the treatment.
  let seed = cfg.seed >>> 0;
  Math.random = function random() {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // --- forbidden APIs and elements ------------------------------------------
  const forbid = (name) => {
    try {
      Object.defineProperty(window, name, {
        configurable: true, writable: true,
        value: function forbidden() { record(name); throw new Error(`${name} is not allowed on the stage`); },
      });
    } catch (error) { report(error); }
  };
  ['Audio', 'AudioContext', 'webkitAudioContext', 'OfflineAudioContext', 'Worker', 'SharedWorker', 'WebSocket', 'WebTransport', 'RTCPeerConnection', 'webkitRTCPeerConnection'].forEach(forbid);
  try {
    Object.defineProperty(Navigator.prototype, 'serviceWorker', {
      configurable: true,
      get() {
        record('serviceWorker');
        return { register: () => Promise.reject(new Error('service workers are not allowed on the stage')), getRegistrations: () => Promise.resolve([]), ready: new Promise(() => {}) };
      },
    });
  } catch (error) { report(error); }
  const FORBIDDEN_TAGS = new Set(['VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED', 'FRAME']);
  const scan = (node) => {
    if (node.nodeType !== 1) return;
    if (FORBIDDEN_TAGS.has(node.tagName)) record(`<${node.tagName.toLowerCase()}>`);
    for (const inner of node.querySelectorAll ? node.querySelectorAll('video,audio,iframe,object,embed,frame') : []) record(`<${inner.tagName.toLowerCase()}>`);
  };
  new MutationObserver((list) => { for (const m of list) m.addedNodes.forEach(scan); }).observe(document, { childList: true, subtree: true });

  // Canvas text is invisible to the text QA unless registered; count the draws
  // so an unregistered one can be reported.
  S.canvasTextCalls = 0;
  for (const name of ['fillText', 'strokeText']) {
    const original = CanvasRenderingContext2D.prototype[name];
    CanvasRenderingContext2D.prototype[name] = function countedText(...args) { S.canvasTextCalls++; return original.apply(this, args); };
  }

  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (/webgl/i.test(String(type))) { S.webglRequested = true; if (!ctx) S.webglNull = true; }
    return ctx;
  };

  // --- the per-frame step ----------------------------------------------------
  const settle = async () => { for (let k = 0; k < 4; k++) await Promise.resolve(); };
  const decodes = new WeakSet();

  // Before frame 0: every declared face loaded, every image decoded and eager.
  S.prepare = async (imageUrls) => {
    await Promise.all([...document.fonts].map((face) => face.load().catch((error) => report(`font ${face.family}: ${error.message}`))));
    await document.fonts.ready;
    await Promise.all((imageUrls || []).map((url) => { const img = new Image(); img.src = url; return img.decode().catch((error) => report(`image ${url}: ${error.message}`)); }));
    for (const img of document.images) { img.loading = 'eager'; }
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    return { faces: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family}|${f.weight}|${f.stretch}`) };
  };

  S.step = async (t, { paint = true } = {}) => {
    S.now = t;
    S.canvasTexts.length = 0;
    // Tracked animations follow the virtual clock from their own birth; one
    // that crosses its end is finished once so its promise chain continues.
    for (const [a, rec] of anims) {
      if (rec.done) continue;
      const local = (t - rec.birth) * 1000;
      try {
        if (local >= rec.end) { a.finish(); rec.done = true; await settle(); } else a.currentTime = local;
      } catch (error) { report(error); rec.done = true; }
    }
    for (const svg of document.querySelectorAll('svg')) {
      if (svg.ownerSVGElement) continue;
      if (!svgBirth.has(svg)) svgBirth.set(svg, t);
      svg.pauseAnimations();
      svg.setCurrentTime(t - svgBirth.get(svg));
    }
    runTimers();
    runFrameCallbacks();
    const film = S.film || window.litStage;
    if (film && typeof film.render === 'function') { try { film.render(t); } catch (error) { report(error); } }
    getComputedStyle(document.documentElement).getPropertyValue('opacity');
    for (const a of document.getAnimations()) {
      if (anims.has(a)) continue;
      a.pause();
      const end = a.effect ? a.effect.getComputedTiming().endTime : 0;
      anims.set(a, { birth: t, end: Number.isFinite(end) ? end : Infinity, done: false });
      a.currentTime = 0;
    }
    document.documentElement.getBoundingClientRect();
    await document.fonts.ready;
    const pending = [];
    for (const img of document.images) if (!decodes.has(img) && img.src) { decodes.add(img); pending.push(img.decode().catch(() => {})); }
    await Promise.all(pending);
    if (paint) await new Promise((resolve) => nativeRAF(() => nativeRAF(resolve)));
    return { violations: S.violations.slice(), errors: S.errors.splice(0), webglNull: S.webglNull };
  };

  S.film = S.film || null;
})
