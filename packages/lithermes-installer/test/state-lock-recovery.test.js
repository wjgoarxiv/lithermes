const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const installer = require("../src/lib/install");
const notifier = require("../src/lib/updateNotifier");

// A lock whose holder died must never block install, update or the update check forever.
const MAX_HOLD_MS = 10 * 60 * 1000;

function home(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-state-lock-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "lithermes"), { recursive: true });
  fs.writeFileSync(path.join(root, "config.yaml"), "custom_setting: keep-me\n");
  return root;
}

function plant(file, text, ageMs) {
  fs.writeFileSync(file, text, { mode: 0o600 });
  const at = new Date(Date.now() - ageMs);
  fs.utimesSync(file, at, at);
}

function deadPid() {
  const child = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  return Number(child.stdout);
}

const flags = (h) => ({ yes: true, "hermes-home": h, "no-patch-installed-hermes": true });
const installLock = (h) => path.join(h, "lithermes", "install.lock");

test("install reclaims an ownerless install lock older than the stale window", (t) => {
  const h = home(t);
  plant(installLock(h), "", 5 * 60 * 1000);
  installer.installLitHermes(flags(h));
  assert.equal(fs.existsSync(installLock(h)), false);
  assert.ok(fs.existsSync(installer.manifestPath(h)), "the install ran");
});

test("install waits on a fresh ownerless lock and names it in the error", (t) => {
  const h = home(t);
  plant(installLock(h), "", 0);
  assert.throws(() => installer.installLitHermes(flags(h)), (error) => {
    assert.ok(error.message.includes(installLock(h)), error.message);
    assert.match(error.message, /no owner record/);
    return true;
  });
  assert.equal(fs.existsSync(installLock(h)), true, "a fresh lock is left alone");
});

test("install reclaims a lock whose holder pid is dead", (t) => {
  const h = home(t);
  plant(installLock(h), String(deadPid()), 1000);
  installer.installLitHermes(flags(h));
  assert.equal(fs.existsSync(installLock(h)), false);
});

test("install reclaims a lock past the hard ceiling even when its pid is alive (pid reuse)", (t) => {
  const h = home(t);
  plant(installLock(h), String(process.pid), MAX_HOLD_MS + 60_000);
  installer.installLitHermes(flags(h));
  assert.equal(fs.existsSync(installLock(h)), false);
});

test("install waits on a live holder younger than the ceiling and names pid and age", (t) => {
  const h = home(t);
  plant(installLock(h), String(process.pid), 2000);
  assert.throws(() => installer.installLitHermes(flags(h)), new RegExp(`pid ${process.pid}, age \\d+s`));
  assert.equal(fs.existsSync(installLock(h)), true);
});

function autoUpdateHome(t) {
  const h = home(t);
  const plugin = path.join(h, "plugins", "lithermes");
  fs.mkdirSync(plugin, { recursive: true });
  fs.writeFileSync(path.join(plugin, "plugin.yaml"), "version: 0.8.41\n");
  fs.writeFileSync(path.join(h, "lithermes", "install-manifest.json"), JSON.stringify({ version: "0.8.41" }));
  return { h, plugin, lock: path.join(h, "lithermes", notifier.AUTO_UPDATE_LOCK_NAME) };
}

async function autoUpdate(f, nowMs) {
  return notifier.runAutomaticUpdate({
    currentVersion: "0.8.41",
    latestVersion: "0.8.42",
    hermesHome: f.h,
    now: () => nowMs,
    spawnSync: () => {
      fs.writeFileSync(path.join(f.plugin, "plugin.yaml"), "version: 0.8.42\n");
      return { status: 0, signal: null };
    },
    doctor: () => ({ ok: true }),
  });
}

test("automatic update reclaims a live-pid lock past the hard ceiling (pid reuse)", async (t) => {
  const f = autoUpdateHome(t);
  const nowMs = Date.now();
  plant(f.lock, `${JSON.stringify({ owner: "c".repeat(32), pid: process.pid, acquiredAt: new Date(nowMs - MAX_HOLD_MS - 1).toISOString() })}\n`, MAX_HOLD_MS + 1);
  const result = await autoUpdate(f, nowMs);
  assert.equal(result.status, "updated", JSON.stringify(result));
  assert.equal(fs.existsSync(f.lock), false);
});

test("automatic update reclaims an unreadable lock past the hard ceiling", { skip: process.platform === "win32" || process.getuid?.() === 0 }, async (t) => {
  const f = autoUpdateHome(t);
  plant(f.lock, "x", MAX_HOLD_MS + 60_000);
  fs.chmodSync(f.lock, 0o000);
  const result = await autoUpdate(f, Date.now());
  assert.equal(result.status, "updated", JSON.stringify(result));
});

test("the update check reclaims a transition mutex left by a dead holder", (t) => {
  const h = home(t);
  const cacheDir = path.join(h, "lithermes");
  plant(path.join(cacheDir, "update-check.transition.lock"), "", MAX_HOLD_MS + 60_000);
  const result = notifier.reserveUpdateAttempt(path.join(cacheDir, "update-check.json"));
  assert.equal(result.reserved, true, JSON.stringify(result));
  assert.equal(fs.existsSync(path.join(cacheDir, "update-check.transition.lock")), false);
});

test("the update check leaves a fresh transition mutex alone", (t) => {
  const h = home(t);
  const cacheDir = path.join(h, "lithermes");
  plant(path.join(cacheDir, "update-check.transition.lock"), "", 0);
  assert.equal(notifier.reserveUpdateAttempt(path.join(cacheDir, "update-check.json")).reserved, false);
  assert.equal(fs.existsSync(path.join(cacheDir, "update-check.transition.lock")), true);
});
