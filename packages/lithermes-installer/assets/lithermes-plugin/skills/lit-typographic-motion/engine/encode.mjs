// Output side: PNG helpers, contact sheet, the pinned master encode (MO-A-03)
// and the preview encoder + size ladders (MO-A-38). ffmpeg is always the last
// stage; Chrome never writes a video.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUTPUT } from './constants.mjs';
import { FlashDetector } from './flash.mjs';

// Video only: sound is muxed afterwards by sound.mjs (padded or trimmed to the
// film, never -shortest), so a track can never shorten or silently drop out.
export function masterArgs({ width, height, fps, output }) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0'];
  // setparams: ffmpeg 8.1 leaves primaries/transfer "unknown" from the output flags alone.
  args.push('-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(OUTPUT.crf), '-tune', 'grain', '-x264-params', 'aq-mode=3',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart');
  args.push(output);
  return args;
}

export function hasFfmpeg(env = process.env) {
  return spawnSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore', env }).status === 0;
}

export function startMaster(options) {
  const child = spawn('ffmpeg', masterArgs(options), { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, stderr })));
  return {
    async write(bytes) {
      if (!child.stdin.write(bytes)) await new Promise((resolve) => child.stdin.once('drain', resolve));
    },
    async finish() { child.stdin.end(); return done; },
  };
}

export function ffprobe(file) {
  const out = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,width,height,r_frame_rate,avg_frame_rate,pix_fmt,color_space,color_primaries,color_transfer,color_range,nb_frames:format=duration',
    '-of', 'json', file], { encoding: 'utf8' });
  if (out.status !== 0) return null;
  const parsed = JSON.parse(out.stdout);
  const stream = parsed.streams?.[0] || {};
  const [num, den] = String(stream.r_frame_rate || '0/1').split('/').map(Number);
  return { ...stream, fps: den ? num / den : 0, duration: Number(parsed.format?.duration || 0) };
}

// Delivered PNGs use deflateStrategy 1 (filtered): pngjs's default RLE made a
// lossless 1080p poster 4.5x larger for the same pixels. Scratch frames that
// only feed an encoder keep the much faster RLE (`scratch: true`).
export function pngEncode(PNG, rgba, width, height, { gray = false, level = 6, scratch = false } = {}) {
  const options = { width, height, colorType: gray ? 0 : 2, inputColorType: gray ? 0 : 6, inputHasAlpha: !gray, deflateLevel: level, deflateStrategy: scratch ? 3 : 1, filterType: -1 };
  const png = new PNG(options);
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  return PNG.sync.write(png, options);
}

export function pngDecode(PNG, file) {
  const png = PNG.sync.read(readFileSync(file));
  return { data: png.data, width: png.width, height: png.height };
}

// Box-filter downscale (area average), which also averages grain away.
export function areaResize(src, width, height, targetWidth) {
  const targetHeight = Math.round((height * targetWidth) / width);
  const out = Buffer.alloc(targetWidth * targetHeight * 4);
  const xs = Array.from({ length: targetWidth + 1 }, (_, i) => Math.round((i * width) / targetWidth));
  const ys = Array.from({ length: targetHeight + 1 }, (_, i) => Math.round((i * height) / targetHeight));
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = ys[y]; sy < Math.max(ys[y] + 1, ys[y + 1]); sy++) {
        let at = (sy * width + xs[x]) * 4;
        for (let sx = xs[x]; sx < Math.max(xs[x] + 1, xs[x + 1]); sx++, at += 4) { r += src[at]; g += src[at + 1]; b += src[at + 2]; n++; }
      }
      const o = (y * targetWidth + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = 255;
    }
  }
  return { data: out, width: targetWidth, height: targetHeight };
}

// 3x5 digits for frame labels on the contact sheet.
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
function stamp(buf, width, x, y, text, scale = 3) {
  let cx = x;
  for (const ch of String(text)) {
    const glyph = DIGITS[Number(ch)];
    if (glyph) for (let i = 0; i < 15; i++) if (glyph[i] === '1') {
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const o = ((y + Math.floor(i / 3) * scale + dy) * width + cx + (i % 3) * scale + dx) * 4;
        buf[o] = 255; buf[o + 1] = 255; buf[o + 2] = 255; buf[o + 3] = 255;
      }
    }
    cx += 4 * scale;
  }
}

