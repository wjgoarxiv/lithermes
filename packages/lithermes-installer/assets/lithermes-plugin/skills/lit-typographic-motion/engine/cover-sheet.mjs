// The cover's review image: decoded frames in a 4-wide grid above a plot of the whole loop's
// frame-to-frame difference (one point per grid step), with the still threshold (red dashes) and
// the median (green dots) drawn across it. The plot shows what single stills cannot: a hold is a
// flat run on the dashes, encoder pops are regular spikes, a reset is a spike at the right end.
// Drawn straight into pixels, like the film contact sheet, so it needs neither Chrome nor fonts;
// each tile carries its loop time in seconds. `marks` shade spans of the plot (a window render).
import { writeFileSync } from 'node:fs';
import { COVER } from './constants.mjs';
import { lanczosResize } from './cover-image.mjs';
import { encodePng } from './cover-png.mjs';

const GLYPHS = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111',
  '.': '000000000000010', s: '011100010001110', '-': '000000111000000',
};

function fill(buf, W, x, y, w, h, [r, g, b], a = 1) {
  for (let yy = Math.max(0, y); yy < y + h; yy++) for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) {
    const o = (yy * W + xx) * 4;
    if (o + 3 >= buf.length) return;
    buf[o] = Math.round(buf[o] * (1 - a) + r * a); buf[o + 1] = Math.round(buf[o + 1] * (1 - a) + g * a); buf[o + 2] = Math.round(buf[o + 2] * (1 - a) + b * a); buf[o + 3] = 255;
  }
}

function label(buf, W, x, y, text, scale = 3, colour = [235, 235, 225]) {
  let cx = x;
  for (const ch of String(text)) {
    const glyph = GLYPHS[ch];
    if (glyph) for (let i = 0; i < 15; i++) if (glyph[i] === '1') fill(buf, W, cx + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale, colour);
    cx += 4 * scale;
  }
}

function line(buf, W, x0, y0, x1, y1, colour, thick = 2) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let k = 0; k <= n; k++) fill(buf, W, Math.round(x0 + ((x1 - x0) * k) / n) - (thick >> 1), Math.round(y0 + ((y1 - y0) * k) / n) - (thick >> 1), thick, thick, colour);
}

// tiles: [{ rgba, width, height, t }]; diffs: every grid step's d (the seam last); marks: [{ t0, t1 }]
// in seconds of `durationSec`. Writes an RGB PNG and returns its size.
export function writeCoverSheet({ file, tiles, diffs, medianD, durationSec, marks = [] }) {
  const pad = 8, cols = 4, tileW = 400, tileH = Math.round((tileW * tiles[0].height) / tiles[0].width), cap = 24;
  const rows = Math.ceil(tiles.length / cols);
  const W = cols * tileW + (cols + 1) * pad;
  const plotTop = rows * (tileH + cap + pad) + pad + 6, plotH = 170;
  const H = plotTop + plotH + pad;
  const buf = Buffer.alloc(W * H * 4);
  fill(buf, W, 0, 0, W, H, [8, 11, 16]);
  tiles.forEach((tile, k) => {
    const x = pad + (k % cols) * (tileW + pad), y = pad + Math.floor(k / cols) * (tileH + cap + pad);
    label(buf, W, x + 2, y + 4, `${tile.t.toFixed(2)}s`);
    const small = lanczosResize(tile.rgba, tile.width, tile.height, tileW, tileH);
    for (let row = 0; row < tileH; row++) small.copy(buf, ((y + cap + row) * W + x) * 4, row * tileW * 4, (row + 1) * tileW * 4);
  });
  const left = pad, width = W - 2 * pad;
  fill(buf, W, left, plotTop, width, plotH, [17, 22, 29]);
  for (const m of marks) {
    const a = left + Math.round((m.t0 / durationSec) * width), b = left + Math.round((m.t1 / durationSec) * width);
    fill(buf, W, a, plotTop, Math.max(2, b - a), plotH, [255, 176, 46], 0.18);
  }
  const top = Math.max(0.01, ...diffs) * 1.05;
  const Y = (v) => Math.round(plotTop + plotH - 1 - (v / top) * (plotH - 2));
  const X = (i) => Math.round(left + (i / Math.max(1, diffs.length - 1)) * (width - 1));
  for (let x = left; x < left + width; x += 8) fill(buf, W, x, Y(COVER.stillEps), 4, 1, [170, 51, 51]);
  for (let x = left; x < left + width; x += 5) fill(buf, W, x, Y(medianD), 2, 1, [85, 170, 136]);
  for (let i = 1; i < diffs.length; i++) line(buf, W, X(i - 1), Y(diffs[i - 1]), X(i), Y(diffs[i]), [255, 122, 70]);
  writeFileSync(file, encodePng(buf, W, H, { level: 6 }));
  return { width: W, height: H };
}
