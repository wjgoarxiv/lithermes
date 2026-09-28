// WCAG 2.3.1 flash audit, excursion method (MO-C-03, MO-SH-04). It runs on the
// exact RGBA bytes handed to ffmpeg or to the preview encoder, one frame at a
// time, and emits a per-frame record { general, red } in {-1, 0, 1} for the
// render log. flashesFromRecords() counts flashes from those records; the gate
// never re-derives them from a decoded MP4 or WebP.
import { FLASH, FRAME } from './constants.mjs';

const LIN = Float64Array.from({ length: 256 }, (_, v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
});

export class FlashDetector {
  // The grid is always 320x180 cells of 6x6 logical px, so a 960-wide preview
  // frame gets 3x3-pixel cells and a --scale 2 master gets 12x12. A portrait
  // frame transposes it: 180x320 cells and a 60x107-cell window.
  constructor(width, height) {
    this.width = width;
    this.height = height;
    const portrait = height > width;
    this.gx = portrait ? FLASH.gridY : FLASH.gridX;
    this.gy = portrait ? FLASH.gridX : FLASH.gridY;
    const n = this.gx * this.gy;
    this.lo = new Float64Array(n); this.hi = new Float64Array(n);
    this.rlo = new Float64Array(n); this.rhi = new Float64Array(n);
    this.started = false;
    this.history = [];
    // The 10-degree window in cells, scaled with the grid (640x360 of 1920x1080).
    const ww = Math.round(FLASH.gridX * FLASH.windowLogicalW / FRAME.width);
    const wh = Math.round(FLASH.gridY * FLASH.windowLogicalH / FRAME.height);
    this.ww = portrait ? wh : ww;
    this.wh = portrait ? ww : wh;
    this.xEdges = Array.from({ length: this.gx + 1 }, (_, i) => Math.round((i * width) / this.gx));
    this.yEdges = Array.from({ length: this.gy + 1 }, (_, i) => Math.round((i * height) / this.gy));
    this.lastL = null;
  }

