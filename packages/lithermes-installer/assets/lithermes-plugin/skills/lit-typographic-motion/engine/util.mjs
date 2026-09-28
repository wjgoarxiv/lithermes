// Pure math, easing and seeded randomness for scene code. Adapted from
// mexicat/pdoom-video app/src/engine/util.ts (MIT, see NOTICE): same helper set,
// re-expressed as plain ESM with the family's named motion tokens and the spec's
// fixed FNV-1a seed formula. Nothing here reads a clock or an unseeded random source.

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (a === b ? 0 : (x - a) / (b - a));
export const remap = (x, a, b, c, d, clampIt = true) => {
  const t = invLerp(a, b, x);
  return lerp(c, d, clampIt ? clamp(t) : t);
};
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// A cubic-bezier easing solved by bisection on x; used only to build the named
// tokens below, never called with ad hoc control points from scene code.
function bezier(x1, y1, x2, y2) {
  const axis = (t, p1, p2) => 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 40; i++) {
      t = (lo + hi) / 2;
      if (axis(t, x1, x2) < x) lo = t; else hi = t;
    }
    return axis(t, y1, y2);
  };
}

// The named set (MO-A-08). Preset motion tokens map onto these names.
export const ease = Object.freeze({
  linear: (t) => t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outQuart: (t) => 1 - (1 - t) ** 4,
  outExpo: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutSine: bezier(0.37, 0, 0.63, 1),
  slam: bezier(0.16, 1, 0.3, 1),
});

export const prog = (x, a, b, fn = ease.linear) => fn(clamp((x - a) / (b - a)));

// Piecewise keyframes: [[time, value, easeName], ...]; the ease names the segment ending at that key.
export function keys(t, list) {
  if (!list.length) return 0;
  if (t <= list[0][0]) return list[0][1];
  for (let i = 1; i < list.length; i++) {
    const [time, value, name] = list[i];
    if (t <= time) {
      const [prevTime, prevValue] = list[i - 1];
      const fn = ease[name || 'inOutCubic'];
      if (!fn) throw new Error(`unknown ease token: ${name}`);
      return lerp(prevValue, value, fn((t - prevTime) / (time - prevTime)));
    }
  }
  return list[list.length - 1][1];
}

// Damped spring response to a unit step at t = 0 (for rare deliberate overshoot).
export const springStep = (t, freq = 4, damping = 0.35) => {
  if (t <= 0) return 0;
  const w = 2 * Math.PI * freq;
  return 1 - Math.exp(-damping * w * t) * Math.cos(w * Math.sqrt(1 - damping * damping) * t);
};

// MO-SH-01: FNV-1a, 32-bit, over the UTF-8 bytes of the joined string.
export function fnv1a32(input) {
  let value = 0x811c9dc5;
  for (const byte of Buffer.from(String(input), 'utf8')) {
    value ^= byte;
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}

export const passSeed = (runSeed, sceneId, shotIndex, pass) => fnv1a32(`${runSeed}:${sceneId}:${shotIndex}:${pass}`);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(...xs) {
  let h = 2166136261 >>> 0;
  for (const x of xs) {
    h ^= Math.floor(x * 1000003) | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  return lerp(hash(i, seed) * 2 - 1, hash(i + 1, seed) * 2 - 1, fade(x - i));
}

export function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const srgbToLinear = (v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const hexToLinear = (hex) => hexToRgb(hex).map(srgbToLinear);
export const relativeLuminance = (hex) => {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrastRatio = (a, b) => {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
};

export function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export const hueDistance = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

// Polyline helpers for stroke writing.
export function polylineLengths(points) {
  const out = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) {
    out[i] = out[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return out;
}
