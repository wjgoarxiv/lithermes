// DOM text QA for the stage path. It runs in its own replay Chrome (the master
// capture never has a style touched), stepping the clock from 0 like the
// master. At every beat midpoint plus two settled frames per beat it captures
// the frame (A), hides only the text fill, captures again (B), and takes the
// pixels that differ as the ink. Text runs are also read at 10 fps for the
// reading floor and for the copy-found check.
import { EXIT } from './constants.mjs';
import { measureContrast } from './gate.mjs';
import { readingFloor } from './type.mjs';
import { normalizeText } from './treatment.mjs';

const fail = (code, message) => Object.assign(new Error(message), { exitCode: code });
const INTERNAL_TERMS = /(?<![a-z])(?:path|preset|gate|beat|treatment)s?(?![a-z])|트리트먼트|프리셋/iu;
const FILE_NAME = /(?<![\w/])[\w-]+\.(?:html?|json|js|mjs|css|png|jpe?g|webp|svg|wav|mp4|md|txt)(?![\w])/iu;

// Page side: collect visible text runs. A run is the nearest LitStage.text
// element, else the nearest block-level ancestor (an SVG <text> is its own
// run); keyed by normalized text plus a coarse position bucket.
const PAGE_QA = String(function install() {
  if (window.__litQa) return;
  const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const blockish = (el) => {
    if (el instanceof SVGElement) return el.tagName.toLowerCase() === 'text';
    const d = getComputedStyle(el).display;
    return !d.startsWith('inline') && d !== 'contents';
  };
  const runOf = (node) => {
    let el = node.parentElement;
    const marked = el && el.closest('[data-lit-text]');
    if (marked) return marked;
    while (el && el !== document.body && !blockish(el)) el = el.parentElement;
    return el || document.body;
  };
  const opacityChain = (el) => {
    let o = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      o *= Number(cs.opacity);
      if (e.tagName && e.tagName.toLowerCase() === 'svg' && e.getAttribute('opacity')) o *= Number(e.getAttribute('opacity'));
    }
    return o;
  };
  const clipRects = (el, rects) => {
    let out = rects.map((r) => [r.left, r.top, r.right, r.bottom]);
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflow !== 'visible' || cs.clipPath !== 'none') {
        const b = e.getBoundingClientRect();
        out = out.map(([x0, y0, x1, y1]) => [Math.max(x0, b.left), Math.max(y0, b.top), Math.min(x1, b.right), Math.min(y1, b.bottom)]);
      }
    }
    return out.map(([x0, y0, x1, y1]) => [Math.max(0, x0), Math.max(0, y0), Math.min(innerWidth, x1), Math.min(innerHeight, y1)]).filter(([x0, y0, x1, y1]) => x1 - x0 >= 1 && y1 - y0 >= 1);
  };
  const scaleOf = (el) => {
    if (el instanceof SVGGraphicsElement && el.getScreenCTM) { const m = el.getScreenCTM(); return m ? Math.hypot(m.a, m.b) : 1; }
    const w = el.offsetWidth, r = el.getBoundingClientRect();
    return w > 0 ? r.width / w : 1;
  };
  let nextId = 1;
  window.__litQa = {
    runs() {
      const groups = new Map();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        const p = node.parentElement;
        if (!p || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(p.tagName)) continue;
        const run = runOf(node);
        const range = document.createRange();
        range.selectNodeContents(node);
        const g = groups.get(run) || { el: run, rects: [] };
        g.rects.push(...range.getClientRects());
        groups.set(run, g);
      }
      for (const el of document.querySelectorAll('*')) {
        for (const pseudo of ['::before', '::after']) {
          const c = getComputedStyle(el, pseudo).content;
          if (!c || c === 'none' || c === 'normal' || !/^["']/.test(c) || c.length <= 2) continue;
          const g = groups.get(el) || { el, rects: [], pseudo: '' };
          g.pseudo = `${g.pseudo || ''}${c.slice(1, -1)}`;
          if (!g.rects.length) g.rects.push(el.getBoundingClientRect());
          groups.set(el, g);
        }
      }
      const out = [];
      for (const g of groups.values()) {
        const el = g.el;
        if (!el.dataset.litQa) el.dataset.litQa = String(nextId++);
        const text = `${el.textContent || ''}${g.pseudo || ''}`.replace(/\s+/g, ' ').trim();
        const rects = clipRects(el, g.rects);
        const cs = getComputedStyle(el);
        const scale = scaleOf(el);
        const box = rects.length ? [Math.min(...rects.map((r) => r[0])), Math.min(...rects.map((r) => r[1])), Math.max(...rects.map((r) => r[2])), Math.max(...rects.map((r) => r[3]))] : null;
        out.push({
          id: el.dataset.litQa, text, norm: norm(text), decor: el.closest('[data-lit-text="decor"]') !== null,
          opacity: opacityChain(el), rects, box, fontSizePx: parseFloat(cs.fontSize) * scale, weight: Number(cs.fontWeight) || 400,
          bucket: box ? `${Math.round((box[0] + box[2]) / 200)}:${Math.round((box[1] + box[3]) / 200)}` : 'off',
          clipText: cs.backgroundClip === 'text' || cs.getPropertyValue('-webkit-background-clip') === 'text',
        });
      }
      const S = window.__litStage || {};
      for (const c of S.canvasTexts || []) {
        out.push({ id: `canvas:${c.content}`, text: c.content, norm: norm(c.content), decor: Boolean(c.decor), canvas: true, opacity: 1,
          rects: [[c.x, c.y, c.x + c.w, c.y + c.h]], box: [c.x, c.y, c.x + c.w, c.y + c.h], fontSizePx: c.h * 0.75, weight: 400, bucket: `c:${Math.round(c.x / 100)}:${Math.round(c.y / 100)}` });
      }
      return { runs: out, canvasTextCalls: S.canvasTextCalls || 0 };
    },
    hide() {
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (cs.backgroundClip === 'text' || cs.getPropertyValue('-webkit-background-clip') === 'text') el.dataset.litClipText = '1';
      }
      const before = new Set(document.getAnimations());
      const style = document.createElement('style');
      style.id = '__lit_qa_hide';
      style.textContent = '[data-lit-qa], [data-lit-qa] * { color: transparent !important; -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; }'
        + ' svg text, svg tspan, svg textPath { fill: transparent !important; stroke: transparent !important; }'
        + ' [data-lit-clip-text] { background-image: none !important; }';
      document.head.appendChild(style);
      getComputedStyle(document.documentElement).opacity;
      for (const a of document.getAnimations()) if (!before.has(a)) a.cancel();
      this.before = before;
    },
    show() {
      document.getElementById('__lit_qa_hide')?.remove();
      getComputedStyle(document.documentElement).opacity;
      for (const a of document.getAnimations()) if (!this.before.has(a)) a.cancel();
    },
    paint() { return new Promise((resolve) => (window.__litStage.nativeRAF || requestAnimationFrame)(() => (window.__litStage.nativeRAF || requestAnimationFrame)(resolve))); },
  };
});

