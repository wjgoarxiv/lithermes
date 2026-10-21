// One cover frame off the capture thread: decode the 2x capture, Lanczos it down to the cover size,
// write it as an RGB PNG (the encoder's input and what G0 and the seek-order check hash), and
// return that PNG's SHA-256 with the size that was captured.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';
import { lanczosResize } from './cover-image.mjs';
import { decodePng, encodePng } from './cover-png.mjs';

parentPort.on('message', ({ id, png, width, height, file }) => {
  try {
    const src = decodePng(Buffer.from(png));
    const bytes = encodePng(lanczosResize(src.rgba, src.width, src.height, width, height), width, height, { level: 1 });
    if (file) writeFileSync(file, bytes);
    parentPort.postMessage({ id, sha256: createHash('sha256').update(bytes).digest('hex'), captured: `${src.width}x${src.height}` });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error.message || error) });
  }
});