  cells(rgba) {
    const { gx, gy, width } = this;
    const L = new Float64Array(gx * gy), red = new Float64Array(gx * gy);
    for (let cy = 0; cy < gy; cy++) {
      const y0 = this.yEdges[cy], y1 = Math.max(y0 + 1, this.yEdges[cy + 1]);
      for (let cx = 0; cx < gx; cx++) {
        const x0 = this.xEdges[cx], x1 = Math.max(x0 + 1, this.xEdges[cx + 1]);
        let r = 0, g = 0, b = 0, count = 0;
        for (let y = y0; y < y1; y++) {
          let at = (y * width + x0) * 4;
          for (let x = x0; x < x1; x++, at += 4) { r += LIN[rgba[at]]; g += LIN[rgba[at + 1]]; b += LIN[rgba[at + 2]]; count++; }
        }
        r /= count; g /= count; b /= count;
        const i = cy * gx + cx;
        L[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const sum = r + g + b;
        red[i] = sum > 0 && r / sum >= FLASH.redShare ? Math.max(0, r - g - b) * FLASH.redScale : 0;
      }
    }
    return { L, red };
  }

  // Returns this frame's transition directions plus the whole-frame step used by MO-SH-04a.
  push(rgba) {
    const { L, red } = this.cells(rgba);
    const n = L.length;
    const gen = new Int8Array(n), rd = new Int8Array(n);
    if (!this.started) {
      this.lo.set(L); this.hi.set(L); this.rlo.set(red); this.rhi.set(red);
      this.started = true;
    } else {
      for (let i = 0; i < n; i++) {
        const v = L[i];
        if (v - this.lo[i] >= FLASH.cellDelta && this.lo[i] < FLASH.cellCeiling) { gen[i] = 1; this.lo[i] = v; this.hi[i] = v; }
        else if (this.hi[i] - v >= FLASH.cellDelta && v < FLASH.cellCeiling) { gen[i] = -1; this.lo[i] = v; this.hi[i] = v; }
        else { if (v < this.lo[i]) this.lo[i] = v; if (v > this.hi[i]) this.hi[i] = v; }
        const q = red[i];
        if (q - this.rlo[i] > FLASH.redDelta) { rd[i] = 1; this.rlo[i] = q; this.rhi[i] = q; }
        else if (this.rhi[i] - q > FLASH.redDelta) { rd[i] = -1; this.rlo[i] = q; this.rhi[i] = q; }
        else { if (q < this.rlo[i]) this.rlo[i] = q; if (q > this.rhi[i]) this.rhi[i] = q; }
      }
    }
    let stepCells = 0;
    if (this.lastL) for (let i = 0; i < n; i++) {
      const a = this.lastL[i], b = L[i];
      if (Math.abs(b - a) >= FLASH.cellDelta && Math.min(a, b) < FLASH.cellCeiling) stepCells++;
    }
    this.lastL = L;
    this.history.push({ gen, rd });
    if (this.history.length > FLASH.lookbackFrames + 1) this.history.shift();
    const general = this.direction('gen', 1) ? 1 : 0, generalDown = this.direction('gen', -1) ? -1 : 0;
    const redUp = this.direction('rd', 1) ? 1 : 0, redDown = this.direction('rd', -1) ? -1 : 0;
    return {
      general: general || generalDown, generalBoth: Boolean(general && generalDown),
      red: redUp || redDown, redBoth: Boolean(redUp && redDown),
      fullFrameStep: stepCells / n,
    };
  }

  // Same-direction cells in [f-2, f] covering more than 25% of some window.
  direction(key, dir) {
    const { gx, gy, ww, wh } = this;
    const sat = new Int32Array((gx + 1) * (gy + 1));
    for (let y = 0; y < gy; y++) {
      let row = 0;
      for (let x = 0; x < gx; x++) {
        const i = y * gx + x;
        let hit = 0;
        for (const h of this.history) if (h[key][i] === dir) { hit = 1; break; }
        row += hit;
        sat[(y + 1) * (gx + 1) + x + 1] = sat[y * (gx + 1) + x + 1] + row;
      }
    }
    const need = FLASH.windowFraction * ww * wh;
    for (let y = 0; y + wh <= gy; y++) for (let x = 0; x + ww <= gx; x++) {
      const area = sat[(y + wh) * (gx + 1) + x + ww] - sat[y * (gx + 1) + x + ww] - sat[(y + wh) * (gx + 1) + x] + sat[y * (gx + 1) + x];
      if (area > need) return true;
    }
    return false;
  }
}

// Frame records -> transition events. A frame-level transition persists for up
// to three frames because of the [f-2, f] lookback, so a run of consecutive
// same-direction frames is one event; a frame with both directions is two.
function events(records, key) {
  const out = [];
  let prev = 0;
  for (const r of records) {
    const both = key === 'general' ? r.generalBoth : r.redBoth;
    const dir = r[key] || 0;
    if (both) { out.push({ frame: r.frame, dir: 1 }, { frame: r.frame, dir: -1 }); prev = 0; continue; }
    if (dir && dir !== prev) out.push({ frame: r.frame, dir });
    prev = dir;
  }
  return out;
}

function countPairs(ordered) {
  let flashes = 0;
  for (let i = 0; i + 1 < ordered.length; i++) if (ordered[i].dir !== ordered[i + 1].dir) { flashes++; i++; }
  return flashes;
}

// Master: non-looping; window starts in [0, count - fps], never wrapping, and
// the final second forms one window (fixes (a) and (b)). Preview: looping; a
// window may run across the seam.
export function flashesFromRecords(records, fps, { loop = false } = {}) {
  const count = records.length;
  const result = { general: 0, red: 0, worstGeneral: null, worstRed: null };
  for (const key of ['general', 'red']) {
    const ev = events(records, key);
    let worst = 0, worstStart = 0, worstList = [];
    const starts = loop ? count : Math.max(1, count - fps + 1);
    for (let s = 0; s < starts; s++) {
      const inside = loop
        ? ev.map((e) => ({ ...e, k: (e.frame - s + count) % count })).filter((e) => e.k < fps).sort((a, b) => a.k - b.k || a.dir - b.dir)
        : ev.filter((e) => e.frame >= s && e.frame < Math.min(s + fps, count)).map((e) => ({ ...e, k: e.frame - s }));
      const n = countPairs(inside);
      if (n > worst) { worst = n; worstStart = s; worstList = inside.map((e) => `${e.frame}:${e.dir > 0 ? 'up' : 'down'}`); }
    }
    result[key] = worst;
    result[key === 'general' ? 'worstGeneral' : 'worstRed'] = { startFrame: worstStart, startSec: Number((worstStart / fps).toFixed(3)), transitions: worstList };
  }
  return result;
}