function inkMask(a, b, width, height, rects) {
  const mask = Buffer.alloc(width * height);
  const inside = new Uint8Array(width * height);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) inside[y * width + x] = 1;
  }
  let ink = 0, outside = 0;
  for (let i = 0, p = 0; p < width * height; p++, i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (d > 2) { if (inside[p]) { mask[p] = 255; ink++; } else outside++; }
  }
  return { mask, ink, outside };
}

function lumStdOutside(rgba, width, height, rects) {
  let n = 0, sum = 0, sq = 0;
  const inRect = (x, y) => rects.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
  for (let y = 0; y < height; y += 4) for (let x = 0; x < width; x += 4) {
    if (inRect(x, y)) continue;
    const i = (y * width + x) * 4;
    const l = (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255;
    n++; sum += l; sq += l * l;
  }
  return n ? Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) : 0;
}

// Canvas text cannot be hidden, so its ink is the pixels inside the registered
// box that stand apart from the box's own border median.
function canvasMask(rgba, width, height, [x0, y0, x1, y1]) {
  const lum = (i) => 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  const border = [];
  for (let x = Math.floor(x0); x < x1; x += 2) for (const y of [Math.floor(y0), Math.ceil(y1) - 1]) if (x >= 0 && x < width && y >= 0 && y < height) border.push(lum((y * width + x) * 4));
  border.sort((a, b) => a - b);
  const ground = border[Math.floor(border.length / 2)] ?? 0;
  const mask = Buffer.alloc(width * height);
  let ink = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) {
    const p = y * width + x;
    if (Math.abs(lum(p * 4) - ground) > 40) { mask[p] = 255; ink++; }
  }
  return { mask, ink };
}

