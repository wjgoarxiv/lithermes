// LitHermes stage kit, served to stage pages at /lit/stage-kit.js.
// Motion primitives only: easing, springs, keyframes, timing, seeded
// randomness, text splitting, path drawing and morphing, masks, colour mixing
// and text registration. It ships no scene, object, layout or copy; the page
// draws whatever its treatment calls for. Every function is a pure function of
// its arguments (and of t), so a frame depends only on the virtual clock.
(() => {
  'use strict';
  const state = window.__litStage || (window.__litStage = {});
  if (!Array.isArray(state.canvasTexts)) state.canvasTexts = [];

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const lerp = (a, b, p) => a + (b - a) * p;

  // Named eases on 0..1.
  const c1 = 1.70158, c2 = c1 * 1.525, c3 = c1 + 1;
  const ease = Object.freeze({
    linear: (p) => p,
    inSine: (p) => 1 - Math.cos((p * Math.PI) / 2),
    outSine: (p) => Math.sin((p * Math.PI) / 2),
    inOutSine: (p) => -(Math.cos(Math.PI * p) - 1) / 2,
    inQuad: (p) => p * p,
    outQuad: (p) => 1 - (1 - p) * (1 - p),
    inOutQuad: (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2),
    inCubic: (p) => p * p * p,
    outCubic: (p) => 1 - (1 - p) ** 3,
    inOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
    inQuart: (p) => p ** 4,
    outQuart: (p) => 1 - (1 - p) ** 4,
    inOutQuart: (p) => (p < 0.5 ? 8 * p ** 4 : 1 - (-2 * p + 2) ** 4 / 2),
    inExpo: (p) => (p === 0 ? 0 : 2 ** (10 * p - 10)),
    outExpo: (p) => (p === 1 ? 1 : 1 - 2 ** (-10 * p)),
    inOutExpo: (p) => (p === 0 ? 0 : p === 1 ? 1 : p < 0.5 ? 2 ** (20 * p - 10) / 2 : (2 - 2 ** (-20 * p + 10)) / 2),
    inBack: (p) => c3 * p * p * p - c1 * p * p,
    outBack: (p) => 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2,
    inOutBack: (p) => (p < 0.5 ? ((2 * p) ** 2 * ((c2 + 1) * 2 * p - c2)) / 2 : ((2 * p - 2) ** 2 * ((c2 + 1) * (p * 2 - 2) + c2) + 2) / 2),
  });

  // CSS-style cubic-bezier(x1, y1, x2, y2): solve x(u) = p, return y(u).
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (u) => ((ax * u + bx) * u + cx) * u;
    const sy = (u) => ((ay * u + by) * u + cy) * u;
    const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
    return (p) => {
      const x = clamp01(p);
      let u = x;
      for (let i = 0; i < 8; i++) {
        const err = sx(u) - x, d = dx(u);
        if (Math.abs(err) < 1e-7) return sy(u);
        if (Math.abs(d) < 1e-6) break;
        u -= err / d;
      }
      let lo = 0, hi = 1;
      u = x;
      for (let i = 0; i < 40; i++) {
        const v = sx(u);
        if (Math.abs(v - x) < 1e-7) break;
        if (v < x) lo = u; else hi = u;
        u = (lo + hi) / 2;
      }
      return sy(u);
    };
  }

  function resolveEase(e) {
    if (typeof e === 'function') return e;
    if (!e) return ease.linear;
    if (Array.isArray(e) && e.length === 4) return bezier(...e);
    if (ease[e]) return ease[e];
    throw new Error(`LitStage: unknown ease "${e}"`);
  }

  // Analytic damped spring from `from` to `to`; returns t => value (t in s).
  function spring({ from = 0, to = 1, stiffness = 170, damping = 26, mass = 1, velocity = 0 } = {}) {
    const w0 = Math.sqrt(stiffness / mass);
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    const x0 = from - to, v0 = velocity;
    let x;
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      x = (t) => Math.exp(-zeta * w0 * t) * (x0 * Math.cos(wd * t) + ((v0 + zeta * w0 * x0) / wd) * Math.sin(wd * t));
    } else if (zeta === 1) {
      x = (t) => (x0 + (v0 + w0 * x0) * t) * Math.exp(-w0 * t);
    } else {
      const s = w0 * Math.sqrt(zeta * zeta - 1);
      const r1 = -zeta * w0 + s, r2 = -zeta * w0 - s;
      const b = (v0 - r1 * x0) / (r2 - r1), a = x0 - b;
      x = (t) => a * Math.exp(r1 * t) + b * Math.exp(r2 * t);
    }
    return (t) => (t <= 0 ? from : to + x(t));
  }

  // Keyframes: [{ t, v, ease? }], v a number or an array of numbers.
  function kf(t, keys) {
    if (!keys.length) throw new Error('LitStage.kf needs at least one key');
    const sorted = keys.slice().sort((a, b) => a.t - b.t);
    if (t <= sorted[0].t) return sorted[0].v;
    const last = sorted[sorted.length - 1];
    if (t >= last.t) return last.v;
    let i = 0;
    while (t >= sorted[i + 1].t) i++;
    const a = sorted[i], b = sorted[i + 1];
    const p = resolveEase(b.ease)((t - a.t) / (b.t - a.t));
    if (Array.isArray(a.v)) return a.v.map((value, k) => lerp(value, b.v[k], p));
    return lerp(a.v, b.v, p);
  }

  const at = (t, start, dur, e) => resolveEase(e)(clamp01(dur > 0 ? (t - start) / dur : t >= start ? 1 : 0));

  function stagger(i, { each = 0.05, from = 0, count = 0 } = {}) {
    const origin = from === 'end' ? count - 1 : from === 'center' ? (count - 1) / 2 : Number(from) || 0;
    return each * Math.abs(i - origin);
  }

  function seq(t, durations) {
    let start = 0;
    for (let index = 0; index < durations.length; index++) {
      const d = durations[index];
      if (t < start + d) return { index, p: d > 0 ? clamp01((t - start) / d) : 1, start };
      start += d;
    }
    return { index: durations.length - 1, p: 1, start: start - (durations[durations.length - 1] || 0) };
  }

  // mulberry32: the same generator the type engine seeds its passes with.
  function rand(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Split an element's text into spans: graphemes (Intl.Segmenter), or words,
  // where a Hangul word is its 어절 (a whitespace-delimited unit), so a syllable
  // or an eojeol is never cut. Returns the spans; repeated calls return the same.
  function splitText(el, { by = 'grapheme' } = {}) {
    const text = el.textContent;
    if (el.__litSplit && el.__litSplit.by === by && el.__litSplit.text === text) return el.__litSplit.spans;
    const pieces = [];
    if (by === 'word') {
      for (const part of text.split(/(\s+)/u)) if (part) pieces.push({ text: part, space: /^\s+$/u.test(part) });
    } else {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      for (const { segment } of segmenter.segment(text)) pieces.push({ text: segment, space: /^\s+$/u.test(segment) });
    }
    el.textContent = '';
    const spans = [];
    for (const piece of pieces) {
      if (piece.space) { el.appendChild(document.createTextNode(piece.text)); continue; }
      const span = document.createElement('span');
      span.textContent = piece.text;
      span.style.display = 'inline-block';
      span.style.whiteSpace = 'pre';
      el.appendChild(span);
      spans.push(span);
    }
    if (!el.dataset.litText) el.dataset.litText = 'copy';
    el.__litSplit = { by, text, spans };
    return spans;
  }

  function drawPath(pathEl, p) {
    if (pathEl.__litLength == null) pathEl.__litLength = pathEl.getTotalLength();
    const length = pathEl.__litLength;
    pathEl.style.strokeDasharray = `${length} ${length}`;
    pathEl.style.strokeDashoffset = String(length * (1 - clamp01(p)));
  }

  // --- single-subpath morph ------------------------------------------------
  function tokenize(d) {
    const out = [];
    const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
    let m;
    while ((m = re.exec(d))) out.push(m[1] || Number(m[2]));
    return out;
  }

  function arcToCubics(x1, y1, rx, ry, angle, large, sweep, x2, y2) {
    if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
    const phi = (angle * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
    rx = Math.abs(rx); ry = Math.abs(ry);
    const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const sign = large === sweep ? -1 : 1;
    const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
    const coef = sign * Math.sqrt(Math.max(0, num / (rx * rx * yp * yp + ry * ry * xp * xp)));
    const cxp = (coef * rx * yp) / ry, cyp = (-coef * ry * xp) / rx;
    const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
    let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
    const step = dt / n, k = (4 / 3) * Math.tan(step / 4);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a1 = t1 + i * step, a2 = a1 + step;
      const p = (a) => [cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin, cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos];
      const d = (a) => [-rx * Math.sin(a) * cos - ry * Math.cos(a) * sin, -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos];
      const [px1, py1] = p(a1), [px2, py2] = p(a2), [dx1, dy1] = d(a1), [dx2, dy2] = d(a2);
      out.push([px1 + k * dx1, py1 + k * dy1, px2 - k * dx2, py2 - k * dy2, px2, py2]);
    }
    return out;
  }

  // Parse one subpath into absolute cubic segments: { start, segments, closed }.
  function toCubics(d) {
    const tokens = tokenize(d);
    let i = 0, cmd = null, x = 0, y = 0, sx = 0, sy = 0, lastC = null, lastQ = null, moves = 0, closed = false, start = null;
    const segments = [];
    const num = () => {
      if (typeof tokens[i] !== 'number') throw new Error(`LitStage.morph: malformed path near "${tokens.slice(i, i + 3).join(' ')}"`);
      return tokens[i++];
    };
    while (i < tokens.length) {
      if (typeof tokens[i] === 'string') cmd = tokens[i++];
      else if (cmd === null) throw new Error('LitStage.morph: path must start with M');
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
      const ox = rel ? x : 0, oy = rel ? y : 0;
      if (C === 'M') {
        if (++moves > 1) throw new Error('LitStage.morph: multi-subpath morphs are not supported; split the shape into single paths');
        x = num() + ox; y = num() + oy; sx = x; sy = y; start = [x, y]; lastC = lastQ = null;
        cmd = rel ? 'l' : 'L';
      } else if (C === 'Z') {
        if (x !== sx || y !== sy) segments.push([x, y, sx, sy, sx, sy]);
        x = sx; y = sy; closed = true; lastC = lastQ = null;
        if (i < tokens.length && typeof tokens[i] === 'string' && tokens[i].toUpperCase() === 'M') throw new Error('LitStage.morph: multi-subpath morphs are not supported; split the shape into single paths');
      } else if (C === 'L' || C === 'H' || C === 'V') {
        const nx = C === 'V' ? x : num() + ox;
        const ny = C === 'H' ? y : num() + oy;
        segments.push([x, y, nx, ny, nx, ny]); x = nx; y = ny; lastC = lastQ = null;
      } else if (C === 'C' || C === 'S') {
        let x1, y1;
        if (C === 'C') { x1 = num() + ox; y1 = num() + oy; } else { x1 = lastC ? 2 * x - lastC[0] : x; y1 = lastC ? 2 * y - lastC[1] : y; }
        const x2 = num() + ox, y2 = num() + oy, nx = num() + ox, ny = num() + oy;
        segments.push([x1, y1, x2, y2, nx, ny]); lastC = [x2, y2]; lastQ = null; x = nx; y = ny;
      } else if (C === 'Q' || C === 'T') {
        let qx, qy;
        if (C === 'Q') { qx = num() + ox; qy = num() + oy; } else { qx = lastQ ? 2 * x - lastQ[0] : x; qy = lastQ ? 2 * y - lastQ[1] : y; }
        const nx = num() + ox, ny = num() + oy;
        segments.push([x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny]);
        lastQ = [qx, qy]; lastC = null; x = nx; y = ny;
      } else if (C === 'A') {
        const rx = num(), ry = num(), rot = num(), large = num(), sweep = num(), nx = num() + ox, ny = num() + oy;
        for (const seg of arcToCubics(x, y, rx, ry, rot, Boolean(large), Boolean(sweep), nx, ny)) segments.push(seg);
        x = nx; y = ny; lastC = lastQ = null;
      } else throw new Error(`LitStage.morph: unsupported command ${cmd}`);
    }
    if (!segments.length) throw new Error('LitStage.morph: empty path');
    return { start, segments, closed };
  }

  function cubicPoint(x0, y0, s, u) {
    const v = 1 - u;
    return [
      v * v * v * x0 + 3 * v * v * u * s[0] + 3 * v * u * u * s[2] + u * u * u * s[4],
      v * v * v * y0 + 3 * v * v * u * s[1] + 3 * v * u * u * s[3] + u * u * u * s[5],
    ];
  }

  // Resample a cubic path to n points evenly spaced by arc length.
  function resample(parsed, n) {
    const dense = [];
    let [x0, y0] = parsed.start;
    for (const s of parsed.segments) {
      for (let k = 0; k < 24; k++) dense.push(cubicPoint(x0, y0, s, k / 24));
      x0 = s[4]; y0 = s[5];
    }
    dense.push([x0, y0]);
    const cum = [0];
    for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    const total = cum[cum.length - 1] || 1;
    const out = [];
    let j = 0;
    const count = parsed.closed ? n : n - 1;
    for (let i = 0; i < n; i++) {
      const target = (total * i) / count;
      while (j < cum.length - 2 && cum[j + 1] < target) j++;
      const span = cum[j + 1] - cum[j] || 1;
      const p = (target - cum[j]) / span;
      out.push([lerp(dense[j][0], dense[j + 1][0], p), lerp(dense[j][1], dense[j + 1][1], p)]);
    }
    return out;
  }

  function morph(fromD, toD, { points = 160 } = {}) {
    const a = toCubics(fromD), b = toCubics(toD);
    const pa = resample(a, points);
    let pb = resample(b, points);
    const closed = a.closed && b.closed;
    if (closed) {
      let best = 0, bestCost = Infinity;
      for (let r = 0; r < points; r++) {
        let cost = 0;
        for (let i = 0; i < points; i += 4) {
          const q = pb[(i + r) % points];
          cost += (pa[i][0] - q[0]) ** 2 + (pa[i][1] - q[1]) ** 2;
        }
        if (cost < bestCost) { bestCost = cost; best = r; }
      }
      pb = pb.map((_, i) => pb[(i + best) % points]);
    }
    return (p) => {
      const e = clamp01(p);
      let d = '';
      for (let i = 0; i < points; i++) {
        const x = lerp(pa[i][0], pb[i][0], e), y = lerp(pa[i][1], pb[i][1], e);
        d += `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
      }
      return closed ? `${d}Z` : d;
    };
  }

  // --- masks and clips -------------------------------------------------------
  function clipInset(el, p, from = 'left') {
    const hide = `${((1 - clamp01(p)) * 100).toFixed(3)}%`;
    const sides = { left: `0 ${hide} 0 0`, right: `0 0 0 ${hide}`, top: `0 0 ${hide} 0`, bottom: `${hide} 0 0 0` };
    if (!sides[from]) throw new Error(`LitStage.clipInset: unknown side "${from}"`);
    el.style.clipPath = `inset(${sides[from]})`;
  }

  // 142 % of the reference radius covers the box from any point inside it.
  function clipCircle(el, p, cx = '50%', cy = '50%') {
    el.style.clipPath = `circle(${(clamp01(p) * 142).toFixed(3)}% at ${cx} ${cy})`;
  }

  function maskWipe(el, p, angleDeg = 90, softPx = 80) {
    const box = el.getBoundingClientRect();
    const rad = (angleDeg * Math.PI) / 180;
    const span = Math.abs(box.width * Math.sin(rad)) + Math.abs(box.height * Math.cos(rad)) || 1;
    const soft = (softPx / span) * 100;
    const edge = clamp01(p) * (100 + soft) - soft;
    const image = `linear-gradient(${angleDeg}deg, #000 ${edge.toFixed(3)}%, transparent ${(edge + soft).toFixed(3)}%)`;
    el.style.webkitMaskImage = image;
    el.style.maskImage = image;
  }

  // --- colour ---------------------------------------------------------------
  function parseColor(c) {
    const s = String(c).trim();
    let m = s.match(/^#([0-9a-f]{3})$/i);
    if (m) return m[1].split('').map((h) => parseInt(h + h, 16));
    m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) return [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16));
    m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    throw new Error(`LitStage.mix: cannot read colour "${c}"`);
  }
  function mix(a, b, p) {
    const x = parseColor(a), y = parseColor(b), e = clamp01(p);
    return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], e))).join(', ')})`;
  }

  // --- text registration and the film --------------------------------------
  // text(el, { decor }) marks a DOM text run; text({ content, x, y, w, h })
  // registers canvas or WebGL text drawn this frame so the QA can measure it.
  function text(target, options = {}) {
    if (target && typeof target === 'object' && target.nodeType === 1) {
      target.dataset.litText = options.decor ? 'decor' : 'copy';
      return target;
    }
    const { content, x, y, w, h, decor = false } = target || {};
    if (typeof content !== 'string' || ![x, y, w, h].every(Number.isFinite)) throw new Error('LitStage.text needs { content, x, y, w, h }');
    state.canvasTexts.push({ content, x, y, w, h, decor: Boolean(decor) });
    return target;
  }

  function define(film) {
    if (!film || typeof film !== 'object') throw new Error('LitStage.define needs { width, height, fps, duration, render }');
    for (const key of ['width', 'height', 'duration']) if (!Number.isFinite(film[key])) throw new Error(`LitStage.define: ${key} must be a number`);
    if (film.render != null && typeof film.render !== 'function') throw new Error('LitStage.define: render must be a function of t');
    state.film = film;
    return film;
  }

  window.LitStage = Object.freeze({
    ease, bezier, spring, kf, at, stagger, seq, rand, splitText, drawPath, morph,
    clipInset, clipCircle, maskWipe, mix, text, define,
  });
})();
