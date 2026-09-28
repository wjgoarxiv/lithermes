const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork, spawnSync } = require("node:child_process");
const { after, test } = require("node:test");

let notifier = {};
try {
  notifier = require("../src/lib/updateNotifier");
} catch {
  // RED: every test below reports the missing public contract explicitly.
}

const tempDirs = [];
const packageRoot = path.resolve(__dirname, "..");

function makeTempDir(prefix = "lithermes-update-test-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function requireFunction(name) {
  assert.equal(typeof notifier[name], "function", `${name} must be exported by src/lib/updateNotifier`);
  return notifier[name];
}

function validCache(overrides = {}) {
  return {
    schemaVersion: 1,
    packageName: "@litfamily/lithermes",
    attemptedAt: "2026-07-23T00:00:00.000Z",
    checkedAt: "2026-07-23T00:00:00.000Z",
    latestVersion: "0.9.0",
    ...overrides,
  };
}

function waitForMessage(child, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for child ${child.pid}`));
    }, timeoutMs);
    const onMessage = (message) => {
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`child ${child.pid} exited before expected message (${code ?? signal})`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    child.on("message", onMessage);
    child.on("exit", onExit);
  });
}

function releaseGate(gatePath) {
  fs.writeFileSync(gatePath, "continue\n");
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { force: true, recursive: true });
});

test("strict stable semver parser rejects prerelease, build, prefixes, and leading zeroes", () => {
  const parseStableSemver = requireFunction("parseStableSemver");
  assert.deepEqual(parseStableSemver("12.3.40"), [12, 3, 40]);
  for (const value of ["v1.2.3", "1.2", "1.2.3-beta.1", "1.2.3+build", "01.2.3", "1.02.3", "1.2.03", " 1.2.3 "]) {
    assert.equal(parseStableSemver(value), null, `must reject ${JSON.stringify(value)}`);
  }
});

test("cache parser accepts only the exact package and strict stable versions", () => {
  const parseUpdateCache = requireFunction("parseUpdateCache");
  assert.deepEqual(parseUpdateCache(JSON.stringify(validCache())), validCache());
  assert.equal(parseUpdateCache(JSON.stringify(validCache({ packageName: "other-package" }))), null);
  assert.equal(parseUpdateCache(JSON.stringify(validCache({ latestVersion: "0.9.0-rc.1" }))), null);
  assert.equal(parseUpdateCache("not json"), null);
});

test("cache parser requires canonical ISO timestamps and rejects future attempts or checks", () => {
  const parseUpdateCache = requireFunction("parseUpdateCache");
  const now = Date.parse("2026-07-23T12:00:00.000Z");
  for (const timestamp of [
    "2026-07-23T00:00:00Z",
    "2026-07-23T00:00:00.00Z",
    "2026-07-23T09:00:00.000+09:00",
    " 2026-07-23T00:00:00.000Z",
  ]) {
    assert.equal(parseUpdateCache(JSON.stringify(validCache({ attemptedAt: timestamp })), { now }), null, timestamp);
  }
  assert.equal(parseUpdateCache(JSON.stringify(validCache({ attemptedAt: "2026-07-23T12:00:00.001Z" })), { now }), null);
  assert.equal(parseUpdateCache(JSON.stringify(validCache({ checkedAt: "2026-07-23T12:00:00.001Z" })), { now }), null);
  assert.deepEqual(parseUpdateCache(JSON.stringify(validCache()), { now }), validCache());
});

test("attemptedAt throttles successful and failed checks for 24 hours", () => {
  const shouldRefreshCache = requireFunction("shouldRefreshCache");
  const now = Date.parse("2026-07-24T00:00:00.000Z");
  assert.equal(shouldRefreshCache(validCache({ attemptedAt: "2026-07-23T00:00:00.001Z" }), now), false);
  assert.equal(shouldRefreshCache(validCache({ attemptedAt: "2026-07-23T00:00:00.000Z" }), now), true);
  assert.equal(shouldRefreshCache({
    schemaVersion: 1,
    packageName: "@litfamily/lithermes",
    attemptedAt: "2026-07-23T12:00:00.000Z",
  }, now), false, "a failed attempt without latestVersion must still throttle");
  assert.equal(shouldRefreshCache(validCache({ attemptedAt: "2026-07-24T00:00:00.001Z" }), now), true, "future attempts fail safe");
  assert.equal(shouldRefreshCache(null, now), true);
});

test("notification gate allows only install/check/doctor on an interactive eligible host", () => {
  const shouldCheckForUpdates = requireFunction("shouldCheckForUpdates");
  const eligible = {
    flags: {},
    env: {},
    streams: { stdin: { isTTY: true }, stdout: { isTTY: true }, stderr: { isTTY: true } },
    hermesHome: "/existing/.hermes",
    existsSync: () => true,
  };
  for (const command of ["install", "check", "doctor"]) {
    assert.equal(shouldCheckForUpdates({ ...eligible, command }), true, command);
  }
  for (const command of ["hud", "version", "help", "uninstall", "gateway", "hooks"]) {
    assert.equal(shouldCheckForUpdates({ ...eligible, command }), false, command);
  }
  assert.equal(shouldCheckForUpdates({ ...eligible, command: "check", isNodeRuntime: false }), false, "non-Node runtime");
});

test("notification gate refuses offline/json/dry-run, CI, pipes, opt-outs, and missing Hermes homes", () => {
  const shouldCheckForUpdates = requireFunction("shouldCheckForUpdates");
  const base = {
    command: "check",
    flags: {},
    env: {},
    streams: { stdin: { isTTY: true }, stdout: { isTTY: true }, stderr: { isTTY: true } },
    hermesHome: "/existing/.hermes",
    existsSync: () => true,
  };
  for (const flag of ["offline", "json", "dry-run"]) {
    assert.equal(shouldCheckForUpdates({ ...base, flags: { [flag]: true } }), false, `--${flag}`);
  }
  for (const key of ["NO_UPDATE_NOTIFIER", "LITHERMES_NO_UPDATE_CHECK"]) {
    assert.equal(shouldCheckForUpdates({ ...base, env: { [key]: "1" } }), false, key);
  }
  assert.equal(shouldCheckForUpdates({ ...base, env: { CI: "1" } }), false, "CI");
  for (const stream of ["stdin", "stdout", "stderr"]) {
    assert.equal(shouldCheckForUpdates({
      ...base,
      streams: { ...base.streams, [stream]: { isTTY: false } },
    }), false, `${stream} pipe`);
  }
  assert.equal(shouldCheckForUpdates({ ...base, existsSync: () => false }), false, "missing Hermes home");
});

test("registry parser requires exact 200 JSON, bounded body, exact name, and stable semver", () => {
  const parseRegistryResponse = requireFunction("parseRegistryResponse");
  const body = Buffer.from(JSON.stringify({ name: "@litfamily/lithermes", version: "0.9.0" }));
  assert.equal(parseRegistryResponse({
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body,
  }), "0.9.0");
  assert.throws(() => parseRegistryResponse({ statusCode: 204, headers: { "content-type": "application/json" }, body }), /status/i);
  assert.throws(() => parseRegistryResponse({ statusCode: 200, headers: { "content-type": "text/plain" }, body }), /content.type/i);
  assert.throws(() => parseRegistryResponse({ statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.alloc(64 * 1024 + 1) }), /large|size|64/i);
  assert.throws(() => parseRegistryResponse({ statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.from('{"name":"other","version":"0.9.0"}') }), /package|name/i);
  assert.throws(() => parseRegistryResponse({ statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.from('{"name":"@litfamily/lithermes","version":"0.9.0-beta.1"}') }), /version|semver/i);
});

test("HTTPS request enforces a 3 second total timeout through injected timers", async () => {
  const fetchLatestVersion = requireFunction("fetchLatestVersion");
  const request = new EventEmitter();
  request.destroyed = false;
  request.destroy = () => { request.destroyed = true; };
  let timeoutCallback;
  let timeoutDelay;
  const pending = fetchLatestVersion({
    httpsGet: (url, options, onResponse) => {
      assert.equal(url, "https://registry.npmjs.org/%40litfamily%2Flithermes/latest");
      assert.equal(options.headers.authorization, undefined);
      assert.equal(typeof onResponse, "function");
      return request;
    },
    setTimeoutFn: (callback, delay) => {
      timeoutCallback = callback;
      timeoutDelay = delay;
      return Symbol("timer");
    },
    clearTimeoutFn: () => {},
  });
  assert.equal(timeoutDelay, 3000);
  timeoutCallback();
  await assert.rejects(pending, /timed out|timeout/i);
  assert.equal(request.destroyed, true);
});

test("cache writes use the injected atomic writer and retain a prior valid result on a failed attempt", () => {
  const writeUpdateCache = requireFunction("writeUpdateCache");
  const cachePath = "/existing/.hermes/lithermes/update-check.json";
  const writes = [];
  const mkdirs = [];
  const prior = validCache();
  writeUpdateCache(cachePath, {
    ...prior,
    attemptedAt: "2026-07-24T00:00:00.000Z",
  }, {
    existsSync: () => true,
    mkdirSync: (dir, options) => mkdirs.push([dir, options]),
    writeFileAtomicFn: (file, text, encoding) => writes.push([file, text, encoding]),
  });
  assert.deepEqual(mkdirs, [[path.dirname(cachePath), { recursive: false }]]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], cachePath);
  assert.equal(writes[0][2], "utf8");
  const saved = JSON.parse(writes[0][1]);
  assert.equal(saved.latestVersion, prior.latestVersion);
  assert.equal(saved.checkedAt, prior.checkedAt);
  assert.equal(saved.attemptedAt, "2026-07-24T00:00:00.000Z");
});

test("cache writer cannot recreate a Hermes home removed before the detached worker runs", () => {
  const writeUpdateCache = requireFunction("writeUpdateCache");
  let mkdirCalled = false;
  let writeCalled = false;
  assert.throws(() => writeUpdateCache("/removed/.hermes/lithermes/update-check.json", validCache(), {
    existsSync: () => false,
    mkdirSync: () => { mkdirCalled = true; },
    writeFileAtomicFn: () => { writeCalled = true; },
  }), /Hermes home/i);
  assert.equal(mkdirCalled, false);
  assert.equal(writeCalled, false);
});

test("failed refresh leaves the parent-side attempt reservation and prior result untouched", async () => {
  const refreshUpdateCache = requireFunction("refreshUpdateCache");
  const home = makeTempDir("lithermes-update-refresh-fail-");
  const cacheDir = path.join(home, "lithermes");
  const cachePath = path.join(cacheDir, "update-check.json");
  const lockPath = path.join(cacheDir, "update-check.lock");
  const owner = "a".repeat(32);
  const reservation = validCache({ attemptedAt: "2026-07-24T00:00:00.000Z", attemptOwner: owner });
  fs.mkdirSync(cacheDir);
  fs.writeFileSync(cachePath, `${JSON.stringify(reservation, null, 2)}\n`);
  fs.writeFileSync(lockPath, `${JSON.stringify({ owner, acquiredAt: reservation.attemptedAt })}\n`, { mode: 0o600 });
  const before = fs.readFileSync(cachePath, "utf8");
  const result = await refreshUpdateCache(cachePath, {
    attemptOwner: owner,
    now: () => Date.parse("2026-07-24T00:00:00.000Z"),
    fetchLatestVersionFn: async () => { throw new Error("injected network failure"); },
  });
  assert.equal(result, false);
  assert.equal(fs.readFileSync(cachePath, "utf8"), before);
  assert.equal(fs.existsSync(lockPath), false, "failed worker completion releases only its own attempt lock");
});

test("successful refresh keeps the parent reservation timestamp and writes a canonical check result", async () => {
  const refreshUpdateCache = requireFunction("refreshUpdateCache");
  const home = makeTempDir("lithermes-update-refresh-success-");
  const cacheDir = path.join(home, "lithermes");
  const cachePath = path.join(cacheDir, "update-check.json");
  const lockPath = path.join(cacheDir, "update-check.lock");
  const owner = "a".repeat(32);
  const reservation = validCache({ attemptedAt: "2026-07-23T00:00:00.000Z", attemptOwner: owner });
  fs.mkdirSync(cacheDir);
  fs.writeFileSync(cachePath, `${JSON.stringify(reservation, null, 2)}\n`);
  fs.writeFileSync(lockPath, `${JSON.stringify({ owner, acquiredAt: reservation.attemptedAt })}\n`, { mode: 0o600 });
  const result = await refreshUpdateCache(cachePath, {
    attemptOwner: owner,
    now: () => Date.parse("2026-07-23T00:00:01.000Z"),
    fetchLatestVersionFn: async () => "0.9.2",
  });
  assert.equal(result, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(cachePath, "utf8")), {
    schemaVersion: 1,
    packageName: "@litfamily/lithermes",
    attemptedAt: "2026-07-23T00:00:00.000Z",
    attemptOwner: owner,
    checkedAt: "2026-07-23T00:00:01.000Z",
    latestVersion: "0.9.2",
  });
  assert.equal(fs.existsSync(lockPath), false);
});

test("cached notice pins the exact update command and schedules a detached nonblocking refresh", () => {
  const scheduleUpdateCheck = requireFunction("scheduleUpdateCheck");
  const home = makeTempDir("lithermes-cached-notice-");
  fs.mkdirSync(path.join(home, "lithermes"));
  fs.writeFileSync(path.join(home, "lithermes", "update-check.json"), JSON.stringify(validCache()));
  const writes = [];
  const spawns = [];
  let unrefCalled = false;
  let child;
  const result = scheduleUpdateCheck({ command: "doctor", flags: {}, currentVersion: "0.8.30" }, {
    env: {},
    streams: {
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      stderr: { isTTY: true, write: (text) => writes.push(text) },
    },
    resolveHermesHome: () => home,
    existsSync: () => true,
    readFileSync: () => JSON.stringify(validCache({ attemptedAt: "2026-07-21T00:00:00.000Z" })),
    now: () => Date.parse("2026-07-23T12:00:00.000Z"),
    reserveUpdateAttemptFn: () => ({ reserved: true, owner: "a".repeat(32) }),
    spawn: (...args) => {
      spawns.push(args);
      child = new EventEmitter();
      child.unref = () => {
        assert.equal(child.listenerCount("error"), 1, "error listener must be attached before unref");
        unrefCalled = true;
      };
      return child;
    },
  });
  assert.equal(result.notified, true);
  assert.equal(result.refreshScheduled, true);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0][2].detached, true);
  assert.equal(spawns[0][2].stdio, "ignore");
  assert.equal(unrefCalled, true);
  assert.doesNotThrow(() => child.emit("error", new Error("injected asynchronous spawn error")));
  const notice = writes.join("");
  assert.match(notice, /0\.8\.30.*0\.9\.0/s);
  assert.match(notice, /npx --yes --package @litfamily\/lithermes@0\.9\.0 -- lithermes install --yes --no-hud/);
  assert.match(notice, /restart.*Hermes CLI.*gateways/is);
  assert.doesNotMatch(notice, /npm install -g|token|credential/i);
});

test("detached worker receives only the explicit safe environment allowlist", () => {
  const scheduleUpdateCheck = requireFunction("scheduleUpdateCheck");
  const home = makeTempDir("lithermes-cached-notice-");
  fs.mkdirSync(path.join(home, "lithermes"));
  fs.writeFileSync(path.join(home, "lithermes", "update-check.json"), JSON.stringify(validCache()));
  let spawnOptions;
  const secretEnv = {
    NPM_TOKEN: "npm-secret",
    NODE_AUTH_TOKEN: "node-secret",
    npm_config_userconfig: "/tmp/credential-bearing-npmrc",
    NPM_CONFIG_USERCONFIG: "/tmp/other-npmrc",
    npm_config__auth: "basic-secret",
    npm_config_authToken: "registry-secret",
    GITHUB_TOKEN: "github-secret",
    SERVICE_AUTH_HEADER: "Bearer service-secret",
    HTTPS_PROXY: "https://user:password@proxy.example",
    HTTP_PROXY: "http://user:password@proxy.example",
    NODE_OPTIONS: "--require=/tmp/untrusted-hook.js",
    NODE_EXTRA_CA_CERTS: "/safe/custom-ca.pem",
  };
  const result = scheduleUpdateCheck({ command: "check", flags: {}, currentVersion: "0.8.30" }, {
    env: secretEnv,
    streams: {
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      stderr: { isTTY: true, write: () => {} },
    },
    resolveHermesHome: () => home,
    existsSync: () => true,
    readFileSync: () => JSON.stringify(validCache({ attemptedAt: "2026-07-21T00:00:00.000Z" })),
    now: () => Date.parse("2026-07-23T12:00:00.000Z"),
    reserveUpdateAttemptFn: () => ({ reserved: true, owner: "a".repeat(32) }),
    spawn: (_command, _args, options) => {
      spawnOptions = options;
      const child = new EventEmitter();
      child.unref = () => {};
      return child;
    },
  });

  assert.equal(result.refreshScheduled, true);
  assert.deepEqual(spawnOptions.env, {
    NODE_EXTRA_CA_CERTS: "/safe/custom-ca.pem",
  });
});

test("parent atomically reserves one 24 hour attempt and retains the prior successful result", () => {
  const scheduleUpdateCheck = requireFunction("scheduleUpdateCheck");
  const home = makeTempDir("lithermes-update-reserve-");
  const cacheDir = path.join(home, "lithermes");
  const cachePath = path.join(cacheDir, "update-check.json");
  fs.mkdirSync(cacheDir);
  fs.writeFileSync(cachePath, `${JSON.stringify(validCache({ attemptedAt: "2026-07-21T00:00:00.000Z" }), null, 2)}\n`);
  let spawnCount = 0;
  const dependencies = {
    env: {},
    streams: {
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      stderr: { isTTY: true, write: () => {} },
    },
    resolveHermesHome: () => home,
    now: () => Date.parse("2026-07-23T12:00:00.000Z"),
    spawn: () => {
      spawnCount += 1;
      const process = new EventEmitter();
      process.unref = () => {};
      return process;
    },
  };
  const first = scheduleUpdateCheck({ command: "check", flags: {}, currentVersion: "0.8.30" }, dependencies);
  const second = scheduleUpdateCheck({ command: "doctor", flags: {}, currentVersion: "0.8.30" }, dependencies);
  assert.equal(first.refreshScheduled, true);
  assert.equal(second.refreshScheduled, false);
  assert.equal(spawnCount, 1);
  const reserved = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  assert.equal(reserved.attemptedAt, "2026-07-23T12:00:00.000Z");
  assert.equal(reserved.checkedAt, "2026-07-23T00:00:00.000Z");
  assert.equal(reserved.latestVersion, "0.9.0");
  assert.match(reserved.attemptOwner, /^[a-f0-9]{32}$/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(cacheDir, "update-check.lock"), "utf8")).owner, reserved.attemptOwner);
});

test("synchronous spawn interruption remains reserved and blocks a second attempt", () => {
  const scheduleUpdateCheck = requireFunction("scheduleUpdateCheck");
  const home = makeTempDir("lithermes-update-interrupt-");
  const cacheDir = path.join(home, "lithermes");
  const cachePath = path.join(cacheDir, "update-check.json");
  fs.mkdirSync(cacheDir);
  fs.writeFileSync(cachePath, `${JSON.stringify(validCache({ attemptedAt: "2026-07-21T00:00:00.000Z" }), null, 2)}\n`);
  let spawnCount = 0;
  const dependencies = {
    env: {},
    streams: {
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      stderr: { isTTY: true, write: () => {} },
    },
    resolveHermesHome: () => home,
    now: () => Date.parse("2026-07-23T12:00:00.000Z"),
    spawn: () => {
      spawnCount += 1;
      throw new Error("injected spawn interruption");
    },
  };
  assert.equal(scheduleUpdateCheck({ command: "install", flags: {}, currentVersion: "0.8.30" }, dependencies).refreshScheduled, false);
  assert.equal(scheduleUpdateCheck({ command: "check", flags: {}, currentVersion: "0.8.30" }, dependencies).refreshScheduled, false);
  assert.equal(spawnCount, 1);
  const reserved = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  assert.equal(reserved.attemptedAt, "2026-07-23T12:00:00.000Z");
  assert.equal(reserved.latestVersion, "0.9.0");
  assert.equal(JSON.parse(fs.readFileSync(path.join(cacheDir, "update-check.lock"), "utf8")).owner, reserved.attemptOwner);
});

test("fresh reservation locks block scheduling and stale locks recover", () => {
  const scheduleUpdateCheck = requireFunction("scheduleUpdateCheck");
  const home = makeTempDir("lithermes-update-lock-");
  const cacheDir = path.join(home, "lithermes");
  const cachePath = path.join(cacheDir, "update-check.json");
  const lockPath = path.join(cacheDir, "update-check.lock");
  fs.mkdirSync(cacheDir);
  const staleCache = validCache({ attemptedAt: "2026-07-21T00:00:00.000Z" });
  fs.writeFileSync(cachePath, `${JSON.stringify(staleCache, null, 2)}\n`);
  fs.writeFileSync(lockPath, "occupied\n", { mode: 0o600 });
  let spawnCount = 0;
  const now = Date.parse("2026-07-23T12:00:00.000Z");
  const dependencies = {
    env: {},
    streams: {
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      stderr: { isTTY: true, write: () => {} },
    },
    resolveHermesHome: () => home,
    now: () => now,
    spawn: () => {
      spawnCount += 1;
      const process = new EventEmitter();
      process.unref = () => {};
      return process;
    },
  };
  fs.utimesSync(lockPath, new Date(now), new Date(now));
  assert.equal(scheduleUpdateCheck({ command: "check", flags: {}, currentVersion: "0.8.30" }, dependencies).refreshScheduled, false);
  assert.equal(spawnCount, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(cachePath, "utf8")), staleCache);

  fs.utimesSync(lockPath, new Date(now - 60_000), new Date(now - 60_000));
  assert.equal(scheduleUpdateCheck({ command: "check", flags: {}, currentVersion: "0.8.30" }, dependencies).refreshScheduled, true);
  assert.equal(spawnCount, 1);
  const recovered = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  assert.equal(recovered.attemptedAt, "2026-07-23T12:00:00.000Z");
  assert.equal(JSON.parse(fs.readFileSync(lockPath, "utf8")).owner, recovered.attemptOwner);
});

test("two-process stale observer cannot unlink a replacement owner or commit a second reservation", async () => {
  const home = makeTempDir("lithermes-update-two-process-");
  const cacheDir = path.join(home, "lithermes");
  const cachePath = path.join(cacheDir, "update-check.json");
  const lockPath = path.join(cacheDir, "update-check.lock");
  const helper = path.join(__dirname, "fixtures", "update-lock-interleaving-child.js");
  const gateA = path.join(home, "release-a");
  const gateB = path.join(home, "release-b");
  const baseNow = Date.now();
  const staleAt = new Date(baseNow - (2 * 24 * 60 * 60 * 1000)).toISOString();
  fs.mkdirSync(cacheDir);
  fs.writeFileSync(cachePath, `${JSON.stringify(validCache({ attemptedAt: staleAt, checkedAt: staleAt }), null, 2)}\n`);
  fs.writeFileSync(lockPath, `${JSON.stringify({ owner: "old-stale-owner", acquiredAt: staleAt })}\n`, { mode: 0o600 });
  fs.utimesSync(lockPath, new Date(staleAt), new Date(staleAt));

  const childA = fork(helper, ["observer-a", home, gateA, String(baseNow + 1)], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  await waitForMessage(childA, (message) => message?.phase === "a-observed-stale");
  const resultAPromise = waitForMessage(childA, (message) => message?.phase === "result");

  const childB = fork(helper, ["replacement-b", home, gateB, String(baseNow + 2)], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const bOutcome = await Promise.race([
    waitForMessage(childB, (message) => message?.phase === "b-created-owner"),
    waitForMessage(childB, (message) => message?.phase === "result"),
  ]);

  let resultB;
  if (bOutcome.phase === "b-created-owner") {
    releaseGate(gateA);
    await resultAPromise;
    releaseGate(gateB);
    resultB = await waitForMessage(childB, (message) => message?.phase === "result");
  } else {
    resultB = bOutcome;
    releaseGate(gateA);
  }
  const resultA = await resultAPromise;
  assert.equal([resultA.result.reserved, resultB.result.reserved].filter(Boolean).length, 1);
  assert.equal(resultA.result.reserved, true, "the transition owner A must survive its fenced takeover");
  assert.equal(resultB.result.reserved, false, "B must not replace an owner while A holds the transition mutex");
  const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  assert.equal(cache.attemptedAt, new Date(baseNow + 1).toISOString());
  assert.match(cache.attemptOwner, /^[a-f0-9]{32}$/);
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  assert.equal(lock.owner, cache.attemptOwner);
});

test("stale transition takeover cannot let the displaced owner overwrite a committed reservation", async () => {
  const home = makeTempDir("lithermes-update-transition-owner-");
  const cacheDir = path.join(home, "lithermes");
  const cachePath = path.join(cacheDir, "update-check.json");
  const lockPath = path.join(cacheDir, "update-check.lock");
  const helper = path.join(__dirname, "fixtures", "update-lock-interleaving-child.js");
  const gateA = path.join(home, "release-a");
  const baseNow = Date.now();
  const staleAt = new Date(baseNow - (2 * 24 * 60 * 60 * 1000)).toISOString();
  fs.mkdirSync(cacheDir);
  fs.writeFileSync(cachePath, `${JSON.stringify(validCache({ attemptedAt: staleAt, checkedAt: staleAt }), null, 2)}\n`);

  const childA = fork(helper, ["mutation-owner-a", home, gateA, String(baseNow)], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  await waitForMessage(childA, (message) => message?.phase === "a-created-attempt-lock");
  const resultAPromise = waitForMessage(childA, (message) => message?.phase === "result");

  const childB = fork(helper, ["stale-taker-b", home, path.join(home, "unused"), String(baseNow + 60_000)], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const resultB = await waitForMessage(childB, (message) => message?.phase === "result");
  releaseGate(gateA);
  const resultA = await resultAPromise;

  assert.equal(resultA.result.reserved, true, "A keeps its reservation while it owns the transition");
  assert.equal(resultB.result.reserved, false, "B must fail closed instead of age-taking a live transition owner");
  const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  assert.equal(lock.owner, cache.attemptOwner, "the committed cache and attempt lock retain one owner");
});

test("late old worker is fenced from overwriting cache or removing the new attempt lock", async () => {
  const completeUpdateAttempt = requireFunction("completeUpdateAttempt");
  const home = makeTempDir("lithermes-update-late-worker-");
  const cacheDir = path.join(home, "lithermes");
  const cachePath = path.join(cacheDir, "update-check.json");
  const lockPath = path.join(cacheDir, "update-check.lock");
  const newOwner = "b".repeat(32);
  fs.mkdirSync(cacheDir);
  const cache = validCache({
    attemptedAt: "2026-07-23T12:00:00.000Z",
    attemptOwner: newOwner,
  });
  fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  fs.writeFileSync(lockPath, `${JSON.stringify({ owner: newOwner, acquiredAt: "2026-07-23T12:00:00.000Z" })}\n`, { mode: 0o600 });
  const beforeCache = fs.readFileSync(cachePath, "utf8");
  const beforeLock = fs.readFileSync(lockPath, "utf8");
  const completed = await completeUpdateAttempt(cachePath, "a".repeat(32), {
    latestVersion: "9.9.9",
    now: () => Date.parse("2026-07-23T12:00:01.000Z"),
  });
  assert.equal(completed, false);
  assert.equal(fs.readFileSync(cachePath, "utf8"), beforeCache);
  assert.equal(fs.readFileSync(lockPath, "utf8"), beforeLock);
});

test("an eligible check never creates a missing Hermes home merely to check", () => {
  const scheduleUpdateCheck = requireFunction("scheduleUpdateCheck");
  let spawned = false;
  let read = false;
  const result = scheduleUpdateCheck({ command: "check", flags: {}, currentVersion: "0.8.30" }, {
    env: {},
    streams: {
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      stderr: { isTTY: true, write: () => {} },
    },
    resolveHermesHome: () => "/missing/.hermes",
    existsSync: () => false,
    readFileSync: () => { read = true; },
    spawn: () => { spawned = true; },
  });
  assert.deepEqual(result, { notified: false, refreshScheduled: false });
  assert.equal(read, false);
  assert.equal(spawned, false);
});

test("actual npm tarball contains and can load the notifier runtime without changing version stdout", () => {
  const sandbox = makeTempDir("lithermes-update-pack-");
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", sandbox], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr);
  const metadata = JSON.parse(packed.stdout)[0];
  const archive = path.join(sandbox, metadata.filename);
  const extracted = spawnSync("tar", ["-xzf", archive, "-C", sandbox], { encoding: "utf8" });
  assert.equal(extracted.status, 0, extracted.stderr);
  const packedRoot = path.join(sandbox, "package");
  assert.equal(fs.existsSync(path.join(packedRoot, "src", "lib", "updateNotifier.js")), true);
  assert.equal(fs.existsSync(path.join(packedRoot, "src", "lib", "updateNotifierWorker.js")), true);
  const version = spawnSync(process.execPath, [path.join(packedRoot, "bin", "lithermes.js"), "version"], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_PATH: path.join(packageRoot, "node_modules"),
      NO_UPDATE_NOTIFIER: "1",
    },
  });
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /^lithermes \d+\.\d+\.\d+\n$/);
  assert.equal(version.stderr, "");
});

test("automatic-update gate is default-on only at the first interactive lifecycle barrier", () => {
  const shouldAutoUpdate = requireFunction("shouldAutoUpdate");
  const eligible = {
    trigger: "pre_llm_call",
    command: "chat",
    flags: {},
    env: {},
    streams: {
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      stderr: { isTTY: true },
    },
    platform: "cli",
    isFirstTurn: true,
    hermesHome: "/existing/.hermes",
    existsSync: () => true,
  };
  assert.equal(shouldAutoUpdate(eligible), true);
  assert.equal(shouldAutoUpdate({ ...eligible, isFirstTurn: false }), false);
  assert.equal(shouldAutoUpdate({ ...eligible, platform: "subagent" }), false);
  for (const flags of [
    { "no-auto-update": true },
    { offline: true },
    { json: true },
    { "dry-run": true },
  ]) {
    assert.equal(shouldAutoUpdate({ ...eligible, flags }), false, JSON.stringify(flags));
  }
  for (const key of ["CI", "NO_UPDATE_NOTIFIER", "LITHERMES_NO_UPDATE_CHECK", "LITHERMES_NO_AUTO_UPDATE", "LITHERMES_AUTO_UPDATE_RUNNING"]) {
    assert.equal(shouldAutoUpdate({ ...eligible, env: { [key]: "1" } }), false, key);
  }
  assert.equal(shouldAutoUpdate({ ...eligible, command: "help", trigger: "cli" }), false);
  assert.equal(shouldAutoUpdate({ ...eligible, command: "uninstall", trigger: "cli" }), false);
  for (const command of ["help", "uninstall", "hud", "version"]) {
    assert.equal(shouldAutoUpdate({ ...eligible, command, trigger: "pre_llm_call" }), false, command);
  }
  assert.equal(shouldAutoUpdate({ ...eligible, trigger: "cli", command: "doctor", isFirstTurn: undefined }), true);
  assert.equal(shouldAutoUpdate({ ...eligible, streams: { ...eligible.streams, stdout: { isTTY: false } } }), false);
});

test("automatic install argv pins an exact stable package version and resolved Hermes home", () => {
  const buildAutoUpdateArgv = requireFunction("buildAutoUpdateArgv");
  const stableVersionSentinel = "98.76.54";
  const argv = buildAutoUpdateArgv({ latestVersion: stableVersionSentinel, hermesHome: "/tmp/hermes home" });
  assert.deepEqual(argv, [
    "--yes",
    "--package", `@litfamily/lithermes@${stableVersionSentinel}`, "--", "lithermes",
    "install",
    "--yes",
    "--no-hud",
    "--no-style",
    "--no-patch-installed-hermes",
    "--hermes-home",
    "/tmp/hermes home",
  ]);
  assert.equal(argv.includes("--home"), false);
  assert.equal(argv.some((value) => value === "@litfamily/lithermes@latest"), false);
  assert.throws(() => buildAutoUpdateArgv({ latestVersion: `${stableVersionSentinel}-beta.1`, hermesHome: "/tmp/home" }), /stable|semver/i);
  assert.throws(() => buildAutoUpdateArgv({ latestVersion: stableVersionSentinel, hermesHome: "relative/home" }), /absolute|resolved/i);
});

test("automatic npm environment is a strict non-credential allowlist with recursion guard", () => {
  const sanitizeNpmEnvironment = requireFunction("sanitizeNpmEnvironment");
  const env = sanitizeNpmEnvironment({
    PATH: "/safe/bin",
    HOME: "/safe/home",
    TMPDIR: "/safe/tmp",
    LANG: "ko_KR.UTF-8",
    NPM_TOKEN: "secret",
    NODE_AUTH_TOKEN: "secret",
    npm_config_userconfig: "/credential-bearing.npmrc",
    npm_config__auth: "secret",
    HTTPS_PROXY: "https://user:pass@example.test",
    NODE_OPTIONS: "--require=/tmp/evil.js",
  }, { hermesHome: "/safe/home/.hermes" });
  assert.deepEqual(env, {
    PATH: "/safe/bin",
    HOME: "/safe/home",
    TMPDIR: "/safe/tmp",
    LANG: "ko_KR.UTF-8",
    HERMES_HOME: "/safe/home/.hermes",
    LITHERMES_AUTO_UPDATE_RUNNING: "1",
  });
});

test("automatic update commits a transaction only after a truthful post-install doctor", async () => {
  const runAutomaticUpdate = requireFunction("runAutomaticUpdate");
  const home = makeTempDir("lithermes-auto-update-commit-");
  const plugin = path.join(home, "plugins", "lithermes");
  const config = path.join(home, "config.yaml");
  const manifest = path.join(home, "lithermes", "install-manifest.json");
  fs.mkdirSync(plugin, { recursive: true });
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.writeFileSync(path.join(plugin, "plugin.yaml"), "version: 0.8.41\n");
  fs.writeFileSync(config, "old-config\n");
  fs.writeFileSync(manifest, JSON.stringify({ version: "0.8.41" }));
  const spawns = [];
  const result = await runAutomaticUpdate({
    currentVersion: "0.8.41",
    latestVersion: "0.8.42",
    hermesHome: home,
    env: { PATH: "/safe/bin", HOME: "/safe/home", NPM_TOKEN: "must-not-leak" },
    spawnSync: (command, argv, options) => {
      spawns.push({ command, argv, options });
      fs.writeFileSync(path.join(plugin, "plugin.yaml"), "version: 0.8.42\n");
      return { status: 0, signal: null, stdout: "", stderr: "" };
    },
    doctor: () => ({ ok: true, message: "PASS" }),
  });
  assert.equal(result.status, "updated");
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].command, "npx");
  assert.deepEqual(spawns[0].argv, [
    "--yes", "--package", "@litfamily/lithermes@0.8.42", "--", "lithermes", "install", "--yes", "--no-hud", "--no-style", "--no-patch-installed-hermes", "--hermes-home", home,
  ]);
  assert.equal(spawns[0].options.timeout, 30_000);
  assert.equal(spawns[0].options.env.NPM_TOKEN, undefined);
  assert.equal(spawns[0].options.env.LITHERMES_AUTO_UPDATE_RUNNING, "1");
  assert.equal(fs.existsSync(result.receiptPath), true);
  assert.equal(JSON.parse(fs.readFileSync(result.receiptPath, "utf8")).status, "updated");
  assert.equal(fs.existsSync(path.join(home, "lithermes", "auto-update.lock")), false);
  assert.equal(fs.existsSync(path.join(home, "lithermes", "update-check.lock")), false);
});

test("automatic update recovers a bounded stale owner but never steals a fresh lock", async () => {
  const runAutomaticUpdate = requireFunction("runAutomaticUpdate");
  const staleMs = notifier.AUTO_UPDATE_LOCK_STALE_MS;
  const nowMs = Date.now();
  const home = makeTempDir("lithermes-auto-update-stale-lock-");
  const plugin = path.join(home, "plugins", "lithermes");
  const state = path.join(home, "lithermes");
  const manifest = path.join(state, "install-manifest.json");
  const lockPath = path.join(state, "auto-update.lock");
  fs.mkdirSync(plugin, { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(plugin, "plugin.yaml"), "version: 0.8.41\n");
  fs.writeFileSync(manifest, JSON.stringify({ version: "0.8.41" }));
  fs.writeFileSync(lockPath, `${JSON.stringify({ owner: "a".repeat(32), pid: 999999, acquiredAt: new Date(nowMs - staleMs - 1).toISOString() })}\n`, { mode: 0o600 });
  let spawnCount = 0;
  const recovered = await runAutomaticUpdate({
    currentVersion: "0.8.41",
    latestVersion: "0.8.42",
    hermesHome: home,
    now: () => nowMs,
    spawnSync: () => {
      spawnCount += 1;
      fs.writeFileSync(path.join(plugin, "plugin.yaml"), "version: 0.8.42\n");
      return { status: 0, signal: null };
    },
    doctor: () => ({ ok: true }),
  });
  assert.equal(recovered.status, "updated");
  assert.equal(spawnCount, 1);
  assert.equal(fs.existsSync(lockPath), false);

  fs.writeFileSync(lockPath, `${JSON.stringify({ owner: "b".repeat(32), pid: process.pid, acquiredAt: new Date(nowMs).toISOString() })}\n`, { mode: 0o600 });
  const skipped = await runAutomaticUpdate({
    currentVersion: "0.8.41",
    latestVersion: "0.8.42",
    hermesHome: home,
    now: () => nowMs,
    spawnSync: () => {
      throw new Error("fresh lock must prevent child launch");
    },
    doctor: () => ({ ok: true }),
  });
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.reason, "auto-update-lock-held");
  assert.equal(spawnCount, 1);

  fs.writeFileSync(lockPath, `${JSON.stringify({ owner: "c".repeat(32), pid: process.pid, acquiredAt: new Date(nowMs - staleMs - 1).toISOString() })}\n`, { mode: 0o600 });
  const liveOwner = await runAutomaticUpdate({
    currentVersion: "0.8.41",
    latestVersion: "0.8.42",
    hermesHome: home,
    now: () => nowMs,
    spawnSync: () => {
      throw new Error("live stale owner must not be stolen");
    },
    doctor: () => ({ ok: true }),
  });
  assert.equal(liveOwner.status, "skipped");
  assert.equal(liveOwner.reason, "auto-update-lock-held");
  assert.equal(spawnCount, 1);
});

test("automatic update rolls back the plugin and records a failure receipt on timeout or misleading doctor", async () => {
  const runAutomaticUpdate = requireFunction("runAutomaticUpdate");
  for (const outcome of [
    { label: "timeout", spawn: () => ({ status: null, signal: "SIGTERM", error: new Error("timeout") }), doctor: undefined },
    { label: "misleading doctor", spawn: () => ({ status: 0, signal: null }), doctor: () => ({ message: "PASS" }) },
  ]) {
    const home = makeTempDir(`lithermes-auto-update-${outcome.label.replace(/\s+/g, "-")}-`);
    const plugin = path.join(home, "plugins", "lithermes");
    const config = path.join(home, "config.yaml");
    const manifest = path.join(home, "lithermes", "install-manifest.json");
    fs.mkdirSync(plugin, { recursive: true });
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.writeFileSync(path.join(plugin, "plugin.yaml"), "version: 0.8.41\n");
    fs.writeFileSync(config, "old-config\n");
    fs.writeFileSync(manifest, JSON.stringify({ version: "0.8.41" }));
    const result = await runAutomaticUpdate({
      currentVersion: "0.8.41",
      latestVersion: "0.8.42",
      hermesHome: home,
      spawnSync: outcome.spawn,
      doctor: outcome.doctor,
    });
    assert.equal(result.status, "failed", outcome.label);
    assert.equal(fs.readFileSync(path.join(plugin, "plugin.yaml"), "utf8"), "version: 0.8.41\n", outcome.label);
    assert.equal(fs.readFileSync(config, "utf8"), "old-config\n", outcome.label);
    assert.deepEqual(JSON.parse(fs.readFileSync(manifest, "utf8")), { version: "0.8.41" }, outcome.label);
    const receipt = JSON.parse(fs.readFileSync(result.receiptPath, "utf8"));
    assert.equal(receipt.status, "failed", outcome.label);
    assert.equal(receipt.rollback.status, "restored", outcome.label);
    assert.equal(fs.existsSync(path.join(home, "lithermes", "auto-update.lock")), false, outcome.label);
  }
});

test("automatic update fails closed when rollback itself cannot restore the payload", async () => {
  const runAutomaticUpdate = requireFunction("runAutomaticUpdate");
  const home = makeTempDir("lithermes-auto-update-rollback-failure-");
  const plugin = path.join(home, "plugins", "lithermes");
  const manifest = path.join(home, "lithermes", "install-manifest.json");
  fs.mkdirSync(plugin, { recursive: true });
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.writeFileSync(path.join(plugin, "plugin.yaml"), "version: 0.8.41\n");
  fs.writeFileSync(manifest, JSON.stringify({ version: "0.8.41" }));
  const originalCopyFileSync = fs.copyFileSync;
  let blockBackupRestore = false;
  try {
    fs.copyFileSync = (source, target, ...rest) => {
      if (blockBackupRestore && String(source).includes(`${path.sep}backup${path.sep}`)) {
        throw new Error("injected restore failure");
      }
      return originalCopyFileSync(source, target, ...rest);
    };
    const failed = await runAutomaticUpdate({
      currentVersion: "0.8.41",
      latestVersion: "0.8.42",
      hermesHome: home,
      spawnSync: () => {
        blockBackupRestore = true;
        return { status: null, signal: "SIGTERM" };
      },
      doctor: undefined,
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.state, "unknown");
    assert.equal(failed.rollback.status, "failed");
    assert.match(failed.reason, /unknown/i);
    const receipt = JSON.parse(fs.readFileSync(failed.receiptPath, "utf8"));
    assert.equal(receipt.state, "unknown");
    assert.equal(receipt.rollback.status, "failed");
    assert.equal(receipt.rollbackFailure, true);
  } finally {
    fs.copyFileSync = originalCopyFileSync;
  }
});


test("scoped update package names are exact safe npm identities", () => {
  const options = { latestVersion: "98.76.54", hermesHome: "/tmp/hermes home" };
  for (const packageName of ["@litfamily/lithermes", "@scope-name/package_name", "lithermes-ai"]) {
    const argv = notifier.buildAutoUpdateArgv({ ...options, packageName });
    assert.deepEqual(argv.slice(0, 5), ["--yes", "--package", `${packageName}@98.76.54`, "--", "lithermes"]);
  }
  for (const packageName of ["", "@litfamily", "@/hermes", "@litfamily/", "@litfamily/lithermes/extra", "@litfamily/../hermes", "../hermes", "/tmp/hermes", "https://example.test/pkg", "file:hermes", "@litfamily/lithermes@latest", "@litfamily/lithermes ", " @litfamily/lithermes", "@litfamily/lithermes\n", "@LitFamily/hermes", "-hermes", "@scope/.hidden", "@scope/%2e%2e"]) {
    assert.throws(() => notifier.buildAutoUpdateArgv({ ...options, packageName }), /package name is invalid/, JSON.stringify(packageName));
  }
});

test("old and intermediate package metadata do not authorize the full-product scoped updater", () => {
  assert.equal(notifier.PACKAGE_NAME, "@litfamily/lithermes");
  assert.equal(notifier.REGISTRY_URL, "https://registry.npmjs.org/%40litfamily%2Flithermes/latest");
  for (const packageName of ["lithermes-ai", "@litfamily/hermes", "@litfamily/other", "@litfamily/lithermes/extra"]) {
    assert.equal(notifier.parseUpdateCache(JSON.stringify(validCache({ packageName })), { now: Date.parse("2026-07-23T12:00:00Z") }), null);
    assert.throws(() => notifier.parseRegistryResponse({ statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ name: packageName, version: "98.76.54" })) }), /package name/);
  }
});

test("automatic update refuses a symlinked plugins parent before snapshot or child execution", async () => {
  const home = makeTempDir("lithermes-update-parent-");
  const outside = makeTempDir("lithermes-update-outside-");
  const plugin = path.join(outside, "lithermes");
  fs.mkdirSync(plugin);
  fs.writeFileSync(path.join(plugin, "user.py"), "private bytes\n");
  const before = fs.statSync(plugin);
  fs.symlinkSync(outside, path.join(home, "plugins"), "dir");
  let calls = 0;
  const result = await notifier.runAutomaticUpdate({ currentVersion: "98.76.53", latestVersion: "98.76.54", hermesHome: home,
    spawnSync: () => { calls += 1; return { status: 5 }; },
  });
  assert.equal(calls, 0);
  assert.equal(result.status, "failed");
  assert.equal(result.rollback.status, "not-started");
  assert.equal(fs.statSync(plugin).ino, before.ino);
  assert.equal(fs.readFileSync(path.join(plugin, "user.py"), "utf8"), "private bytes\n");
});

test("automatic rollback preserves an outside target when the plugins parent is replaced", async () => {
  const home = makeTempDir("lithermes-update-parent-swap-");
  const outside = makeTempDir("lithermes-update-swap-outside-");
  const plugin = path.join(home, "plugins", "lithermes");
  const externalPlugin = path.join(outside, "lithermes");
  fs.mkdirSync(plugin, { recursive: true });
  fs.mkdirSync(externalPlugin);
  fs.writeFileSync(path.join(plugin, "user.py"), "original owned bytes\n");
  fs.writeFileSync(path.join(externalPlugin, "user.py"), "foreign bytes\n");
  const before = fs.statSync(externalPlugin);
  const result = await notifier.runAutomaticUpdate({ currentVersion: "98.76.53", latestVersion: "98.76.54", hermesHome: home,
    spawnSync: () => {
      fs.renameSync(path.join(home, "plugins"), path.join(home, "original-plugins"));
      fs.symlinkSync(outside, path.join(home, "plugins"), "dir");
      return { status: 5 };
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.state, "unknown");
  assert.equal(result.rollback.status, "failed");
  assert.equal(fs.statSync(externalPlugin).ino, before.ino);
  assert.equal(fs.readFileSync(path.join(externalPlugin, "user.py"), "utf8"), "foreign bytes\n");
  const journal = JSON.parse(fs.readFileSync(result.journalPath, "utf8"));
  assert.equal(fs.readFileSync(path.join(journal.backupRoot, "pluginPath", "user.py"), "utf8"), "original owned bytes\n");
});


test("current candidate updater preserves a newer installed state without launching a child", () => {
  const candidateVersion = require("../package.json").version;
  const parts = candidateVersion.split(".").map(Number);
  parts[2] += 1;
  const newerVersion = parts.join(".");
  const home = makeTempDir("lithermes-newer-candidate-");
  const state = path.join(home, "lithermes");
  fs.mkdirSync(state);
  const receipt = path.join(state, "install-manifest.json");
  const bytes = JSON.stringify({ version: newerVersion, files: [] });
  fs.writeFileSync(receipt, bytes);
  const before = fs.statSync(receipt);
  let calls = 0;
  const result = notifier.runAutomaticUpdate({ currentVersion: newerVersion, latestVersion: candidateVersion, hermesHome: home,
    spawnSync: () => { calls += 1; throw new Error("unexpected child"); },
  });
  assert.equal(result.status, "current");
  assert.equal(calls, 0);
  assert.equal(fs.readFileSync(receipt, "utf8"), bytes);
  assert.equal(fs.statSync(receipt).ino, before.ino);
  assert.deepEqual(fs.readdirSync(state), ["install-manifest.json"]);
});
