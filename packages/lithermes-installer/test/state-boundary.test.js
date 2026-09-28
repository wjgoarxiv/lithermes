const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const childProcess = require("node:child_process");
const childCalls = [];
const spawnSync = childProcess.spawnSync;
// Capture discovery too: an unsafe state parent must stop before any child.
childProcess.spawnSync = (...args) => { childCalls.push(args); return { status: 1 }; };
const installer = require("../src/lib/install");
childProcess.spawnSync = spawnSync;
const notifier = require("../src/lib/updateNotifier");
const { sha256 } = require("../src/lib/files");

function snapshot(root) {
  const result = {};
  function visit(file) {
    const stat = fs.lstatSync(file);
    result[path.relative(root, file)] = {
      dev: stat.dev, ino: stat.ino, mode: stat.mode,
      ...(stat.isSymbolicLink() ? { link: fs.readlinkSync(file) } : {}),
      ...(stat.isFile() ? { bytes: fs.readFileSync(file).toString("hex") } : {}),
    };
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name));
  }
  visit(root);
  return result;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-state-boundary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const state = path.join(home, "lithermes");
  const plugin = installer.pluginDest(home);
  const outside = path.join(root, "external");
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(plugin, { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(plugin, "owned.py"), "VALUE = 42\n");
  fs.writeFileSync(installer.manifestPath(home), JSON.stringify({ version: require("../package.json").version,
    files: [{ path: "owned.py", sha256: sha256(path.join(plugin, "owned.py")) }] }));
  fs.writeFileSync(path.join(home, "config.yaml"), "custom_setting: keep-me\n");
  fs.writeFileSync(path.join(outside, "foreign.txt"), "foreign bytes\n");
  const flags = { yes: true, "hermes-home": home, "no-patch-installed-hermes": true };
  return { root, home, state, plugin, outside, flags };
}

for (const action of ["install", "uninstall", "auto-update", "advisory-update"]) {
  for (const kind of ["real symlink", "dangling symlink", "non-directory"]) {
    test(`${action} refuses state parent ${kind} without writes or children`, async (t) => {
      const f = fixture(t);
      fs.renameSync(f.state, path.join(f.root, "original-state"));
      if (kind === "non-directory") fs.writeFileSync(f.state, "foreign state file\n");
      else fs.symlinkSync(kind === "real symlink" ? f.outside : path.join(f.root, "absent"), f.state);
      fs.copyFileSync(path.join(f.root, "original-state", "install-manifest.json"), path.join(f.outside, "install-manifest.json"));
      const before = snapshot(f.root);
      childCalls.length = 0;
      let calls = 0;
      let result;
      try {
        if (action === "install") result = installer.installLitHermes({ ...f.flags, force: true });
        if (action === "uninstall") result = installer.uninstallLitHermes(f.flags);
        if (action === "auto-update") result = await notifier.runAutomaticUpdate({ hermesHome: f.home,
          currentVersion: "98.76.53", latestVersion: "98.76.54", spawnSync: () => { calls++; return { status: 0 }; }, doctor: () => ({ ok: true }) });
        if (action === "advisory-update") result = notifier.scheduleUpdateCheck({ command: "check", currentVersion: "98.76.53" }, {
          resolveHermesHome: () => f.home, env: {}, streams: { stdin: { isTTY: true }, stdout: { isTTY: true }, stderr: { isTTY: true, write() {} } },
          spawn: () => { calls++; return { once() {}, unref() {} }; },
        });
      } catch (error) { result = { error: error.message, exitCode: error.exitCode }; }
      const after = snapshot(f.root);
      t.diagnostic(JSON.stringify({ action, kind, result, children: childCalls.length + calls, unchanged: JSON.stringify(before) === JSON.stringify(after) }));
      assert.deepEqual(after, before);
      assert.equal(childCalls.length + calls, 0);
      if (action === "install" || action === "uninstall") assert.equal(result.exitCode, 5);
      else if (action === "auto-update") assert.equal(result.status, "failed");
      else assert.equal(result.refreshScheduled, false);
    });
  }
}

