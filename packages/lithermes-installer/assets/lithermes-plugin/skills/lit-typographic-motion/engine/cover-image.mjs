// Pixel helpers for cover mode, all on RGBA8 buffers and dependency-free so the gate also runs in
// the test suite without the runtime cache: a separable Lanczos-3 resize (the 2x seek capture is
// brought down to the cover size with it), the gate's luma grid (Rec. 709 weights on the encoded
// values, box-averaged to about 300 px wide, so every motion number is a thumbnail-scale number),
// a rectangle copy, and a tiled SSIM on luma for the frame-0 base-art check.

export const LUMA_WIDTH = 300;

const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const lanczos3 = (x) => (Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0);

// One row of taps per output pixel: the first source index and normalised weights. When shrinking,
// the kernel is stretched by the scale so every source pixel contributes (no aliasing).
function taps(from, to) {
  const scale = from / to, stretch = Math.max(1, scale), reach = 3 * stretch;
  return Array.from({ length: to }, (_, i) => {
    const centre = (i + 0.5) * scale - 0.5;
    const first = Math.max(0, Math.ceil(centre - reach));
    const last = Math.min(from - 1, Math.floor(centre + reach));
    const weights = [];
    for (let j = first; j <= last; j++) weights.push(lanczos3((j - centre) / stretch));
    const total = weights.reduce((a, b) => a + b, 0);
    return { first, weights: weights.map((w) => w / total) };
  });
}

// Resize opaque RGBA8 with Lanczos-3, horizontal pass then vertical; alpha comes out 255.
export function lanczosResize(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return Buffer.from(src.buffer, src.byteOffset, src.byteLength);
  const tx = taps(sw, dw), ty = taps(sh, dh);
  const mid = new Float32Array(dw * sh * 3);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      const { first, weights } = tx[x];
      let r = 0, g = 0, b = 0;
      for (let k = 0, at = (y * sw + first) * 4; k < weights.length; k++, at += 4) {
        const w = weights[k];
        r += src[at] * w; g += src[at + 1] * w; b += src[at + 2] * w;
      }
      const o = (y * dw + x) * 3;
      mid[o] = r; mid[o + 1] = g; mid[o + 2] = b;
    }
  }
  const out = Buffer.alloc(dw * dh * 4);
  const byte = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));
  for (let y = 0; y < dh; y++) {
    const { first, weights } = ty[y];
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < weights.length; k++) {
        const at = ((first + k) * dw + x) * 3, w = weights[k];
        r += mid[at] * w; g += mid[at + 1] * w; b += mid[at + 2] * w;
      }
      const o = (y * dw + x) * 4;
      out[o] = byte(r); out[o + 1] = byte(g); out[o + 2] = byte(b); out[o + 3] = 255;
    }
  }
  return out;
}

// Luma (0..255) box-averaged by an integer factor that brings the width near LUMA_WIDTH.
export function lumaGrid(rgba, width, height) {
  const f = Math.max(1, Math.round(width / LUMA_WIDTH));
  const w = Math.floor(width / f), h = Math.floor(height / f);
  const luma = new Float32Array(w * h);
  for (let y = 0; y < h * f; y++) {
    const row = Math.floor(y / f) * w;
    for (let x = 0, at = y * width * 4; x < w * f; x++, at += 4) luma[row + Math.floor(x / f)] += 0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2];
  }
  for (let i = 0; i < luma.length; i++) luma[i] /= f * f;
  return { luma, w, h };
}

export function crop(rgba, width, [x, y, w, h]) {
  const out = Buffer.alloc(w * h * 4);
  const src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  for (let row = 0; row < h; row++) src.copy(out, row * w * 4, ((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4);
  return out;
}

// SSIM on luma, averaged over non-overlapping 8x8 tiles (the classic constants for 8-bit data).
export function ssim(a, b, width, height) {
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2, T = 8;
  const Y = (px, i) => 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
  let sum = 0, tiles = 0;
  for (let ty = 0; ty + T <= height; ty += T) {
    for (let tx = 0; tx + T <= width; tx += T) {
      let ma = 0, mb = 0;
      const va = new Float64Array(T * T), vb = new Float64Array(T * T);
      for (let k = 0; k < T * T; k++) {
        const i = (ty + Math.floor(k / T)) * width + tx + (k % T);
        va[k] = Y(a, i); vb[k] = Y(b, i); ma += va[k]; mb += vb[k];
      }
      ma /= T * T; mb /= T * T;
      let sa = 0, sb = 0, cov = 0;
      for (let k = 0; k < T * T; k++) { const da = va[k] - ma, db = vb[k] - mb; sa += da * da; sb += db * db; cov += da * db; }
      const n = T * T - 1;
      sum += ((2 * ma * mb + C1) * (2 * cov / n + C2)) / ((ma * ma + mb * mb + C1) * (sa / n + sb / n + C2));
      tiles++;
    }
  }
  return tiles ? sum / tiles : 0;
}
