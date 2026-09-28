const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const zlib = require("node:zlib");

const packageRoot = path.resolve(__dirname, "..", "..");
const pluginRoot = path.join(packageRoot, "assets", "lithermes-plugin");
const uiuxRoot = path.join(pluginRoot, "skills", "frontend-ui-ux");
const visualQaRoot = path.join(pluginRoot, "skills", "visual-qa");
const uiuxRuntime = path.join(uiuxRoot, "scripts", "design_intelligence.py");
const visualQaRuntime = path.join(visualQaRoot, "scripts", "visual_qa.py");
const importerRuntime = path.join(uiuxRoot, "scripts", "import_design_intelligence.py");
const scenarioDriver = path.join(packageRoot, "test", "python", "run_uiux_visual_qa_scenarios.py");
const scenarioFixtures = path.join(packageRoot, "test", "fixtures", "uiux-visual-qa-scenarios");
const datasetPath = path.join(uiuxRoot, "resources", "design-intelligence.json");
const expectedDatasetHash = "a89011236a6ff14e12ec55fccbfab1bbd40ae34614cea5710c022121aa841bb8";
const expectedDatasetBytes = 1023482;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function requireFile(file, message) {
  assert.equal(fs.existsSync(file), true, `${message}: ${path.relative(packageRoot, file)}`);
  assert.equal(fs.statSync(file).isFile(), true, `${message} must be a regular file`);
}

function python(script, args, { input = "", env = {} } = {}) {
  return spawnSync("python3", [script, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: "1",
      ...env,
    },
    input,
    timeout: 30000,
  });
}

function parseJsonStdout(result, label) {
  assert.equal(result.signal, null, `${label} terminated by ${result.signal}`);
  assert.equal(result.error, undefined, `${label} failed to spawn: ${result.error?.message}`);
  assert.doesNotMatch(result.stderr, /\S/, `${label} wrote unexpected stderr`);
  assert.doesNotMatch(result.stdout, /^\s*$/, `${label} returned empty stdout`);
  assert.doesNotThrow(() => JSON.parse(result.stdout), `${label} stdout is not JSON:\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function snapshotTree(root) {
  const entries = [];
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      const relative = path.relative(root, file).replaceAll(path.sep, "/");
      if (item.isDirectory()) {
        visit(file);
      } else if (item.isFile()) {
        entries.push([relative, sha256(file)]);
      }
    }
  }
  visit(root);
  return entries.sort(([left], [right]) => left.localeCompare(right));
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data, { corruptCrc = false } = {}) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  const crc = crc32(Buffer.concat([typeBytes, data]));
  chunk.writeUInt32BE(corruptCrc ? (crc ^ 0xffffffff) >>> 0 : crc, 8 + data.length);
  return chunk;
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function filteredRows(width, height, pixels, filterType) {
  const rowBytes = width * 4;
  const raw = Buffer.alloc(height * (rowBytes + 1));
  for (let row = 0; row < height; row++) {
    raw[row * (rowBytes + 1)] = filterType;
    for (let column = 0; column < rowBytes; column++) {
      const index = row * rowBytes + column;
      const value = pixels[index];
      const left = column >= 4 ? pixels[index - 4] : 0;
      const above = row > 0 ? pixels[index - rowBytes] : 0;
      const upperLeft = row > 0 && column >= 4 ? pixels[index - rowBytes - 4] : 0;
      const encoded = filterType === 0
        ? value
        : filterType === 1
          ? value - left
          : filterType === 2
            ? value - above
            : filterType === 3
              ? value - Math.floor((left + above) / 2)
              : value - paeth(left, above, upperLeft);
      raw[row * (rowBytes + 1) + column + 1] = encoded & 0xff;
    }
  }
  return raw;
}

function rgbaPng(
  width,
  height,
  { corruptIhdrCrc = false, filterType = 0, pixels, splitIdat = false, breakIdatOrder = false } = {},
) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rowBytes = width * 4;
  const pixelBytes = pixels || Buffer.alloc(height * rowBytes);
  assert.equal(pixelBytes.length, width * height * 4);
  const compressed = zlib.deflateSync(filteredRows(width, height, pixelBytes, filterType));
  const middle = Math.max(1, Math.floor(compressed.length / 2));
  const idatChunks = splitIdat
    ? [
        pngChunk("IDAT", compressed.subarray(0, middle)),
        ...(breakIdatOrder ? [pngChunk("tEXt", Buffer.from("gap"))] : []),
        pngChunk("IDAT", compressed.subarray(middle)),
      ]
    : [pngChunk("IDAT", compressed)];
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header, { corruptCrc: corruptIhdrCrc }),
    ...idatChunks,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

module.exports = {
  assert, datasetPath, expectedDatasetBytes, expectedDatasetHash, fs, importerRuntime, os,
  packageRoot, parseJsonStdout, path, pluginRoot, pngChunk, python, readJson, requireFile,
  rgbaPng, scenarioDriver, scenarioFixtures, sha256, snapshotTree, spawnSync, test,
  uiuxRoot, uiuxRuntime, visualQaRoot, visualQaRuntime, zlib,
};