for (const step of ["Copying LitHermes payload", "Recording install manifest"]) {
  test(`install rechecks a state parent swap at ${step}`, (t) => {
    const f = fixture(t);
    const outside = snapshot(f.outside);
    let atSwap;
    assert.throws(() => installer.installLitHermes({ ...f.flags, onProgress(current) {
      if (current !== step) return;
      fs.renameSync(f.state, path.join(f.root, "original-state"));
      fs.symlinkSync(f.outside, f.state);
      fs.writeFileSync(path.join(f.outside, "install.lock"), "foreign lock");
      atSwap = { plugin: snapshot(f.plugin), config: fs.readFileSync(path.join(f.home, "config.yaml")) };
    } }), (error) => error.exitCode === 5);
    assert.deepEqual(snapshot(f.plugin), atSwap.plugin);
    assert.deepEqual(fs.readFileSync(path.join(f.home, "config.yaml")), atSwap.config);
    assert.equal(fs.readFileSync(path.join(f.outside, "install.lock"), "utf8"), "foreign lock");
    fs.unlinkSync(path.join(f.outside, "install.lock"));
    assert.deepEqual(snapshot(f.outside), outside);
  });
}

test("uninstall rechecks a state parent swap after reading the manifest", (t) => {
  const f = fixture(t);
  const beforePlugin = snapshot(f.plugin);
  const beforeConfig = fs.readFileSync(path.join(f.home, "config.yaml"));
  const outside = snapshot(f.outside);
  const read = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (file, ...args) => {
    const value = read(file, ...args);
    if (typeof file === "number" && String(value).includes("files")) {
      fs.renameSync(f.state, path.join(f.root, "original-state"));
      fs.symlinkSync(f.outside, f.state);
    }
    return value;
  });
  assert.throws(() => installer.uninstallLitHermes(f.flags), (error) => error.exitCode === 5);
  assert.deepEqual(snapshot(f.plugin), beforePlugin);
  assert.deepEqual(fs.readFileSync(path.join(f.home, "config.yaml")), beforeConfig);
  assert.deepEqual(snapshot(f.outside), outside);
});

test("automatic update refuses state swap before rollback and receipt/lock cleanup", async (t) => {
  const f = fixture(t);
  const originalState = path.join(f.root, "original-state");
  const plugin = snapshot(f.plugin);
  const config = fs.readFileSync(path.join(f.home, "config.yaml"));
  let outside;
  const result = await notifier.runAutomaticUpdate({ hermesHome: f.home,
    currentVersion: "98.76.53", latestVersion: "98.76.54", spawnSync: () => {
      fs.renameSync(f.state, originalState);
      // Identical lock bytes still belong to the replacement directory.
      fs.copyFileSync(path.join(originalState, "auto-update.lock"), path.join(f.outside, "auto-update.lock"));
      fs.symlinkSync(f.outside, f.state);
      outside = snapshot(f.outside);
      return { status: 5 };
    }, doctor: () => { throw new Error("must not launch doctor"); },
  });
  assert.deepEqual(snapshot(f.outside), outside);
  assert.deepEqual(snapshot(f.plugin), plugin);
  assert.deepEqual(fs.readFileSync(path.join(f.home, "config.yaml")), config);
  assert.equal(result.status, "failed");
  assert.equal(result.state, "unknown");
  assert.equal(result.rollback.status, "failed");
  assert.ok(fs.existsSync(path.join(originalState, "auto-update")));
});

for (const kind of ["symlink", "directory"]) {
  test(`automatic update refuses state ${kind} replacement during version fetch`, async (t) => {
    const f = fixture(t);
    let before;
    let children = 0;
    const result = await notifier.runAutomaticUpdate({ hermesHome: f.home, currentVersion: "98.76.53",
      fetchLatestVersionFn: async () => {
        fs.renameSync(f.state, path.join(f.root, "original-state"));
        if (kind === "symlink") fs.symlinkSync(f.outside, f.state);
        else fs.mkdirSync(f.state);
        before = snapshot(f.root);
        return "98.76.54";
      }, spawnSync: () => { children++; return { status: 0 }; },
    });
    assert.equal(result.status, "failed");
    assert.equal(children, 0);
    assert.deepEqual(snapshot(f.root), before);
  });

  test(`advisory completion refuses state ${kind} replacement during fetch`, async (t) => {
    const f = fixture(t);
    const cache = path.join(f.state, "update-check.json");
    const reservation = notifier.reserveUpdateAttempt(cache);
    assert.equal(reservation.reserved, true);
    let before;
    const result = await notifier.refreshUpdateCache(cache, { attemptOwner: reservation.owner,
      fetchLatestVersionFn: async () => {
        fs.renameSync(f.state, path.join(f.root, "original-state"));
        if (kind === "symlink") fs.symlinkSync(f.outside, f.state);
        else fs.mkdirSync(f.state);
        before = snapshot(f.root);
        return "98.76.54";
      },
    });
    assert.equal(result, false);
    assert.deepEqual(snapshot(f.root), before);
  });
}

