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

// The payload-relative source a host-written bytecode path belongs to, or null.
// Only CPython's own layout counts: <dir>/__pycache__/<module>.<tag>[.opt-N].pyc.
function hostBytecodeSource(relative) {
  const segments = relative.split("/");
  if (segments.length < 2 || segments[segments.length - 2] !== "__pycache__") return null;
  const match = /^([^.]+)\.[a-zA-Z][a-zA-Z0-9_-]*(?:\.opt-[0-9]+)?\.pyc$/.exec(segments[segments.length - 1]);
  return match ? [...segments.slice(0, -2), `${match[1]}.py`].join("/") : null;
}

// Removes the host bytecode for one removed source module, then its cache
// folder once empty. Anything else in that folder stays where it is.
function removeHostBytecode(sourceFile) {
  const cacheDir = path.join(path.dirname(sourceFile), "__pycache__");
  if (!fs.lstatSync(cacheDir, { throwIfNoEntry: false })?.isDirectory()) return;
  const stem = path.basename(sourceFile, ".py");
  for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
    if (entry.isFile() && hostBytecodeSource(`__pycache__/${entry.name}`) === `${stem}.py`) {
      fs.unlinkSync(path.join(cacheDir, entry.name));
    }
  }
  if (fs.readdirSync(cacheDir).length === 0) fs.rmdirSync(cacheDir);
}

function removeEmptyDirs(dir, stopAt) {
  let current = dir;
  while (current && current !== stopAt && current.startsWith(stopAt) && fs.existsSync(current)) {
    if (fs.readdirSync(current).length > 0) break;
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

// No LitHermes state update holds a lock this long, so an older lock is stale even when its pid
// is alive again (pid reuse). An ownerless lock (holder died before writing its record) is
// stale after the shorter window.
const STATE_LOCK_MAX_HOLD_MS = 10 * 60 * 1000;
const STATE_LOCK_OWNERLESS_MS = 30 * 1000;

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

// The holder of a lock file: { pid, ageMs, stale, stat, label }, or null when nothing is there.
function inspectStateLock(lockPath, { pid = null, nowMs = Date.now() } = {}) {
  const stat = fs.lstatSync(lockPath, { throwIfNoEntry: false });
  if (!stat) return null;
  const ageMs = Math.max(0, nowMs - stat.mtimeMs);
  const owner = Number.isInteger(pid) && pid > 0 ? pid : null;
  const stale = ageMs >= STATE_LOCK_MAX_HOLD_MS
    || (owner === null ? ageMs >= STATE_LOCK_OWNERLESS_MS : !pidIsAlive(owner));
  const age = `age ${Math.round(ageMs / 1000)}s`;
  return { pid: owner, ageMs, stale, stat, label: owner === null ? `no owner record, ${age}` : `pid ${owner}, ${age}` };
}

// Atomically move a stale lock aside. False when the path was replaced after it was inspected.
function reclaimStateLock(lockPath, inspected) {
  const tombstone = `${lockPath}.stale-${crypto.randomBytes(8).toString("hex")}`;
  try {
    fs.renameSync(lockPath, tombstone);
  } catch {
    return false;
  }
  const moved = fs.lstatSync(tombstone, { throwIfNoEntry: false });
  if (moved && (moved.dev !== inspected.stat.dev || moved.ino !== inspected.stat.ino)) {
    // A fresh lock replaced the stale one in between: put it back and leave it to its holder.
    try { fs.linkSync(tombstone, lockPath); } catch {}
    try { fs.unlinkSync(tombstone); } catch {}
    return false;
  }
  try { fs.rmSync(tombstone, { recursive: true, force: true }); } catch {}
  return true;
}

module.exports = {
  cleanPythonCache,
  copyTree,
  hostBytecodeSource,
  inspectStateLock,
  inspectPythonCache,
  listFiles,
  reclaimStateLock,
  STATE_LOCK_MAX_HOLD_MS,
  removeEmptyDirs,
  removeHostBytecode,
  sha256,
  writeFileAtomic,
};