export function contactSheet(PNG, tiles, file, { columns, cellWidth } = {}) {
  const portrait = tiles[0] && tiles[0].height > tiles[0].width;
  columns ??= portrait ? 6 : 4;
  cellWidth ??= portrait ? 270 : 480;
  const cellHeight = Math.round((cellWidth * (tiles[0]?.height || 9)) / (tiles[0]?.width || 16)), label = 22, pad = 6;
  const rows = Math.ceil(tiles.length / columns);
  const width = columns * (cellWidth + pad) + pad, height = rows * (cellHeight + label + pad) + pad;
  const sheet = Buffer.alloc(width * height * 4);
  for (let i = 0; i < sheet.length; i += 4) { sheet[i] = 30; sheet[i + 1] = 32; sheet[i + 2] = 36; sheet[i + 3] = 255; }
  tiles.forEach((tile, index) => {
    const small = areaResize(tile.data, tile.width, tile.height, cellWidth);
    const left = pad + (index % columns) * (cellWidth + pad);
    const top = pad + Math.floor(index / columns) * (cellHeight + label + pad);
    stamp(sheet, width, left + 2, top + 3, tile.frame, 3);
    for (let y = 0; y < Math.min(cellHeight, small.height); y++) {
      small.data.copy(sheet, ((top + label + y) * width + left) * 4, y * cellWidth * 4, (y + 1) * cellWidth * 4);
    }
  });
  writeFileSync(file, pngEncode(PNG, sheet, width, height));
  return { width, height, tiles: tiles.length };
}

function encoderLadder(env = process.env) {
  const encoders = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8', env }).stdout || '';
  const rungs = [];
  if (/libwebp_anim/.test(encoders)) rungs.push('libwebp_anim');
  if (spawnSync('img2webp', ['-version'], { stdio: 'ignore', env }).status === 0) rungs.push('img2webp');
  rungs.push('gif');
  return rungs;
}

// Preview: the first encoder rung that works, then the first size rung <= 3 MB.
// Every frame handed to the encoder goes through the looping flash audit first.
// Rungs are keyed on the long edge (960, 720, 540), so a 9:16 source gets
// 540x960, 405x720 and 304x540 previews.
export function encodePreview({ PNG, sourceFrames, masterFps, durationSec, workDir, minGlyphPx = 32, env = process.env, sourceWidth = 1920, sourceHeight = 1080 }) {
  const rungs = encoderLadder(env);
  const attempts = [];
  const longEdge = Math.max(sourceWidth, sourceHeight);
  for (const [long, fps] of OUTPUT.previewLadder) {
    const scale = long / longEdge;
    const width = Math.round(sourceWidth * scale);
    if (long < OUTPUT.previewMinWidth || minGlyphPx * scale < OUTPUT.previewMinGlyphPx) { attempts.push({ width, fps, skipped: 'smallest glyph under 10 px' }); continue; }
    const dir = join(workDir, `preview-${width}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const count = Math.max(1, Math.round(durationSec * fps));
    const detector = new FlashDetector(width, Math.round(sourceHeight * scale));
    const records = [];
    const files = [];
    for (let i = 0; i < count; i++) {
      const want = Math.min(Math.round((i * masterFps) / fps), sourceFrames.length - 1);
      let index = want;
      while (index > 0 && !sourceFrames[index]) index--;
      const source = pngDecode(PNG, sourceFrames[index]);
      const frame = source.width === width ? source : areaResize(source.data, source.width, source.height, width);
      const flash = detector.push(frame.data);
      records.push({ frame: i, general: flash.general, generalBoth: flash.generalBoth, red: flash.red, redBoth: flash.redBoth });
      const file = join(dir, `p${String(i).padStart(5, '0')}.png`);
      writeFileSync(file, pngEncode(PNG, frame.data, frame.width, frame.height, { level: 1, scratch: true }));
      files.push(file);
    }
    for (const encoder of rungs) {
      const output = join(workDir, encoder === 'gif' ? 'preview.gif' : 'preview.webp');
      rmSync(output, { force: true });
      let result;
      if (encoder === 'img2webp') {
        const args = ['-loop', '0', '-lossy', '-q', '72', '-m', '4'];
        for (const file of files) args.push('-d', String(Math.round(1000 / fps)), file);
        args.push('-o', output);
        result = spawnSync('img2webp', args, { encoding: 'utf8', env, timeout: 900000 });
      } else if (encoder === 'libwebp_anim') {
        result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps), '-i', join(dir, 'p%05d.png'), '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', '72', '-loop', '0', output], { encoding: 'utf8', env, timeout: 900000 });
      } else {
        result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps), '-i', join(dir, 'p%05d.png'), '-vf', 'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', '-loop', '0', output], { encoding: 'utf8', env, timeout: 900000 });
      }
      const ok = result.status === 0 && existsSync(output);
      const bytes = ok ? statSync(output).size : null;
      attempts.push({ width, fps, encoder, ok, bytes, error: ok ? null : (result.stderr || result.error?.message || '').split('\n')[0] });
      if (!ok) continue;
      rmSync(dir, { recursive: true, force: true });
      if (bytes <= OUTPUT.previewMaxBytes || long === OUTPUT.previewLadder.at(-1)[0]) {
        return { file: output, encoder, width, fps, bytes, records, attempts };
      }
      break;
    }
    rmSync(dir, { recursive: true, force: true });
  }
  return { file: null, encoder: null, attempts, records: [] };
}
