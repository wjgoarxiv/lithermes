// Decode one captured PNG off the main thread: RGBA bytes, their SHA-256, the
// 99.5th-percentile linear luminance (for the empty-run rule) and, when asked,
// an area-downscaled copy for the preview.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';
import { areaResize } from './encode.mjs';

const { PNG } = createRequire(workerData.requireFrom)('pngjs');
const LIN = Float64Array.from({ length: 256 }, (_, v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });

parentPort.on('message', ({ id, png, preview }) => {
  try {
    const image = PNG.sync.read(Buffer.from(png));
    const rgba = new Uint8Array(image.data);
    const bins = new Uint32Array(1024);
    for (let i = 0; i < rgba.length; i += 4) bins[Math.min(1023, Math.floor((0.2126 * LIN[rgba[i]] + 0.7152 * LIN[rgba[i + 1]] + 0.0722 * LIN[rgba[i + 2]]) * 1024))]++;
    let acc = 0, p995 = 1;
    const target = 0.995 * (rgba.length / 4);
    for (let i = 0; i < 1024; i++) { acc += bins[i]; if (acc >= target) { p995 = (i + 1) / 1024; break; } }
    const out = { id, width: image.width, height: image.height, sha: createHash('sha256').update(rgba).digest('hex'), lumP995: Number(p995.toFixed(4)), rgba: rgba.buffer };
    const transfer = [rgba.buffer];
    if (preview) {
      const small = areaResize(rgba, image.width, image.height, preview);
      const buf = new Uint8Array(small.data);
      Object.assign(out, { small: buf.buffer, smallWidth: small.width, smallHeight: small.height });
      transfer.push(buf.buffer);
    }
    parentPort.postMessage(out, transfer);
  } catch (error) {
    parentPort.postMessage({ id, error: String(error.message || error) });
  }
});