export async function runTextQa(session) {
  const [W, H] = session.size;
  const fps = session.fps;
  const short = Math.min(W, H);
  const treatment = session.treatment;
  const copyLines = treatment.copy.lines.map((line) => ({ line, norm: normalizeText(line) }));
  const isCopy = (norm) => norm && copyLines.some((c) => c.norm.includes(norm) || norm.includes(c.norm));
  const carriesCopy = (norm) => copyLines.some((c) => c.norm && norm.includes(c.norm));
  const samples = new Map();
  for (const b of session.beats) {
    const len = b.last - b.first;
    samples.set(b.mid, { beat: b.index, kind: 'mid' });
    for (const q of [0.35, 0.8]) { const f = b.first + Math.round(q * len); if (!samples.has(f)) samples.set(f, { beat: b.index, kind: 'settled' }); }
  }
  const tenFps = Math.max(1, Math.round(fps / 10));
  const visibleSpans = new Map();
  const seenCopy = new Set();
  const results = { contrast: [], safe: [], decorCopy: [], decorArea: [], meta: new Set(), fonts: [], moved: [], canvasUnmeasured: false, nonText: [], floors: [] };
  const stage = await session.open('q');
  const cdp = stage.cdp;
  const PNG = session.PNG;
  let allowedFonts = null;
  try {
    await stage.load();
    await stage.prepare([]);
    await stage.page.evaluate(`(${PAGE_QA})()`);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    allowedFonts = await faceNames(stage);
    const last = session.totalFrames - 1;
    let prevRuns = new Map();
    for (let f = 0; f <= last; f++) {
      const sample = samples.get(f);
      const probe = f % tenFps === 0 || sample;
      await stage.step(f / fps, true);
      if (!probe) continue;
      const { runs, canvasTextCalls } = await stage.page.evaluate(() => window.__litQa.runs());
      if (canvasTextCalls > 0 && !runs.some((r) => r.canvas)) results.canvasUnmeasured = true;
      const now = new Map();
      for (const run of runs) {
        const visible = run.opacity >= 0.6 && run.rects.length > 0;
        const key = `${run.norm}|${run.bucket}`;
        now.set(run.id, run);
        if (!visible || !run.norm) continue;
        if (isCopy(run.norm)) for (const c of copyLines) if (c.norm.includes(run.norm) || run.norm.includes(c.norm)) seenCopy.add(c.line);
        if (f % tenFps === 0) {
          const span = visibleSpans.get(key) || { text: run.text, norm: run.norm, decor: run.decor, frames: [] };
          span.frames.push(f);
          visibleSpans.set(key, span);
        }
        const n = run.norm;
        if (n && (n === normalizeText(treatment.request) || n.includes(normalizeText(treatment.request)) || (normalizeText(treatment.idea) && n.includes(normalizeText(treatment.idea))) || FILE_NAME.test(run.text) || INTERNAL_TERMS.test(run.text))) results.meta.add(run.text.slice(0, 60));
      }
      if (sample) {
        const a = PNG.sync.read(await stage.capture()).data;
        await stage.page.evaluate(() => window.__litQa.hide());
        await stage.page.evaluate(() => window.__litQa.paint());
        const b = PNG.sync.read(await stage.capture()).data;
        await stage.page.evaluate(() => window.__litQa.show());
        const visibleRuns = runs.filter((r) => r.opacity >= 0.6 && r.rects.length && r.norm);
        const domRects = visibleRuns.filter((r) => !r.canvas).flatMap((r) => r.rects);
        const whole = inkMask(a, b, W, H, domRects);
        const moved = whole.outside > 0;
        if (moved) results.moved.push(f);
        let textArea = 0, decorArea = 0;
        for (const run of visibleRuns) {
          const m = run.canvas ? canvasMask(a, W, H, run.box) : inkMask(a, b, W, H, run.rects);
          if (m.ink < 12) continue;
          const area = (run.box[2] - run.box[0]) * (run.box[3] - run.box[1]);
          textArea += area;
          const copy = !run.decor && (isCopy(run.norm) || !run.canvas);
          if (run.decor) {
            decorArea += area;
            if (carriesCopy(run.norm)) results.decorCopy.push(`${run.text.slice(0, 40)}@${f}`);
          }
          const [x0, y0, x1, y1] = run.box;
          if (!run.decor && (x0 < 0.05 * W - 0.5 || y0 < 0.05 * H - 0.5 || x1 > 0.95 * W + 0.5 || y1 > 0.95 * H + 0.5)) results.safe.push({ text: run.text.slice(0, 40), frame: f, box: run.box.map(Math.round), copy });
          const before = prevRuns.get(run.id);
          const settled = run.opacity >= 0.95 && (!before || !before.box || Math.max(...run.box.map((v, i) => Math.abs(v - before.box[i]))) < 2);
          if (!moved && settled) {
            const ratio = measureContrast(a, m.mask, W, H, { bbox: run.box, capHeightPx: run.fontSizePx, fill: 'flat', fontSizePx: run.fontSizePx, weight: run.weight }, 1);
            if (ratio) {
              const floor = run.fontSizePx >= 0.03 * short ? 3.0 : 4.5;
              results.contrast.push({ text: run.text.slice(0, 40), frame: f, ratio: ratio.ratio, floor, copy, decor: run.decor, fontSizePx: Number(run.fontSizePx.toFixed(1)) });
            }
          }
          if (sample.kind === 'mid' && !run.canvas) {
            const fonts = await platformFonts(cdp, run.id);
            const foreign = fonts.filter((name) => !allowedFonts.has(name));
            if (foreign.length) results.fonts.push({ text: run.text.slice(0, 40), frame: f, fonts: foreign, copy });
          }
        }
        if (textArea > 0 && decorArea / textArea > 0.25) results.decorArea.push(`${Math.round((100 * decorArea) / textArea)} % at frame ${f}`);
        if (sample.kind === 'mid') results.nonText.push(lumStdOutside(b, W, H, visibleRuns.flatMap((r) => r.rects)));
      }
      prevRuns = now;
    }
  } finally {
    await stage.close();
  }

  // Reading floor on the longest continuous 10 fps span of each copy run.
  for (const span of visibleSpans.values()) {
    if (span.decor || !isCopy(span.norm)) continue;
    let best = 0, run = 0;
    span.frames.forEach((f, i) => { run = i && f - span.frames[i - 1] === tenFps ? run + 1 : 1; best = Math.max(best, run); });
    const seconds = best / 10, floor = readingFloor(span.text, 'line');
    if (seconds + 0.1 < floor) results.floors.push({ text: span.text.slice(0, 40), seconds, floor: Number(floor.toFixed(2)) });
  }
  const missing = copyLines.filter((c) => !seenCopy.has(c.line));
  if (missing.length) throw fail(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: copy line not on screen: "${missing[0].line}"${missing.length > 1 ? ` (+${missing.length - 1} more)` : ''}; every copy.lines entry must appear as text the QA can read`);

  const rules = [];
  const row = (id, status, detail) => rules.push({ id, status, detail });
  const lowCopy = results.contrast.filter((c) => !c.decor && c.ratio < c.floor);
  const lowDecor = results.contrast.filter((c) => c.decor && c.ratio < c.floor);
  const worst = results.contrast.reduce((m, c) => (m && m.ratio / m.floor <= c.ratio / c.floor ? m : c), null);
  row('text-contrast', lowCopy.length ? 'FAIL' : lowDecor.length ? 'WARN' : 'PASS',
    lowCopy.length ? `"${lowCopy[0].text}" ${lowCopy[0].ratio}:1 at frame ${lowCopy[0].frame} (floor ${lowCopy[0].floor}:1)`
      : lowDecor.length ? `decor "${lowDecor[0].text}" ${lowDecor[0].ratio}:1 at frame ${lowDecor[0].frame}` : `${results.contrast.length} settled measurements${worst ? `; worst "${worst.text}" ${worst.ratio}:1 (floor ${worst.floor}:1)` : ''}`);
  const offSafe = results.safe;
  row('text-title-safe', offSafe.length ? 'FAIL' : 'PASS', offSafe.length ? `"${offSafe[0].text}" at frame ${offSafe[0].frame} box ${offSafe[0].box.join(',')} is outside the central 90 %` : 'all non-decor text inside the central 90 %');
  row('text-reading-floor', results.floors.length ? 'FAIL' : 'PASS', results.floors.length ? `"${results.floors[0].text}" on screen ${results.floors[0].seconds.toFixed(1)} s, needs ${results.floors[0].floor} s` : 'every copy line stays on screen at least its reading floor (10 fps, 0.1 s tolerance)');
  row('copy-found', 'PASS', `all ${copyLines.length} copy lines appear on screen`);
  row('decor-copy', results.decorCopy.length ? 'FAIL' : 'PASS', results.decorCopy.length ? `decor text carries a copy line: ${results.decorCopy[0]}` : 'no decor run carries a copy line');
  row('decor-area', results.decorArea.length ? 'FAIL' : 'PASS', results.decorArea.length ? `decor text is ${results.decorArea[0]} of the visible text area (limit 25 %)` : 'decor text stays within 25 % of the text area');
  row('meta-label', results.meta.size ? 'WARN' : 'PASS', results.meta.size ? `on screen: ${[...results.meta].slice(0, 3).map((t) => `"${t}"`).join(', ')} (request, idea, file name or internal term); the look must answer it` : 'no request text, file name or internal term on screen');
  const copyFonts = results.fonts.filter((f) => f.copy);
  row('fonts', copyFonts.length ? 'FAIL' : results.fonts.length ? 'WARN' : 'PASS', results.fonts.length ? `"${results.fonts[0].text}" uses ${results.fonts[0].fonts.join(', ')} at frame ${results.fonts[0].frame}; use the verified faces in /lit/fonts.css` : 'every measured run uses a verified face');
  row('canvas-text', results.canvasUnmeasured ? 'WARN' : 'PASS', results.canvasUnmeasured ? 'canvas text not measured: the page draws text on a canvas without LitStage.text registration; the look must answer it' : 'no unregistered canvas text');
  row('qa-samples', results.moved.length ? 'WARN' : 'PASS', results.moved.length ? `state moved while the text was hidden at frames ${results.moved.slice(0, 6).join(', ')}; those samples were discarded` : `${samples.size} samples measured`);
  const lively = results.nonText.filter((s) => s > 8 / 255).length;
  row('non-text-presence', results.nonText.length && lively * 2 >= results.nonText.length ? 'PASS' : 'WARN', `${lively} of ${results.nonText.length} beat midpoints show a non-text image (luminance spread over 8/255 outside the text)`);
  return { rules, summary: { samples: [...samples.keys()].sort((a, b) => a - b), contrast: results.contrast.length, copySeen: [...seenCopy], meta: [...results.meta] } };
}

// The platform names of this product's verified faces, read from probe spans.
async function faceNames(stage) {
  await stage.page.evaluate(() => {
    const holder = document.createElement('div');
    holder.id = '__lit_face_probe';
    holder.style.cssText = 'position:absolute;left:0;top:0;opacity:0;pointer-events:none;';
    const families = [...new Set([...document.fonts].map((f) => `${f.family}|${f.weight}|${f.stretch}`))];
    for (const spec of families) {
      const [family, weight, stretch] = spec.split('|');
      const span = document.createElement('span');
      span.textContent = 'Aa가';
      span.style.cssText = `font-family:${family};font-weight:${weight};font-stretch:${stretch}`;
      span.dataset.litQa = `face:${spec}`;
      holder.appendChild(span);
    }
    document.body.appendChild(holder);
    holder.getBoundingClientRect();
    return new Promise((resolve) => window.__litStage.nativeRAF(() => window.__litStage.nativeRAF(resolve)));
  });
  const names = new Set();
  const { root } = await stage.cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await stage.cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '#__lit_face_probe span' });
  for (const nodeId of nodeIds) {
    const { fonts } = await stage.cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    for (const f of fonts) if (f.isCustomFont) names.add(f.familyName);
  }
  await stage.page.evaluate(() => document.getElementById('__lit_face_probe')?.remove());
  return names;
}

async function platformFonts(cdp, id) {
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-lit-qa="${id}"]` });
    if (!nodeId) return [];
    const names = new Set();
    const walk = async (n) => {
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: n });
      for (const f of fonts) names.add(f.familyName);
    };
    await walk(nodeId);
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId, selector: '*' });
    for (const n of nodeIds.slice(0, 40)) await walk(n);
    return [...names];
  } catch { return []; }
}