test("install rejects a replacement real state directory at the copy checkpoint", (t) => {
  const f = fixture(t);
  let before;
  assert.throws(() => installer.installLitHermes({ ...f.flags, onProgress(step) {
    if (step !== "Copying LitHermes payload") return;
    fs.renameSync(f.state, path.join(f.root, "original-state"));
    fs.mkdirSync(f.state);
    fs.writeFileSync(path.join(f.state, "install.lock"), "replacement lock");
    before = snapshot(f.root);
  } }), (error) => error.exitCode === 5);
  assert.deepEqual(snapshot(f.root), before);
});

test("missing state supports fresh install, repeat and removal", (t) => {
  const f = fixture(t);
  fs.rmSync(f.state, { recursive: true });
  fs.rmSync(f.plugin, { recursive: true });
  installer.installLitHermes(f.flags);
  assert.equal(fs.lstatSync(f.state).isDirectory(), true);
  installer.installLitHermes(f.flags);
  installer.uninstallLitHermes(f.flags);
  assert.equal(fs.existsSync(f.plugin), false);
});

for (const kind of ["symlink", "dangling", "file"]) {
  test(`automatic update refuses unsafe transaction parent ${kind}`, async (t) => {
    const f = fixture(t);
    const target = path.join(f.state, "auto-update");
    if (kind === "file") fs.writeFileSync(target, "foreign state");
    else fs.symlinkSync(kind === "symlink" ? f.outside : path.join(f.root, "absent"), target);
    const before = snapshot(f.root);
    let children = 0;
    const result = await notifier.runAutomaticUpdate({ hermesHome: f.home, currentVersion: "98.76.53", latestVersion: "98.76.54",
      spawnSync: () => { children++; return { status: 0 }; }, doctor: () => ({ ok: true }),
    });
    assert.deepEqual(snapshot(f.root), before);
    assert.equal(children, 0);
    assert.equal(result.status, "failed");
  });
}

test("state JSON symlink leaves are not read", (t) => {
  const f = fixture(t);
  const foreign = path.join(f.outside, "manifest.json");
  fs.renameSync(installer.manifestPath(f.home), foreign);
  fs.symlinkSync(foreign, installer.manifestPath(f.home));
  assert.throws(() => installer.loadManifest(f.home), (error) => error.exitCode === 5);
  const cache = path.join(f.state, "update-check.json");
  fs.symlinkSync(foreign, cache);
  let reads = 0;
  assert.equal(notifier.readUpdateCache(cache, { readFileSync() { reads++; return "{}"; } }), null);
  assert.equal(reads, 0);
});

test("installer closes its descriptor after lock write failure", (t) => {
  const f = fixture(t);
  const write = fs.writeFileSync;
  let fd;
  t.mock.method(fs, "writeFileSync", (target, ...args) => {
    if (typeof target === "number") { fd = target; throw new Error("injected install lock write failure"); }
    return write(target, ...args);
  });
  assert.throws(() => installer.installLitHermes(f.flags), /injected install lock write failure/);
  assert.throws(() => fs.fstatSync(fd), { code: "EBADF" });
  assert.equal(fs.existsSync(path.join(f.state, "install.lock")), false);
});

test("advisory lock-write failure does not delete a foreign lock after state swap", (t) => {
  const f = fixture(t);
  const write = fs.writeSync;
  const originalState = path.join(f.root, "original-state");
  let before;
  t.mock.method(fs, "writeSync", (fd, ...args) => {
    fs.renameSync(f.state, originalState);
    fs.symlinkSync(f.outside, f.state);
    fs.writeFileSync(path.join(f.outside, "update-check.transition.lock"), "foreign lock");
    before = snapshot(f.outside);
    throw new Error("injected advisory lock write failure");
  });
  assert.equal(notifier.reserveUpdateAttempt(path.join(f.state, "update-check.json")).reserved, false);
  assert.deepEqual(snapshot(f.outside), before);
});

