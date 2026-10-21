// Cover assets: every raster a cover page can load (base art, logo, wordmark, texture) is listed in
// <out>/assets.json with its path, role, source (user or generated) and SHA-256, and the renderer
// checks the list before the first capture. A listed file that is missing is BLOCKED_ASSET_MISSING
// (exit 22): the art is supplied or generated, never replaced by a drawn stand-in. The
// painted-light recipe needs its base art listed. After the render, frame 0 has to show that art:
// the SSIM of its check box in decoded frame 0 against the source scaled into the art's box.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { COVER, EXIT } from './constants.mjs';
import { crop, lanczosResize, ssim } from './cover-image.mjs';

export const ASSETS_FILE = 'assets.json';
export const ASSET_ROLES = Object.freeze(['base-art', 'logo', 'wordmark', 'texture']);

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exit = (code, message) => Object.assign(new Error(message), { exitCode: code });
const invalid = (field, message) => exit(EXIT.BLOCKED_TREATMENT_INVALID, `BLOCKED_TREATMENT_INVALID: field assets.json ${field}: ${message}`);
const inside = (b) => Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === 'number' && v >= 0 && v <= 1)
  && b[2] > 0 && b[3] > 0 && b[0] + b[2] <= 1 + 1e-9 && b[1] + b[3] <= 1 + 1e-9;

function entry(a, i, coverDir) {
  const at = `assets[${i}]`;
  if (!a || typeof a !== 'object') throw invalid(at, 'must be an object');
  if (typeof a.path !== 'string' || !a.path.startsWith(`${coverDir}/`) || a.path.split('/').includes('..')) throw invalid(`${at}.path`, `must be a path under ${coverDir}/, relative to the output directory`);
  if (!ASSET_ROLES.includes(a.role)) throw invalid(`${at}.role`, `must be one of ${ASSET_ROLES.join(', ')}`);
  if (!['user', 'generated'].includes(a.source)) throw invalid(`${at}.source`, 'must be user (supplied) or generated (made for this cover)');
  if (!/^[0-9a-f]{64}$/u.test(a.sha256 ?? '')) throw invalid(`${at}.sha256`, 'must be the file\'s SHA-256 (64 hex)');
  if (a.box !== undefined && !inside(a.box)) throw invalid(`${at}.box`, 'must be [x, y, w, h], fractions of the cover, inside it');
  if (a.role === 'base-art' && !a.box) throw invalid(`${at}.box`, 'base art needs the box it fills on the cover');
  if (a.checkBox !== undefined) {
    if (!inside(a.checkBox) || !a.box) throw invalid(`${at}.checkBox`, 'must be [x, y, w, h] inside the cover, beside a box');
    const [bx, by, bw, bh] = a.box, [cx, cy, cw, ch] = a.checkBox;
    if (cx < bx - 1e-9 || cy < by - 1e-9 || cx + cw > bx + bw + 1e-9 || cy + ch > by + bh + 1e-9) throw invalid(`${at}.checkBox`, 'must lie inside the art\'s box');
    if (cw * ch < COVER.artMinShare * bw * bh) throw invalid(`${at}.checkBox`, `must cover at least ${COVER.artMinShare * 100} % of the art's box`);
  }
  return { path: a.path, role: a.role, source: a.source, sha256: a.sha256, box: a.box || null, checkBox: a.checkBox || null, title: a.title === true };
}

// rasters: the static scan's raster paths, relative to the cover folder. Exit 22 for a missing
// listed file or a painted recipe without base art; exit 17 for an unlisted raster or a changed
// file; exit 16 for a malformed entry.
export function checkAssets({ out, recipe, rasters, coverDir = 'cover' }) {
  const file = join(out, ASSETS_FILE);
  let assets = [];
  if (existsSync(file)) {
    let doc;
    try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { throw invalid('', `is not valid JSON: ${error.message}`); }
    if (!doc || !Array.isArray(doc.assets)) throw invalid('assets', 'must be an array of { path, role, source, sha256 }');
    assets = doc.assets.map((a, i) => entry(a, i, coverDir));
    for (const a of assets) {
      const real = join(out, a.path);
      if (!existsSync(real)) throw exit(EXIT.BLOCKED_ASSET_MISSING, `BLOCKED_ASSET_MISSING: ${a.path} is listed in assets.json and missing; supply it or generate it, never draw a stand-in`);
      if (sha(readFileSync(real)) !== a.sha256) throw exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: ${a.path} no longer matches its sha256 in assets.json; list it again after changing it`);
    }
  }
  if (recipe === 'painted-light' && !assets.some((a) => a.role === 'base-art')) {
    throw exit(EXIT.BLOCKED_ASSET_MISSING, 'BLOCKED_ASSET_MISSING: the painted-light recipe needs its base art listed in assets.json ({ path, role: base-art, source, sha256, box }); supply or generate the painting, never draw a stand-in');
  }
  const listed = new Set(assets.map((a) => a.path));
  for (const rel of rasters) {
    const path = `${coverDir}/${rel.split(sep).join('/')}`;
    if (!listed.has(path)) throw exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: ${path} is a raster the page can load but assets.json does not list; list it with its role, source and sha256`);
  }
  return assets;
}

const toPx = (box, W, H) => box.map((v, k) => Math.round(v * (k % 2 ? H : W)));

// Frame 0 shows the base art: the check box (default: the whole art box) cut from decoded frame 0,
// against the same region of the source scaled into the art box. Boxes are cover fractions.
export function artCheck({ frame0, width, height, art, box, checkBox = null }) {
  const [bx, by, bw, bh] = toPx(box, width, height);
  const scaled = lanczosResize(art.rgba, art.width, art.height, bw, bh);
  const [cx, cy, cw, ch] = toPx(checkBox || box, width, height);
  const value = ssim(crop(frame0, width, [cx, cy, cw, ch]), crop(scaled, bw, [cx - bx, cy - by, cw, ch]), cw, ch);
  return { ssim: value, pass: value >= COVER.artSsim, checked: [cx, cy, cw, ch] };
}

// The labels the reply carries for every generated asset (complete prints them).
export function generatedLabels(out) {
  try {
    const doc = JSON.parse(readFileSync(join(out, ASSETS_FILE), 'utf8'));
    return (doc.assets || []).filter((a) => a?.source === 'generated' && typeof a.path === 'string')
      .map((a) => `the ${String(a.role || 'asset').replace('-', ' ')} ${a.path} was generated for this cover, not supplied: label it as generated in the reply`);
  } catch { return []; }
}
