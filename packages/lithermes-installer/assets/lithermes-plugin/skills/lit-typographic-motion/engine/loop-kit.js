// LitLoop: the helper kit a cover page loads from /lit/loop-kit.js (references/cover.md). A cover
// page is one picture drawn from a loop time t in [0, 1) by window.renderFrame(t); the renderer
// seeks frames in any order and draws some twice in fresh pages. So every helper below is either
// pure or periodic in t: frame N would equal frame 0, and no frame depends on the one before it.
// Clocks and unseeded entropy throw in a cover page, so layout randomness comes from rng(seed).
(function attachLitLoop(scope) {
  'use strict';
  const TAU = 2 * Math.PI;
  const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
  const fract = (x) => x - Math.floor(x);
  const mix = (a, b, k) => a + (b - a) * k;

  // mulberry32: a seeded stream for layout (positions, sizes, which copy carries the accent).
  function rng(seed) {
    let s = seed >>> 0;
    return function next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let z = Math.imul(s ^ (s >>> 15), s | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Value noise on a seeded 3-D lattice. loopNoise samples it on a circle of `radius` around
  // `offset`, so the value at t = 1 is the value at t = 0; different offsets decorrelate copies.
  function makeNoise(seed) {
    const next = rng(seed);
    const table = new Float32Array(256);
    const perm = new Uint8Array(512);
    for (let i = 0; i < 256; i++) { table[i] = 2 * next() - 1; perm[i] = i; }
    for (let i = 255; i > 0; i--) { const j = Math.floor(next() * (i + 1)); const k = perm[i]; perm[i] = perm[j]; perm[j] = k; }
    for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
    const fade = (u) => u * u * (3 - 2 * u);
    const lattice = (x, y, z) => table[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
    return function noise(x, y, z) {
      const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
      const u = fade(x - x0), v = fade(y - y0), w = fade(z - z0);
      const edge = (yy, zz) => mix(lattice(x0, yy, zz), lattice(x0 + 1, yy, zz), u);
      const face = (zz) => mix(edge(y0, zz), edge(y0 + 1, zz), v);
      return mix(face(z0), face(z0 + 1), w);
    };
  }
  const loopNoise = (noise, t, offset = 0, radius = 1.3) =>
    noise(offset + radius * Math.cos(TAU * t), radius * Math.sin(TAU * t), 0.37 * offset);

  // Shapes for events. Linear time is only for motion that never stops (drift, laps).
  const ease = Object.freeze({
    smooth: (p) => p * p * (3 - 2 * p),
    outCubic: (p) => 1 - (1 - p) ** 3,
    inCubic: (p) => p * p * p,
    outExpo: (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
    outBack: (p, s = 1.6) => { const q = p - 1; return 1 + (s + 1) * q * q * q + s * q * q; },
    gain: (p, k) => (p < 0.5 ? 0.5 * (2 * p) ** k : 1 - 0.5 * (2 - 2 * p) ** k),
  });

  // cubicPulse is a symmetric bump of half-width w around c, zero outside. Use it for micro events:
  // the long tail of expImpulse is a slow fade, and a lossy animation encoder drops slow fades.
  function cubicPulse(c, w, x) {
    const d = Math.abs(x - c);
    if (d >= w) return 0;
    const k = d / w;
    return 1 - k * k * (3 - 2 * k);
  }
  const expImpulse = (x, k) => { const h = k * x; return h * Math.exp(1 - h); };

  // phase: where one copy of the rule is in its own cycle. cdist: distance around the loop, for an
  // event that straddles t = 0. window: a one-shot event, -1 outside [start, start + dur) (wraps).
  const phase = (t, offset = 0, cycles = 1) => fract(cycles * t - offset);
  const cdist = (p, c) => { const d = fract(p - c); return Math.min(d, 1 - d); };
  const once = (p, start, dur) => { const q = fract(p - start); return q < dur ? q / dur : -1; };
  // steps: hold at `stops` poses per cycle, travelling during the last `travel` of each slot.
  function steps(p, stops, travel = 0.35, shape = ease.smooth) {
    const x = p * stops, i = Math.floor(x);
    return (i + shape(clamp((x - i - (1 - travel)) / travel))) / stops;
  }
  // swell: 0 -> 1 -> 0 over one cycle, dwelling at both ends.
  const swell = (p) => 0.5 - 0.5 * Math.cos(TAU * p);

  scope.LitLoop = Object.freeze({ TAU, clamp, fract, mix, rng, makeNoise, loopNoise, ease, cubicPulse, expImpulse, phase, cdist, window: once, steps, swell });
})(typeof window === 'undefined' ? globalThis : window);
