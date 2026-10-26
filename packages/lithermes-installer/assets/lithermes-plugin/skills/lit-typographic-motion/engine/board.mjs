// The storyboard: `stills/board.png`, one page a person reads before the full render. One
// keyframe per shot (the beat still) with number, time, layout and hand-off under it and its
// hero move in words, the shot's type zone outlined on the frame; a header with the house style
// (name, palette and type) plus format, length and sound; a footer with the layout check. It is
// drawn as a page in the same headless Chrome the stage uses, so its type is the product's faces.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LAYOUTS, readStyle } from './styles.mjs';
import { ORIGIN, openStage } from './stage.mjs';

export const BOARD = Object.freeze({ width: 1920, height: 1080, margin: 48, gap: 20, header: 150, footer: 56, caption: 104 });

const esc = (text) => String(text ?? '').replace(/[&<>"]/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const secs = (value) => `${Number(value).toFixed(1)}`;

/** Tile geometry: columns and thumbnail size for n shots of a width x height film. */
export function boardGrid(n, width, height) {
  const usableW = BOARD.width - 2 * BOARD.margin;
  const usableH = BOARD.height - BOARD.header - BOARD.footer - BOARD.margin;
  const aspect = width / height;
  const options = [];
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const tw = Math.floor((usableW - (cols - 1) * BOARD.gap) / cols);
    const th = Math.min(Math.round(tw / aspect), Math.floor((usableH - (rows - 1) * BOARD.gap) / rows) - BOARD.caption);
    if (th <= 0) continue;
    options.push({ cols, rows, tw: Math.round(th * aspect), th, empty: rows * cols - n });
  }
  // The largest tiles win, unless a grid with fewer empty slots keeps 85 % of their area.
  const largest = Math.max(...options.map((option) => option.tw * option.th));
  return options.filter((option) => option.tw * option.th >= 0.85 * largest).sort((a, b) => a.empty - b.empty || b.tw * b.th - a.tw * a.th)[0];
}

/** The board page HTML for a treatment and its beat stills (names relative to the page). */
export function boardHtml({ treatment, stills, check = null }) {
  const style = treatment.style ? readStyle(treatment.style) : null;
  const [width, height] = treatment.format === '9:16' ? [1080, 1920] : [1920, 1080];
  const grid = boardGrid(stills.length, width, height);
  const zones = LAYOUTS[treatment.format === '9:16' ? '9:16' : '16:9'];
  const palette = style?.palette ?? {};
  const chips = Object.entries(palette).filter(([key]) => ['ground', 'ink', 'muted', 'signal', 'accent'].includes(key))
    .map(([key, value]) => `<span class="chip"><i style="background:${esc(value)}"></i>${esc(key)} ${esc(value)}</span>`).join('');
  const tiles = stills.map((file, index) => {
    const beat = treatment.beats[index] ?? {};
    const zone = beat.layout && zones[beat.layout]?.type;
    const guide = zone ? `<b class="zone" style="left:${(zone[0] * 100).toFixed(2)}%;top:${(zone[1] * 100).toFixed(2)}%;width:${(zone[2] * 100).toFixed(2)}%;height:${(zone[3] * 100).toFixed(2)}%"></b>` : '';
    const meta = [String(index + 1).padStart(2, '0'), `${secs(beat.t0)}–${secs(beat.t1)} s`, beat.layout, beat.transition && beat.transition !== 'end' ? `→ ${beat.transition}` : beat.transition].filter(Boolean).map(esc).join('  ·  ');
    return `<figure style="width:${grid.tw}px"><div class="frame" style="width:${grid.tw}px;height:${grid.th}px"><img src="${esc(file)}">${guide}</div>`
      + `<figcaption><span class="meta">${meta}</span><span class="hero">${esc(beat.hero ?? beat.onScreen ?? '')}</span></figcaption></figure>`;
  }).join('');
  const failed = (check?.rules ?? []).filter((rule) => rule.status === 'FAIL');
  const verdict = !check ? 'layout check: not run on this render'
    : failed.length ? `layout check: FAIL — ${failed.map((rule) => rule.id).join(', ')}` : 'layout check: PASS';
  const sound = treatment.sound?.mode === 'score' && treatment.style
    ? `score (${readStyle(treatment.style).score.genre})` : treatment.sound?.mode ?? 'none';
  const ground = palette.ground ?? '#101216';
  return `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="/lit/fonts.css">
<style>
  html, body { margin: 0; width: ${BOARD.width}px; height: ${BOARD.height}px; overflow: hidden; background: #15171b; color: #e8e9e6; font-family: "Pretendard"; }
  header { position: absolute; left: ${BOARD.margin}px; right: ${BOARD.margin}px; top: 36px; height: ${BOARD.header - 48}px; display: flex; justify-content: space-between; align-items: flex-start; }
  h1 { margin: 0; font: 700 40px/1.1 "Pretendard"; }
  .sub { margin-top: 10px; font: 400 20px/1.3 "MesloLGS NF"; color: #a8aba6; }
  .style { text-align: right; }
  .specimen { display: inline-block; padding: 6px 14px; margin-bottom: 10px; background: ${esc(ground)}; color: ${esc(palette.ink ?? '#fff')}; font: ${style?.faces.display.weight ?? 700} 34px/1.1 "${esc(style?.faces.display.family ?? 'Pretendard')}", "Pretendard"; }
  .chips { display: flex; gap: 14px; justify-content: flex-end; font: 400 16px/1 "MesloLGS NF"; color: #a8aba6; }
  .chip i { display: inline-block; width: 16px; height: 16px; margin-right: 6px; vertical-align: -3px; border: 1px solid #555; }
  main { position: absolute; left: ${BOARD.margin}px; right: ${BOARD.margin}px; top: ${BOARD.header}px; display: flex; flex-wrap: wrap; gap: ${BOARD.gap}px; }
  figure { margin: 0; }
  .frame { position: relative; overflow: hidden; background: #000; }
  .frame img { display: block; width: 100%; height: 100%; }
  .zone { position: absolute; box-sizing: border-box; border: 2px dashed rgba(255, 196, 0, 0.75); }
  figcaption { display: block; height: ${BOARD.caption - 8}px; padding-top: 8px; overflow: hidden; }
  .meta { display: block; font: 400 16px/1.3 "MesloLGS NF"; color: #c9cbc6; }
  .hero { display: block; margin-top: 4px; font: 400 18px/1.35 "Pretendard"; color: #e8e9e6; }
  footer { position: absolute; left: ${BOARD.margin}px; right: ${BOARD.margin}px; bottom: 18px; font: 400 18px/1.2 "MesloLGS NF"; color: ${failed.length ? '#ff8a7a' : '#9fd3a4'}; }
</style>
<body>
<header>
  <div><h1>Storyboard · ${esc(treatment.subject?.name ?? '')}</h1>
  <div class="sub">${esc(treatment.format)} · ${esc(treatment.durationSec)} s · ${treatment.beats.length} shots · ${esc(treatment.path)} path · sound: ${esc(sound)}</div></div>
  <div class="style"><div class="specimen">${esc(style?.name ?? treatment.style ?? '')} Aa 가</div><div class="chips">${chips}</div></div>
</header>
<main>${tiles}</main>
<footer>${esc(verdict)} · dashed box: the shot's type zone</footer>
<script>window.__litBoard = true;</script>
</body>
`;
}

/**
 * Render `<out>/stills/board.png` from the beat stills already written. Returns the file path.
 * `open({ stageDir, width, height })` opens the stage renderer on a directory; `check` is the
 * layout check ({ rules }) drawn with its verdict onto the board.
 */
export async function writeBoard({ out, treatment, beatFiles, check = null, open }) {
  const dir = path.join(out, '.run', 'board');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const names = beatFiles.map((file, index) => {
    const name = `s${String(index + 1).padStart(2, '0')}.png`;
    copyFileSync(file, path.join(dir, name));
    return name;
  });
  writeFileSync(path.join(dir, 'index.html'), boardHtml({ treatment, stills: names, check }));
  const browser = await open({ stageDir: dir, width: BOARD.width, height: BOARD.height });
  try {
    await browser.page.goto(`${ORIGIN}/index.html`, { waitUntil: 'load', timeout: 120000 });
    await browser.page.waitForTimeout(900);
    const png = await browser.capture();
    const file = path.join(out, 'stills', 'board.png');
    writeFileSync(file, png);
    return file;
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Add a file the renderer wrote after the stills set to `stills/stills.json`; returns the new set SHA-256. */
export function addToStills(out, entry, { sha256 }) {
  const indexFile = path.join(out, 'stills', 'stills.json');
  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  const file = path.join(out, entry.file);
  if (!existsSync(file)) throw new Error(`addToStills: ${entry.file} was not written`);
  const bytes = readFileSync(file);
  index.files = [...index.files.filter((f) => f.file !== entry.file), { ...entry, sha256: sha256(bytes) }];
  const out2 = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
  writeFileSync(indexFile, out2);
  return sha256(out2);
}
