const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function listFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const name of fs.readdirSync(root)) {
    if (name === "__pycache__" || name.endsWith(".pyc")) continue;
    const full = path.join(root, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      out.push(...listFiles(full));
    } else if (stat.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function copyTree(src, dest) {
  const copied = [];
  for (const file of listFiles(src)) {
    const relative = path.relative(src, file);
    const target = path.join(dest, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
    copied.push({ path: relative, sha256: sha256(target) });
  }
  return copied;
}

function cleanPythonCache(root) {
  let removed = 0;
  if (!fs.existsSync(root)) return removed;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory() && entry.name === "__pycache__") {
      fs.rmSync(full, { recursive: true, force: true });
      removed += 1;
    } else if (entry.isDirectory()) {
      removed += cleanPythonCache(full);
    } else if (entry.isFile() && /\.py[co]$/.test(entry.name)) {
      fs.rmSync(full, { force: true });
      removed += 1;
    }
  }
  return removed;
}

function inspectPythonCache(root) {
  let entries = 0;
  if (!fs.existsSync(root)) return entries;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      entries += inspectPythonCache(full);
    } else if (entry.isFile() && /\.py[co]$/.test(entry.name)) {
      entries += 1;
    }
  }
  return entries;
}

// Atomic write: write to a .tmp sibling, fsync, then rename into place.
// fsync failure is non-fatal (degrades gracefully — still renames).
function writeFileAtomic(filePath, data, encoding) {
  const enc = encoding || "utf8";
  const prefix = `.${path.basename(filePath)}.${process.pid}.`;
  let tmp;
  let fd;
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      tmp = path.join(path.dirname(filePath), `${prefix}${crypto.randomBytes(8).toString("hex")}.tmp`);
      try {
        fd = fs.openSync(tmp, "wx", 0o600);
        break;
      } catch (error) {
        if (error.code !== "EEXIST" || attempt === 9) throw error;
      }
    }
    fs.fchmodSync(fd, 0o600);
    fs.writeSync(fd, data, null, enc);
    try {
      fs.fsyncSync(fd);
    } catch {
      // fsync not supported on all platforms/fs; degrade gracefully
    }
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, filePath);
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Preserve the original write/close error.
      }
    }
    if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp);
    throw error;
  }
}

function removeEmptyDirs(dir, stopAt) {
  let current = dir;
  while (current && current !== stopAt && current.startsWith(stopAt) && fs.existsSync(current)) {
    if (fs.readdirSync(current).length > 0) break;
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

module.exports = {
  cleanPythonCache,
  copyTree,
  inspectPythonCache,
  listFiles,
  removeEmptyDirs,
  sha256,
  writeFileAtomic,
};
