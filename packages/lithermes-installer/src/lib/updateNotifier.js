const { assertPluginParent, assertStateParent, assertManagedDirectory } = require("./hermesDiscovery");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { writeFileAtomic } = require("./files");
const { defaultHermesHome } = require("./hermesDiscovery");

const PACKAGE_NAME = "@litfamily/lithermes";
const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/latest`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 3000;
const UPDATE_LOCK_STALE_MS = 30 * 1000;
const OWNER_PATTERN = /^[a-f0-9]{32}$/;
const AUTO_UPDATE_TIMEOUT_MS = 30 * 1000;
const AUTO_UPDATE_LOCK_STALE_MS = 2 * AUTO_UPDATE_TIMEOUT_MS;
const AUTO_UPDATE_LOCK_NAME = "auto-update.lock";
const AUTO_UPDATE_JOURNAL_NAME = "auto-update-journal.json";
const AUTO_UPDATE_RECEIPT_NAME = "auto-update-receipt.json";
const AUTO_UPDATE_GUARD_ENV = "LITHERMES_AUTO_UPDATE_RUNNING";
const AUTO_UPDATE_TRIGGER_COMMANDS = new Set(["install", "check", "doctor"]);
const AUTO_UPDATE_INERT_COMMANDS = new Set(["help", "--help", "-h", "version", "--version", "-v", "uninstall", "hud"]);

function parseStableSemver(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compareStableSemver(left, right) {
  const a = parseStableSemver(left);
  const b = parseStableSemver(right);
  if (!a || !b) return null;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function validTimestamp(value, now = Date.now()) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > now) return false;
  return new Date(timestamp).toISOString() === value;
}

function parseUpdateCache(text, { now = Date.now() } = {}) {
  try {
    const value = JSON.parse(String(text));
    if (!value || Array.isArray(value) || typeof value !== "object") return null;
    if (value.schemaVersion !== 1 || value.packageName !== PACKAGE_NAME || !validTimestamp(value.attemptedAt, now)) return null;
    const parsed = {
      schemaVersion: 1,
      packageName: PACKAGE_NAME,
      attemptedAt: value.attemptedAt,
    };
    if (value.attemptOwner !== undefined) {
      if (typeof value.attemptOwner !== "string" || !OWNER_PATTERN.test(value.attemptOwner)) return null;
      parsed.attemptOwner = value.attemptOwner;
    }
    const hasResult = value.checkedAt !== undefined || value.latestVersion !== undefined;
    if (hasResult) {
      if (!validTimestamp(value.checkedAt, now) || !parseStableSemver(value.latestVersion)) return null;
      parsed.checkedAt = value.checkedAt;
      parsed.latestVersion = value.latestVersion;
    }
    return parsed;
  } catch {
    return null;
  }
}

function readUpdateCache(cachePath, { readFileSync = fs.readFileSync, now = Date.now() } = {}) {
  let fd;
  try {
    const home = path.dirname(path.dirname(cachePath));
    const state = assertStateParent(home);
    const before = fs.lstatSync(cachePath, { throwIfNoEntry: false });
    if (!before?.isFile()) return null;
    fd = fs.openSync(cachePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) return null;
    assertStateParent(home, state);
    const text = readFileSync(fd, "utf8");
    assertStateParent(home, state);
    const after = fs.lstatSync(cachePath, { throwIfNoEntry: false });
    if (!after?.isFile() || after.dev !== before.dev || after.ino !== before.ino) return null;
    if (Buffer.byteLength(String(text), "utf8") > MAX_RESPONSE_BYTES) return null;
    return parseUpdateCache(text, { now });
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function shouldRefreshCache(cache, now = Date.now()) {
  if (!cache || !validTimestamp(cache.attemptedAt, now)) return true;
  const attemptedAt = Date.parse(cache.attemptedAt);
  return attemptedAt > now || now - attemptedAt >= CACHE_TTL_MS;
}

function shouldCheckForUpdates({
  command,
  flags = {},
  env = {},
  streams = {},
  hermesHome,
  existsSync = fs.existsSync,
  isNodeRuntime = process.release?.name === "node" && !process.versions.bun,
}) {
  if (!isNodeRuntime) return false;
  if (!new Set(["install", "check", "doctor"]).has(command)) return false;
  if (["offline", "json", "dry-run"].some((flag) => Object.prototype.hasOwnProperty.call(flags, flag))) return false;
  if (["CI", "NO_UPDATE_NOTIFIER", "LITHERMES_NO_UPDATE_CHECK"].some((key) => Object.prototype.hasOwnProperty.call(env, key))) return false;
  if (!streams.stdin?.isTTY || !streams.stdout?.isTTY || !streams.stderr?.isTTY) return false;
  return typeof hermesHome === "string" && hermesHome.length > 0 && existsSync(hermesHome);
}

function acceptedJsonContentType(value) {
  const contentType = Array.isArray(value) ? value[0] : value;
  if (typeof contentType !== "string") return false;
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json" || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType);
}

function parseRegistryResponse({ statusCode, headers = {}, body }) {
  if (statusCode !== 200) throw new Error(`Unexpected npm registry status ${statusCode}`);
  if (!acceptedJsonContentType(headers["content-type"])) throw new Error("Unexpected npm registry content type");
  if (!Buffer.isBuffer(body)) throw new Error("Invalid npm registry response body");
  if (body.length > MAX_RESPONSE_BYTES) throw new Error("npm registry response exceeds 64 KiB");
  let value;
  try {
    value = JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("Invalid npm registry JSON body");
  }
  if (!value || Array.isArray(value) || value.name !== PACKAGE_NAME) throw new Error("Unexpected npm registry package name");
  if (!parseStableSemver(value.version)) throw new Error("npm registry version is not a strict stable semver");
  return value.version;
}

function fetchLatestVersion({
  httpsGet = https.get,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  return new Promise((resolve, reject) => {
    let request;
    let timer;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeoutFn(timer);
      if (error) reject(error);
      else resolve(value);
    };

    try {
      request = httpsGet(REGISTRY_URL, {
        headers: {
          accept: "application/json",
          "user-agent": `${PACKAGE_NAME}-update-check`,
        },
      }, (response) => {
        const chunks = [];
        let size = 0;
        const contentLength = Number(response.headers?.["content-length"]);
        if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
          if (typeof response.resume === "function") response.resume();
          finish(new Error("npm registry response exceeds 64 KiB"));
          return;
        }
        response.on("data", (chunk) => {
          if (settled) return;
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += data.length;
          if (size > MAX_RESPONSE_BYTES) {
            finish(new Error("npm registry response exceeds 64 KiB"));
            if (typeof response.destroy === "function") response.destroy();
            return;
          }
          chunks.push(data);
        });
        response.once("error", (error) => finish(error));
        response.once("end", () => {
          if (settled) return;
          try {
            finish(null, parseRegistryResponse({
              statusCode: response.statusCode,
              headers: response.headers,
              body: Buffer.concat(chunks, size),
            }));
          } catch (error) {
            finish(error);
          }
        });
      });
      request.once("error", (error) => finish(error));
      timer = setTimeoutFn(() => {
        finish(new Error("npm update check timed out after 3 seconds"));
        if (typeof request.destroy === "function") request.destroy();
      }, REQUEST_TIMEOUT_MS);
    } catch (error) {
      finish(error);
    }
  });
}

function ensureCacheDirectory(cachePath, {
  existsSync = fs.existsSync,
  mkdirSync = fs.mkdirSync,
} = {}) {
  const cacheDir = path.dirname(cachePath);
  const hermesHome = path.dirname(cacheDir);
  if (!existsSync(hermesHome)) throw new Error("Hermes home no longer exists");
  const state = assertStateParent(hermesHome);
  try {
    mkdirSync(cacheDir, { recursive: false });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  assertStateParent(hermesHome, state || undefined);
  return cacheDir;
}

function writeUpdateCache(cachePath, record, {
  existsSync = fs.existsSync,
  mkdirSync = fs.mkdirSync,
  writeFileAtomicFn = writeFileAtomic,
} = {}) {
  ensureCacheDirectory(cachePath, { existsSync, mkdirSync });
  writeFileAtomicFn(cachePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function generateOwner(randomBytes = crypto.randomBytes) {
  return randomBytes(16).toString("hex");
}

function createOwnedLock(lockPath, owner, now, {
  openSync = fs.openSync,
  closeSync = fs.closeSync,
  writeSync = fs.writeSync,
  fsyncSync = fs.fsyncSync,
  unlinkSync = fs.unlinkSync,
} = {}) {
  const state = assertStateParent(path.dirname(path.dirname(lockPath)));
  const checkState = () => assertStateParent(path.dirname(path.dirname(lockPath)), state);
  let fd;
  let opened;
  try {
    checkState();
    fd = openSync(lockPath, "wx", 0o600);
    opened = fs.fstatSync(fd);
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
  try {
    writeSync(fd, `${JSON.stringify({ owner, acquiredAt: new Date(now).toISOString() })}\n`, null, "utf8");
    try {
      fsyncSync(fd);
    } catch {
      // Exclusive creation is still effective where fsync is unavailable.
    }
    closeSync(fd);
    fd = undefined;
    checkState();
    return true;
  } catch (error) {
    try {
      closeSync(fd);
    } catch {
      // Preserve the original lock-write error.
    }
    try {
      checkState();
      const current = fs.lstatSync(lockPath, { throwIfNoEntry: false });
      if (current?.isFile() && opened && current.dev === opened.dev && current.ino === opened.ino) unlinkSync(lockPath);
    } catch {
      // Callers fail closed if the incomplete lock cannot be removed.
    }
    throw error;
  }
}

function readOwnedLock(lockPath, {
  openSync = fs.openSync,
  closeSync = fs.closeSync,
  readFileSync = fs.readFileSync,
  fstatSync = fs.fstatSync,
} = {}) {
  let fd;
  try {
    const before = fs.lstatSync(lockPath, { throwIfNoEntry: false });
    if (before && !before.isFile()) return null;
    fd = openSync(lockPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || (before && (before.dev !== stat.dev || before.ino !== stat.ino))) throw new Error("Replaced update lock");
    const text = String(readFileSync(fd, "utf8"));
    let value = null;
    try {
      value = JSON.parse(text);
    } catch {
      value = null;
    }
    const owner = typeof value?.owner === "string" && OWNER_PATTERN.test(value.owner)
      ? value.owner
      : null;
    const pid = Number.isInteger(value?.pid) && value.pid > 0 ? value.pid : null;
    const acquiredAtMs = typeof value?.acquiredAt === "string" ? Date.parse(value.acquiredAt) : NaN;
    const generation = owner || crypto.createHash("sha256")
      .update(`${stat.dev}:${stat.ino}:${text}`)
      .digest("hex")
      .slice(0, 32);
    closeSync(fd);
    return { owner, pid, generation, mtimeMs: stat.mtimeMs, acquiredAtMs };
  } catch {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Preserve the read failure.
      }
    }
    return null;
  }
}

function lockIsStale(lock, now) {
  return Boolean(lock)
    && Number.isFinite(lock.mtimeMs)
    && lock.mtimeMs <= now
    && now - lock.mtimeMs >= UPDATE_LOCK_STALE_MS;
}

function transitionPath(cacheDir) {
  return path.join(cacheDir, "update-check.transition.lock");
}

function acquireTransitionMutex(cacheDir, now) {
  try { assertStateParent(path.dirname(cacheDir)); } catch { return null; }
  const mutexPath = transitionPath(cacheDir);
  const owner = generateOwner();
  try { return createOwnedLock(mutexPath, owner, now) ? owner : null; } catch { return null; }
}

function ownsTransitionMutex(cacheDir, owner, state) {
  try { assertStateParent(path.dirname(cacheDir), state); } catch { return false; }
  return readOwnedLock(transitionPath(cacheDir))?.owner === owner;
}

function releaseTransitionMutex(cacheDir, owner, state) {
  if (!ownsTransitionMutex(cacheDir, owner, state)) return false;
  const mutexPath = transitionPath(cacheDir);
  const current = readOwnedLock(mutexPath);
  if (!current || current.owner !== owner) return false;
  try {
    fs.unlinkSync(mutexPath);
    return true;
  } catch {
    return false;
  }
}

function removeAttemptLock(lockPath, owner, state) {
  try { assertStateParent(path.dirname(path.dirname(lockPath)), state); } catch { return false; }
  const current = readOwnedLock(lockPath);
  if (!current || current.owner !== owner) return false;
  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function reserveUpdateAttempt(cachePath, {
  now = Date.now,
  readFileSync = fs.readFileSync,
  existsSync = fs.existsSync,
  mkdirSync = fs.mkdirSync,
  writeUpdateCacheFn = writeUpdateCache,
} = {}) {
  const nowMs = now();
  let cacheDir;
  try {
    cacheDir = ensureCacheDirectory(cachePath, { existsSync, mkdirSync });
  } catch {
    return { reserved: false };
  }
  let state;
  try { state = assertStateParent(path.dirname(cacheDir)); } catch { return { reserved: false }; }
  const mutexOwner = acquireTransitionMutex(cacheDir, nowMs);
  if (!mutexOwner) return { reserved: false };

  try {
    const cache = readUpdateCache(cachePath, { readFileSync, now: nowMs });
    if (!shouldRefreshCache(cache, nowMs)) return { reserved: false, cache };
    assertStateParent(path.dirname(cacheDir), state);
    const lockPath = path.join(cacheDir, "update-check.lock");
    const existingLock = readOwnedLock(lockPath);
    if (existingLock) {
      if (!lockIsStale(existingLock, nowMs)) return { reserved: false, cache };
      const current = readOwnedLock(lockPath);
      if (!current || current.generation !== existingLock.generation) return { reserved: false, cache };
      if (!ownsTransitionMutex(cacheDir, mutexOwner, state)) return { reserved: false, cache };
      try {
        fs.unlinkSync(lockPath);
      } catch {
        return { reserved: false, cache };
      }
    }
    const owner = generateOwner();
    if (!ownsTransitionMutex(cacheDir, mutexOwner, state)) return { reserved: false, cache };
    if (!createOwnedLock(lockPath, owner, nowMs)) return { reserved: false, cache };
    const reservation = {
      schemaVersion: 1,
      packageName: PACKAGE_NAME,
      attemptedAt: new Date(nowMs).toISOString(),
      attemptOwner: owner,
    };
    if (cache?.latestVersion) {
      reservation.checkedAt = cache.checkedAt;
      reservation.latestVersion = cache.latestVersion;
    }
    try {
      if (!ownsTransitionMutex(cacheDir, mutexOwner, state)) return { reserved: false, cache };
      writeUpdateCacheFn(cachePath, reservation);
      if (!ownsTransitionMutex(cacheDir, mutexOwner, state)) return { reserved: false, cache };
    } catch {
      if (ownsTransitionMutex(cacheDir, mutexOwner, state)) removeAttemptLock(lockPath, owner, state);
      return { reserved: false, cache };
    }
    return { reserved: true, owner, cache: reservation };
  } catch {
    return { reserved: false };
  } finally {
    releaseTransitionMutex(cacheDir, mutexOwner, state);
  }
}

function completeUpdateAttempt(cachePath, owner, {
  latestVersion = null,
  now = Date.now,
  readFileSync = fs.readFileSync,
  writeUpdateCacheFn = writeUpdateCache,
} = {}) {
  if (typeof owner !== "string" || !OWNER_PATTERN.test(owner)) return false;
  const nowMs = now();
  const cacheDir = path.dirname(cachePath);
  let state;
  try { state = assertStateParent(path.dirname(cacheDir)); } catch { return false; }
  const mutexOwner = acquireTransitionMutex(cacheDir, nowMs);
  if (!mutexOwner) return false;
  try {
    const cache = readUpdateCache(cachePath, { readFileSync, now: nowMs });
    assertStateParent(path.dirname(cacheDir), state);
    const lockPath = path.join(cacheDir, "update-check.lock");
    const lock = readOwnedLock(lockPath);
    if (!cache || cache.attemptOwner !== owner || lock?.owner !== owner) return false;
    if (latestVersion !== null) {
      if (!parseStableSemver(latestVersion)) return false;
      if (!ownsTransitionMutex(cacheDir, mutexOwner, state)) return false;
      writeUpdateCacheFn(cachePath, {
        schemaVersion: 1,
        packageName: PACKAGE_NAME,
        attemptedAt: cache.attemptedAt,
        attemptOwner: owner,
        checkedAt: new Date(nowMs).toISOString(),
        latestVersion,
      });
    }
    if (!ownsTransitionMutex(cacheDir, mutexOwner, state)) return false;
    return removeAttemptLock(lockPath, owner, state);
  } catch {
    return false;
  } finally {
    releaseTransitionMutex(cacheDir, mutexOwner, state);
  }
}

async function refreshUpdateCache(cachePath, {
  attemptOwner = null,
  now = Date.now,
  readFileSync = fs.readFileSync,
  writeUpdateCacheFn = writeUpdateCache,
  fetchLatestVersionFn = fetchLatestVersion,
} = {}) {
  const startedAt = now();
  let state;
  try { state = assertStateParent(path.dirname(path.dirname(cachePath))); } catch { return false; }
  const reservation = readUpdateCache(cachePath, { readFileSync, now: startedAt });
  const owner = attemptOwner || reservation?.attemptOwner;
  if (!reservation || !owner || reservation.attemptOwner !== owner) return false;
  try {
    const latestVersion = await fetchLatestVersionFn();
    assertStateParent(path.dirname(path.dirname(cachePath)), state);
    return completeUpdateAttempt(cachePath, owner, {
      latestVersion,
      now,
      readFileSync,
      writeUpdateCacheFn,
    });
  } catch {
    try { assertStateParent(path.dirname(path.dirname(cachePath)), state); } catch { return false; }
    completeUpdateAttempt(cachePath, owner, { now, readFileSync, writeUpdateCacheFn });
    return false;
  }
}

function formatUpdateNotice(currentVersion, latestVersion) {
  return [
    `LitHermes update available: ${currentVersion} → ${latestVersion}`,
    `Run exactly: npx --yes --package ${PACKAGE_NAME}@${latestVersion} -- lithermes install --yes --no-hud`,
    "Then restart the Hermes CLI and any Hermes gateways.",
  ].join("\n");
}

function workerEnvironment(env) {
  const workerEnv = {};
  if (typeof env?.NODE_EXTRA_CA_CERTS === "string" && env.NODE_EXTRA_CA_CERTS.length > 0) {
    workerEnv.NODE_EXTRA_CA_CERTS = env.NODE_EXTRA_CA_CERTS;
  }
  return workerEnv;
}

function scheduleUpdateCheck({ command, flags = {}, currentVersion }, {
  env = process.env,
  streams = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
  resolveHermesHome = (inputFlags) => defaultHermesHome(inputFlags),
  existsSync = fs.existsSync,
  readFileSync = fs.readFileSync,
  now = Date.now,
  spawn: spawnFn = spawn,
  reserveUpdateAttemptFn = reserveUpdateAttempt,
} = {}) {
  const idle = { notified: false, refreshScheduled: false };
  try {
    const hermesHome = resolveHermesHome(flags);
    if (!shouldCheckForUpdates({ command, flags, env, streams, hermesHome, existsSync })) return idle;
    const state = assertStateParent(hermesHome);
    const cachePath = path.join(hermesHome, "lithermes", "update-check.json");
    const nowMs = now();
    const cache = readUpdateCache(cachePath, { readFileSync, now: nowMs });
    let notified = false;
    if (cache?.latestVersion && compareStableSemver(cache.latestVersion, currentVersion) === 1) {
      streams.stderr.write(`${formatUpdateNotice(currentVersion, cache.latestVersion)}\n`);
      notified = true;
    }
    if (!shouldRefreshCache(cache, nowMs)) return { notified, refreshScheduled: false };
    const reservation = reserveUpdateAttemptFn(cachePath, { now: () => nowMs });
    if (!reservation?.reserved || !OWNER_PATTERN.test(reservation.owner || "")) {
      return { notified, refreshScheduled: false };
    }
    assertStateParent(hermesHome, state || undefined);
    const worker = path.join(__dirname, "updateNotifierWorker.js");
    try {
      const child = spawnFn(process.execPath, [worker, cachePath, reservation.owner], {
        detached: true,
        env: workerEnvironment(env),
        stdio: "ignore",
        windowsHide: true,
      });
      if (!child || typeof child.once !== "function" || typeof child.unref !== "function") {
        return { notified, refreshScheduled: false };
      }
      child.once("error", () => {});
      child.unref();
      return { notified, refreshScheduled: true };
    } catch {
      return { notified, refreshScheduled: false };
    }
  } catch {
    return idle;
  }
}

// Automatic updates intentionally live beside the advisory notifier, but use a
// different lock, journal, and transaction root.  The advisory path above is
// cache-only and detached; this path is a bounded foreground lifecycle barrier
// that may replace an installed payload only after a truthful doctor pass.
function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function isInteractiveStreams(streams = {}) {
  return Boolean(streams.stdin?.isTTY && streams.stdout?.isTTY && streams.stderr?.isTTY);
}

function shouldAutoUpdate({
  trigger = "cli",
  command,
  flags = {},
  env = {},
  streams = {},
  hermesHome,
  existsSync = fs.existsSync,
  isNodeRuntime = process.release?.name === "node" && !process.versions.bun,
  platform = "cli",
  isFirstTurn,
  isInteractive,
} = {}) {
  if (!isNodeRuntime) return false;
  if (typeof command === "string" && AUTO_UPDATE_INERT_COMMANDS.has(command.trim().toLowerCase())) return false;
  if (hasOwn(env, "CI") || hasOwn(env, "NO_UPDATE_NOTIFIER") || hasOwn(env, "LITHERMES_NO_UPDATE_CHECK")) return false;
  if (hasOwn(env, "LITHERMES_NO_AUTO_UPDATE") || hasOwn(env, AUTO_UPDATE_GUARD_ENV)) return false;
  if (hasOwn(flags, "no-auto-update") || hasOwn(flags, "offline") || hasOwn(flags, "json") || hasOwn(flags, "dry-run")) return false;
  if (trigger === "pre_llm_call") {
    if (platform === "subagent" || platform === "delegate" || platform === "worker") return false;
    if (isFirstTurn !== true) return false;
  } else if (!AUTO_UPDATE_TRIGGER_COMMANDS.has(command)) {
    return false;
  }
  if (isInteractive === false || (isInteractive !== true && !isInteractiveStreams(streams))) return false;
  return typeof hermesHome === "string" && path.isAbsolute(hermesHome) && hermesHome.length > 1 && existsSync(hermesHome);
}

function buildAutoUpdateArgv({ latestVersion, hermesHome, packageName = PACKAGE_NAME } = {}) {
  if (!parseStableSemver(latestVersion)) throw new Error("automatic update requires an exact stable semver");
  if (typeof packageName !== "string" || packageName.length > 214 || packageName.trim() !== packageName || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(packageName)) {
    throw new Error("automatic update package name is invalid");
  }
  if (typeof hermesHome !== "string" || !path.isAbsolute(hermesHome)) {
    throw new Error("automatic update requires a resolved absolute Hermes home");
  }
  return [
    "--yes",
    "--package",
    `${packageName}@${latestVersion}`,
    "--",
    "lithermes",
    "install",
    "--yes",
    "--no-hud",
    "--no-style",
    "--no-patch-installed-hermes",
    "--hermes-home",
    hermesHome,
  ];
}

function sanitizeNpmEnvironment(source = process.env, { hermesHome } = {}) {
  const safe = {};
  // Keep only process plumbing needed to resolve npx and write temporary
  // files.  In particular, do not inherit npm config, proxies, NODE_OPTIONS,
  // or any token-bearing environment key into the child installer.
  for (const key of ["PATH", "HOME", "USERPROFILE", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "LC_CTYPE", "TERM"]) {
    if (typeof source?.[key] === "string" && source[key].length > 0) safe[key] = source[key];
  }
  if (typeof source?.NODE_EXTRA_CA_CERTS === "string" && source.NODE_EXTRA_CA_CERTS.length > 0) {
    safe.NODE_EXTRA_CA_CERTS = source.NODE_EXTRA_CA_CERTS;
  }
  if (typeof hermesHome !== "string" || !path.isAbsolute(hermesHome)) {
    throw new Error("automatic update requires a resolved absolute Hermes home");
  }
  safe.HERMES_HOME = hermesHome;
  safe[AUTO_UPDATE_GUARD_ENV] = "1";
  return safe;
}

function autoUpdatePaths(hermesHome) {
  if (typeof hermesHome !== "string" || !path.isAbsolute(hermesHome)) {
    throw new Error("automatic update requires a resolved absolute Hermes home");
  }
  const stateDir = path.join(hermesHome, "lithermes");
  return {
    stateDir,
    lockPath: path.join(stateDir, AUTO_UPDATE_LOCK_NAME),
    journalPath: path.join(stateDir, AUTO_UPDATE_JOURNAL_NAME),
    receiptPath: path.join(stateDir, AUTO_UPDATE_RECEIPT_NAME),
    transactionRoot: path.join(stateDir, "auto-update"),
    pluginPath: path.join(hermesHome, "plugins", "lithermes"),
    configPath: path.join(hermesHome, "config.yaml"),
    manifestPath: path.join(stateDir, "install-manifest.json"),
    skinsPath: path.join(hermesHome, "skins"),
  };
}

function autoUpdateTimestamp(now = Date.now) {
  return new Date(now()).toISOString();
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function removePath(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isDirectory() && !stat.isSymbolicLink()) fs.rmSync(target, { recursive: true, force: true });
    else fs.unlinkSync(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function copyPathPreservingLinks(source, target) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(fs.readlinkSync(source), target);
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyPathPreservingLinks(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function snapshotTargets(paths, transactionRoot, checkState) {
  checkState();
  const backupRoot = path.join(transactionRoot, "backup");
  fs.mkdirSync(backupRoot, { mode: 0o700 });
  const backupIdentity = assertManagedDirectory(backupRoot);
  const entries = [];
  for (const [name, target] of Object.entries(paths)) {
    if (["stateDir", "lockPath", "journalPath", "receiptPath", "transactionRoot"].includes(name)) continue;
    const exists = fs.existsSync(target) || (() => {
      try { fs.lstatSync(target); return true; } catch { return false; }
    })();
    const backup = path.join(backupRoot, name);
    checkState();
    assertManagedDirectory(backupRoot, backupIdentity);
    if (exists) copyPathPreservingLinks(target, backup);
    entries.push({ name, target, backup, existed: exists });
  }
  checkState();
  assertManagedDirectory(backupRoot, backupIdentity);
  return { backupRoot, backupIdentity, entries };
}

function restoreSnapshot(snapshot, hermesHome, checkState) {
  const failures = [];
  for (const entry of [...snapshot.entries].reverse()) {
    try {
      checkState();
      assertManagedDirectory(snapshot.backupRoot, snapshot.backupIdentity);
      if (entry.name === "pluginPath") assertPluginParent(hermesHome);
      removePath(entry.target);
      checkState();
      assertManagedDirectory(snapshot.backupRoot, snapshot.backupIdentity);
      if (entry.existed) copyPathPreservingLinks(entry.backup, entry.target);
    } catch (error) {
      failures.push(`${entry.name}: ${error.message}`);
    }
  }
  return failures.length ? { status: "failed", failures } : { status: "restored" };
}

function acquireAutoUpdateLock(lockPath, now = Date.now, checkState) {
  checkState();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const owner = generateOwner();
    let fd;
    let identity;
    try {
      checkState();
      fd = fs.openSync(lockPath, "wx", 0o600);
      identity = fs.fstatSync(fd);
      fs.writeFileSync(fd, `${JSON.stringify({ owner, pid: process.pid, acquiredAt: autoUpdateTimestamp(now) })}\n`);
      try { fs.fsyncSync(fd); } catch {}
      return { fd, owner, identity };
    } catch (error) {
      if (fd !== undefined) {
        try {
          checkState();
          const current = fs.lstatSync(lockPath, { throwIfNoEntry: false });
          if (current?.isFile() && identity && current.dev === identity.dev && current.ino === identity.ino) fs.unlinkSync(lockPath);
        } catch {}
        try { fs.closeSync(fd); } catch {}
      }
      if (error.code !== "EEXIST") throw error;
      const existing = readOwnedLock(lockPath);
      const acquiredAt = Number.isFinite(existing?.acquiredAtMs) ? existing.acquiredAtMs : existing?.mtimeMs;
      const currentNow = now();
      const stale = Boolean(existing && Number.isFinite(acquiredAt)
        && acquiredAt <= currentNow
        && currentNow - acquiredAt >= AUTO_UPDATE_LOCK_STALE_MS);
      if (!stale) return null;
      if (existing.pid !== null) {
        try {
          process.kill(existing.pid, 0);
          return null;
        } catch (probeError) {
          if (probeError?.code !== "ESRCH") return null;
        }
      }
      // Rename is the atomic stale-owner takeover.  Never unlink the path
      // directly: a concurrent process may have replaced it with a fresh lock.
      const tombstone = `${lockPath}.stale-${generateOwner()}`;
      try {
        checkState();
        fs.renameSync(lockPath, tombstone);
      } catch {
        return null;
      }
      try { checkState(); fs.unlinkSync(tombstone); } catch {}
    }
  }
  return null;
}

function releaseAutoUpdateLock(lockPath, lock, checkState) {
  if (!lock) return;
  try {
    checkState();
    const current = readOwnedLock(lockPath);
    const identity = fs.lstatSync(lockPath, { throwIfNoEntry: false });
    if (current?.owner === lock.owner && identity?.isFile()
      && identity.dev === lock.identity.dev && identity.ino === lock.identity.ino) fs.unlinkSync(lockPath);
  } catch {} finally {
    try { if (lock.fd !== undefined) fs.closeSync(lock.fd); } catch {}
  }
}

function doctorPassed(result) {
  // Do not infer health from a human-readable string: an untrusted or stale
  // output containing "PASS" is not proof that the installed payload loaded.
  return Boolean(result && typeof result === "object" && result.ok === true);
}

function rollbackFailure(reason, rollback) {
  if (rollback?.status !== "failed") return { reason, extra: {} };
  return {
    reason: "automatic update rollback failed; installed profile state is unknown",
    extra: { state: "unknown", rollbackFailure: true },
  };
}

function safeNpmFailure(result) {
  if (!result || result.signal) return result?.signal ? `npm installer interrupted (${result.signal})` : "npm installer returned no status";
  if (result.error?.code === "ETIMEDOUT") return "npm installer timed out";
  return `npm installer exited with status ${result.status}`;
}

function runAutomaticUpdate({
  currentVersion,
  latestVersion = null,
  hermesHome,
  env = process.env,
  now = Date.now,
  fetchLatestVersionFn = fetchLatestVersion,
  spawnSync: spawnSyncFn = spawnSync,
  doctor,
  packageName = PACKAGE_NAME,
  timeoutMs = AUTO_UPDATE_TIMEOUT_MS,
  cwd = process.cwd(),
} = {}) {
  let paths;
  let stateIdentity;
  let transactionParentIdentity;
  try {
    paths = autoUpdatePaths(hermesHome);
    if (!fs.existsSync(hermesHome)) return { status: "skipped", reason: "missing-hermes-home" };
    stateIdentity = assertStateParent(hermesHome);
    transactionParentIdentity = assertManagedDirectory(paths.transactionRoot);
    if (!parseStableSemver(currentVersion)) return { status: "failed", reason: "invalid-current-version" };
  } catch (error) {
    return { status: "failed", reason: error.message, rollback: { status: "not-started" } };
  }

  // The fetch is intentionally foreground and bounded by fetchLatestVersion's
  // three-second request deadline.  The npm installer itself is bounded below.
  const finishWithoutInstall = (status, reason, extra = {}) => ({
    status,
    reason,
    hermesHome,
    ...extra,
  });
  let targetVersion = latestVersion;
  if (targetVersion === null || targetVersion === undefined) {
    try {
      // fetchLatestVersion is asynchronous by design.  Keep this API thenable
      // by returning a promise from the small async adapter below; callers that
      // provide latestVersion (all transaction tests and deterministic callers)
      // remain synchronous.
      return runAutomaticUpdateAsync({
        currentVersion,
        hermesHome,
        env,
        now,
        fetchLatestVersionFn,
        spawnSyncFn,
        doctor,
        packageName,
        timeoutMs,
        cwd,
        paths,
        stateIdentity,
        transactionParentIdentity,
      });
    } catch (error) {
      return finishWithoutInstall("failed", "update-check-failed");
    }
  }
  if (!parseStableSemver(targetVersion)) return finishWithoutInstall("failed", "invalid-latest-version");
  const comparison = compareStableSemver(targetVersion, currentVersion);
  if (comparison === null) return finishWithoutInstall("failed", "invalid-version-comparison");
  if (comparison <= 0) return finishWithoutInstall("current", "already-current", { currentVersion, latestVersion: targetVersion });
  return performAutomaticUpdateTransaction({
    currentVersion,
    latestVersion: targetVersion,
    hermesHome,
    env,
    now,
    spawnSyncFn,
    doctor,
    packageName,
    timeoutMs,
    cwd,
    paths,
    stateIdentity,
    transactionParentIdentity,
  });
}

async function runAutomaticUpdateAsync(options) {
  let latestVersion;
  try {
    latestVersion = await options.fetchLatestVersionFn();
    assertStateParent(options.hermesHome, options.stateIdentity);
  } catch {
    return { status: "failed", reason: "update-check-failed", hermesHome: options.hermesHome };
  }
  if (!parseStableSemver(latestVersion)) return { status: "failed", reason: "invalid-latest-version", hermesHome: options.hermesHome };
  const comparison = compareStableSemver(latestVersion, options.currentVersion);
  if (comparison === null) return { status: "failed", reason: "invalid-version-comparison", hermesHome: options.hermesHome };
  if (comparison <= 0) return { status: "current", reason: "already-current", currentVersion: options.currentVersion, latestVersion, hermesHome: options.hermesHome };
  return performAutomaticUpdateTransaction({ ...options, latestVersion });
}

function performAutomaticUpdateTransaction({
  currentVersion,
  latestVersion,
  hermesHome,
  env = process.env,
  now = Date.now,
  spawnSyncFn = spawnSync,
  doctor,
  packageName = PACKAGE_NAME,
  timeoutMs = AUTO_UPDATE_TIMEOUT_MS,
  cwd = process.cwd(),
  paths = autoUpdatePaths(hermesHome),
  stateIdentity,
  transactionParentIdentity,
} = {}) {
  const startedAt = autoUpdateTimestamp(now);
  let state;
  try {
    assertStateParent(hermesHome, stateIdentity);
    assertManagedDirectory(paths.transactionRoot, transactionParentIdentity);
    fs.mkdirSync(paths.stateDir, { recursive: true });
    state = assertStateParent(hermesHome, stateIdentity || undefined);
  } catch (error) {
    return { status: "failed", reason: error.message, rollback: { status: "not-started" } };
  }
  let transactionParent = transactionParentIdentity;
  let transactionIdentity;
  const checkState = () => {
    assertStateParent(hermesHome, state);
    assertManagedDirectory(paths.transactionRoot, transactionParent);
    if (transactionIdentity) assertManagedDirectory(transactionRoot, transactionIdentity);
  };
  let lock;
  try { lock = acquireAutoUpdateLock(paths.lockPath, now, checkState); } catch (error) {
    return { status: "failed", reason: error.message, rollback: { status: "not-started" } };
  }
  if (!lock) return { status: "skipped", reason: "auto-update-lock-held", hermesHome };
  const transactionId = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
  const transactionRoot = path.join(paths.transactionRoot, transactionId);
  const journalPath = paths.journalPath;
  const receiptPath = paths.receiptPath;
  let snapshot;
  const journal = {
    schemaVersion: 1,
    packageName,
    transactionId,
    currentVersion,
    targetVersion: latestVersion,
    hermesHome,
    transactionRoot,
    startedAt,
    stage: "created",
  };
  const writeJournal = (stage, extra = {}) => {
    journal.stage = stage;
    Object.assign(journal, extra);
    checkState();
    writeJsonAtomic(journalPath, journal);
    checkState();
    writeJsonAtomic(path.join(transactionRoot, "journal.json"), journal);
  };
  const finish = (status, reason, rollback, extra = {}) => {
    const receipt = {
      schemaVersion: 1,
      packageName,
      transactionId,
      currentVersion,
      targetVersion: latestVersion,
      hermesHome,
      status,
      reason,
      startedAt,
      completedAt: autoUpdateTimestamp(now),
      rollback,
      ...extra,
    };
    let receiptWritten = false;
    try {
      checkState();
      writeJsonAtomic(receiptPath, receipt);
      checkState();
      receiptWritten = true;
    } catch (error) {
      if (status === "updated") {
        receipt.status = "failed";
        receipt.reason = `Automatic update receipt could not be confirmed: ${error.message}`;
        receipt.state = "unknown";
      }
    }
    return { ...receipt, receiptPath, journalPath, receiptWritten, transactionRoot,
      stateDirectoryIdentity: { dev: state.dev, ino: state.ino } };
  };

  try {
    checkState();
    fs.mkdirSync(paths.transactionRoot, { recursive: true, mode: 0o700 });
    assertStateParent(hermesHome, state);
    transactionParent = assertManagedDirectory(paths.transactionRoot, transactionParent || undefined);
    fs.mkdirSync(transactionRoot, { mode: 0o700 });
    transactionIdentity = assertManagedDirectory(transactionRoot);
    writeJournal("prepared");
    assertPluginParent(hermesHome);
    checkState();
    snapshot = snapshotTargets(paths, transactionRoot, checkState);
    writeJournal("backup-created", { backupRoot: snapshot.backupRoot });
    writeJournal("installing");
    const argv = buildAutoUpdateArgv({ latestVersion, hermesHome, packageName });
    checkState();
    const result = spawnSyncFn("npx", argv, {
      cwd,
      env: sanitizeNpmEnvironment(env, { hermesHome }),
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: MAX_RESPONSE_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    if (!result || result.status !== 0 || result.signal || result.error) {
      const reason = safeNpmFailure(result);
      const rollback = restoreSnapshot(snapshot, hermesHome, checkState);
      const outcome = rollbackFailure(reason, rollback);
      writeJournal("rolled-back", { reason: outcome.reason, rollback, ...(outcome.extra.state ? { state: outcome.extra.state } : {}) });
      return finish("failed", outcome.reason, rollback, outcome.extra);
    }
    writeJournal("installed");
    writeJournal("doctor");
    let doctorResult;
    try {
      const doctorFn = doctor || ((flags) => require("./check").doctorLitHermes(flags));
      doctorResult = doctorFn({ offline: true, "hermes-home": hermesHome });
    } catch (error) {
      doctorResult = { ok: false, reason: "doctor-threw" };
    }
    if (!doctorPassed(doctorResult)) {
      const rollback = restoreSnapshot(snapshot, hermesHome, checkState);
      const reason = "post-install doctor did not prove a healthy payload";
      const outcome = rollbackFailure(reason, rollback);
      writeJournal("rolled-back", { reason: outcome.reason, rollback, ...(outcome.extra.state ? { state: outcome.extra.state } : {}) });
      return finish("failed", outcome.reason, rollback, { doctor: "failed", ...outcome.extra });
    }
    writeJournal("committed", { doctor: "ok" });
    return finish("updated", "automatic update committed", { status: "not-needed" }, { doctor: "ok" });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "automatic update failed";
    const rollback = snapshot ? restoreSnapshot(snapshot, hermesHome, checkState) : { status: "not-started" };
    const outcome = rollbackFailure(reason, rollback);
    try { writeJournal("rolled-back", { reason: outcome.reason, rollback, ...(outcome.extra.state ? { state: outcome.extra.state } : {}) }); } catch {}
    return finish("failed", outcome.reason, rollback, outcome.extra);
  } finally {
    releaseAutoUpdateLock(paths.lockPath, lock, checkState);
  }
}

module.exports = {
  CACHE_TTL_MS,
  AUTO_UPDATE_GUARD_ENV,
  AUTO_UPDATE_JOURNAL_NAME,
  AUTO_UPDATE_LOCK_NAME,
  AUTO_UPDATE_RECEIPT_NAME,
  AUTO_UPDATE_TIMEOUT_MS,
  AUTO_UPDATE_LOCK_STALE_MS,
  MAX_RESPONSE_BYTES,
  PACKAGE_NAME,
  REGISTRY_URL,
  UPDATE_LOCK_STALE_MS,
  completeUpdateAttempt,
  autoUpdatePaths,
  automaticUpdateArgv: buildAutoUpdateArgv,
  performAutomaticUpdate: runAutomaticUpdate,
  autoUpdate: runAutomaticUpdate,
  buildAutoUpdateArgv,
  compareStableSemver,
  fetchLatestVersion,
  formatUpdateNotice,
  parseRegistryResponse,
  parseStableSemver,
  parseUpdateCache,
  readUpdateCache,
  runAutomaticUpdate,
  sanitizeNpmEnvironment,
  refreshUpdateCache,
  reserveUpdateAttempt,
  scheduleUpdateCheck,
  shouldCheckForUpdates,
  shouldRunAutomaticUpdate: shouldAutoUpdate,
  shouldAutoUpdate,
  shouldRefreshCache,
  writeUpdateCache,
};
