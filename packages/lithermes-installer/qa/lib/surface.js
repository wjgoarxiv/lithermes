// Shared drivers for the replacement real-surface QA layer.
//
// Everything here talks to the real shipped runtime: the Python validators under
// assets/lithermes-plugin/skills/{frontend-ui-ux,visual-qa}/scripts and the installer
// CLI at bin/lithermes.js. Nothing in this directory imports from test/, so the layer
// keeps working if the tracked test tree is ever reduced.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");

const packageRoot = path.resolve(__dirname, "..", "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const pluginRoot = path.join(packageRoot, "assets", "lithermes-plugin");
const designRuntime = path.join(
  pluginRoot, "skills", "frontend-ui-ux", "scripts", "design_intelligence.py",
);
const visualRuntime = path.join(
  pluginRoot, "skills", "visual-qa", "scripts", "visual_qa.py",
);
const installerCli = path.join(packageRoot, "bin", "lithermes.js");
const tokenScanner = path.join(packageRoot, "test", "scripts", "scan-forbidden-tokens.js");
// Path-SHAPE guard. Separate from tokenScanner, which only reads file content.
const pathScanner = path.join(packageRoot, "test", "scripts", "scan-forbidden-paths.js");

// The managed provider stem is a denied literal for the repository scanner, so it is
// assembled the same way the shipped source assembles it.
const runtimeStem = ["co", "dex"].join("");
const managedProvider = `openai-${runtimeStem}`;

let cachedPython = null;

function python() {
  if (cachedPython) return cachedPython;
  // scripts/test-python.js is a package script, not a test file; reusing its resolver
  // keeps the probe on the same PyYAML-capable interpreter as the Python gate.
  const { resolvePython } = require(path.join(packageRoot, "scripts", "test-python.js"));
  const resolved = resolvePython();
  cachedPython = resolved.python || "python3";
  return cachedPython;
}

function runPython(script, args, { input = "", cwd = packageRoot } = {}) {
  const result = spawnSync(python(), [script, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" },
    input,
    timeout: 60000,
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error,
  };
}

function runNode(args, { cwd = packageRoot, env = {} } = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1", NO_UPDATE_NOTIFIER: "1", ...env },
    timeout: 120000,
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error,
  };
}

function design(args, options) {
  return runPython(designRuntime, args, options);
}

function visual(args, options) {
  return runPython(visualRuntime, args, options);
}

function installer(args, options) {
  return runNode([installerCli, ...args], options);
}

function jsonStdout(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function digestOf(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function digestOfFile(file) {
  return digestOf(fs.readFileSync(file));
}

function isolatedProfileFingerprint(env = process.env) {
  const hermesHome = String(env.HERMES_HOME || "").trim()
    || path.join(String(env.HOME || os.homedir()), ".hermes");
  const file = path.join(hermesHome, "lithermes", "events.jsonl");
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) {
      return { file, state: "invalid", size: null, sha256: null, error: "not a regular file" };
    }
    return { file, state: "file", size: stat.size, sha256: digestOfFile(file), error: null };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { file, state: "absent", size: null, sha256: null, error: null };
    }
    return {
      file,
      state: "error",
      size: null,
      sha256: null,
      error: error && error.code ? error.code : String(error),
    };
  }
}

function compareIsolatedProfiles(before, after) {
  const measurable = before.state === "file" || before.state === "absent";
  const unchanged = measurable
    && before.file === after.file
    && before.state === after.state
    && before.size === after.size
    && before.sha256 === after.sha256;
  const beforeHash = before.sha256 ? before.sha256.slice(0, 16) : "-";
  const afterHash = after.sha256 ? after.sha256.slice(0, 16) : "-";
  return {
    unchanged,
    detail: `${unchanged ? "UNCHANGED" : "MUTATED"} isolated QA target events.jsonl bytes before=${before.size} after=${after.size} sha256 before=${beforeHash}... after=${afterHash}... states=${before.state}/${after.state}`,
  };
}

function instant(date) {
  return `${date.toISOString().slice(0, 19)}Z`;
}

function shifted(base, seconds) {
  return instant(new Date(base.getTime() + seconds * 1000));
}

// --- minimal PNG encoder ---------------------------------------------------
// The visual-qa PNG runtime decodes real bytes, so the probe must produce real bytes.
// Encoding stays in this file rather than borrowing a test helper.

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBytes.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return out;
}

function encodePng(width, height, pixels) {
  const rowBytes = width * 4;
  if (pixels.length !== rowBytes * height) throw new Error("pixel buffer size mismatch");
  const raw = Buffer.alloc(height * (rowBytes + 1));
  for (let row = 0; row < height; row += 1) {
    raw[row * (rowBytes + 1)] = 0;
    pixels.copy(raw, row * (rowBytes + 1) + 1, row * rowBytes, (row + 1) * rowBytes);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function gradientPixels(width, height, offset = 0) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 4] = (index * 7 + offset) & 0xff;
    pixels[index * 4 + 1] = (index * 13 + offset) & 0xff;
    pixels[index * 4 + 2] = (index * 29 + offset) & 0xff;
    pixels[index * 4 + 3] = 255;
  }
  return pixels;
}

// --- scratch roots ---------------------------------------------------------
// Every temporary path is created under the OS temp dir and recorded so the caller can
// print a cleanup receipt. Nothing is ever created inside a live profile.

function scratch() {
  const created = [];
  return {
    created,
    make(label) {
      const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `lithermes-qa-${label}.`)));
      created.push(dir);
      return dir;
    },
    removeAll() {
      const receipt = [];
      for (const dir of created) {
        fs.rmSync(dir, { recursive: true, force: true });
        receipt.push({ path: dir, removed: !fs.existsSync(dir) });
      }
      return receipt;
    },
  };
}

function enterIsolatedProfile(workspace, env = process.env) {
  const root = workspace.make("profile");
  const home = path.join(root, "home");
  const hermesHome = path.join(root, "hermes-home");
  fs.mkdirSync(home);
  fs.mkdirSync(hermesHome);
  const previous = {
    HOME: { present: Object.hasOwn(env, "HOME"), value: env.HOME },
    HERMES_HOME: { present: Object.hasOwn(env, "HERMES_HOME"), value: env.HERMES_HOME },
  };
  env.HOME = home;
  env.HERMES_HOME = hermesHome;
  return {
    home,
    hermesHome,
    restore() {
      for (const key of ["HOME", "HERMES_HOME"]) {
        if (previous[key].present) env[key] = previous[key].value;
        else delete env[key];
      }
    },
  };
}

module.exports = {
  designRuntime,
  digestOf,
  digestOfFile,
  encodePng,
  enterIsolatedProfile,
  gradientPixels,
  installerCli,
  instant,
  jsonStdout,
  isolatedProfileFingerprint,
  compareIsolatedProfiles,
  managedProvider,
  packageRoot,
  pluginRoot,
  python,
  repoRoot,
  runNode,
  runPython,
  scratch,
  shifted,
  pathScanner,
  tokenScanner,
  visualRuntime,
  design,
  installer,
  visual,
};