for (const boundary of ["auto-update", "backup"]) {
  test(`automatic rollback refuses replaced ${boundary} directory`, async (t) => {
    const f = fixture(t);
    const plugin = snapshot(f.plugin);
    const config = fs.readFileSync(path.join(f.home, "config.yaml"));
    let outside;
    const result = await notifier.runAutomaticUpdate({ hermesHome: f.home, currentVersion: "98.76.53", latestVersion: "98.76.54",
      spawnSync: () => {
        const transactionParent = path.join(f.state, "auto-update");
        const target = boundary === "auto-update" ? transactionParent : path.join(transactionParent, fs.readdirSync(transactionParent)[0], "backup");
        fs.renameSync(target, path.join(f.root, "retained-transaction"));
        fs.symlinkSync(f.outside, target);
        outside = snapshot(f.outside);
        return { status: 5 };
      },
    });
    assert.equal(result.status, "failed");
    assert.equal(result.state, "unknown");
    assert.deepEqual(snapshot(f.outside), outside);
    assert.deepEqual(snapshot(f.plugin), plugin);
    assert.deepEqual(fs.readFileSync(path.join(f.home, "config.yaml")), config);
  });
}

test("state swap during final receipt persistence cannot report updated", async (t) => {
  const f = fixture(t);
  const rename = fs.renameSync;
  let outside;
  t.mock.method(fs, "renameSync", (from, to) => {
    const value = rename(from, to);
    if (to === path.join(f.state, "auto-update-receipt.json")) {
      rename(f.state, path.join(f.root, "retained-state"));
      fs.symlinkSync(f.outside, f.state);
      outside = snapshot(f.outside);
    }
    return value;
  });
  const result = await notifier.runAutomaticUpdate({ hermesHome: f.home, currentVersion: "98.76.53", latestVersion: "98.76.54",
    spawnSync: () => ({ status: 0 }), doctor: () => ({ ok: true }),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.state, "unknown");
  assert.equal(result.receiptWritten, false);
  assert.deepEqual(snapshot(f.outside), outside);
});

for (const reader of ["manifest", "update cache"]) {
  test(`${reader} refuses state swap during descriptor open before content read`, (t) => {
    const f = fixture(t);
    const file = reader === "manifest" ? installer.manifestPath(f.home) : path.join(f.state, "update-check.json");
    if (reader !== "manifest") fs.writeFileSync(file, "{}");
    const open = fs.openSync;
    const read = fs.readFileSync;
    let reads = 0;
    t.mock.method(fs, "openSync", (target, ...args) => {
      const fd = open(target, ...args);
      if (target === file) {
        const retained = path.join(f.root, "retained-state");
        fs.renameSync(f.state, retained);
        fs.symlinkSync(retained, f.state);
      }
      return fd;
    });
    t.mock.method(fs, "readFileSync", (...args) => { reads++; return read(...args); });
    if (reader === "manifest") assert.throws(() => installer.loadManifest(f.home), (error) => error.exitCode === 5);
    else assert.equal(notifier.readUpdateCache(file), null);
    assert.equal(reads, 0);
  });
}

test("automatic lock-write failure preserves a replacement lock in the original state directory", async (t) => {
  const f = fixture(t);
  const write = fs.writeFileSync;
  const lock = path.join(f.state, "auto-update.lock");
  let foreign;
  t.mock.method(fs, "writeFileSync", (target, ...args) => {
    if (typeof target === "number") {
      fs.renameSync(lock, path.join(f.state, "failed-owned.lock"));
      write(lock, "foreign lock bytes");
      foreign = fs.lstatSync(lock);
      throw new Error("injected auto lock write failure");
    }
    return write(target, ...args);
  });
  let children = 0;
  const result = await notifier.runAutomaticUpdate({ hermesHome: f.home, currentVersion: "98.76.53", latestVersion: "98.76.54",
    spawnSync: () => { children++; return { status: 0 }; },
  });
  assert.equal(result.status, "failed");
  assert.equal(children, 0);
  assert.equal(fs.readFileSync(lock, "utf8"), "foreign lock bytes");
  assert.equal(fs.lstatSync(lock).ino, foreign.ino);
});
