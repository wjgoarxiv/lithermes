// A small PNG codec on node:zlib for cover mode, so the cover gate, the sheet and the tests read and
// write frames without the runtime cache. It reads 8-bit grey, grey+alpha, RGB, RGBA and palette
// images (non-interlaced, which is all Chrome, dwebp and this module write) and writes RGB.
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

// RGBA8 (or RGB8 with channels 3) -> PNG bytes, colour type 2, filter "up" on every row.
export function encodePng(pixels, width, height, { channels = 4, level = 6 } = {}) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(stride);
    for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) row[x * 3 + c] = pixels[(y * width + x) * channels + c];
    const at = y * (stride + 1);
    raw[at] = 2;
    for (let i = 0; i < stride; i++) raw[at + 1 + i] = (row[i] - previous[i]) & 255;
    previous = row;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level })), chunk('IEND', Buffer.alloc(0))]);
}

const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

// PNG bytes -> { width, height, rgba }.
export function decodePng(bytes) {
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0, palette = null, alpha = null;
  const idat = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(at), name = bytes.toString('latin1', at + 4, at + 8), data = bytes.subarray(at + 8, at + 8 + length);
    if (name === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (name === 'PLTE') palette = data;
    else if (name === 'tRNS') alpha = data;
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG (bit depth ${depth}, interlace ${interlace})`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`unsupported PNG colour type ${type}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride, up = out - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? px[out + i - channels] : 0, b = y ? px[up + i] : 0, c = y && i >= channels ? px[up + i - channels] : 0;
      const v = line[i];
      px[out + i] = (filter === 0 ? v : filter === 1 ? v + a : filter === 2 ? v + b : filter === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4, s = i * channels;
    if (type === 3) { const k = px[s]; rgba[o] = palette[k * 3]; rgba[o + 1] = palette[k * 3 + 1]; rgba[o + 2] = palette[k * 3 + 2]; rgba[o + 3] = alpha && k < alpha.length ? alpha[k] : 255; }
    else if (channels <= 2) { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[s]; rgba[o + 3] = channels === 2 ? px[s + 1] : 255; }
    else { rgba[o] = px[s]; rgba[o + 1] = px[s + 1]; rgba[o + 2] = px[s + 2]; rgba[o + 3] = channels === 4 ? px[s + 3] : 255; }
  }
  return { width, height, rgba };
}
