const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { installLitHermes, uninstallLitHermes, manifestPath, pluginDest } = require("../src/lib/install");
const { sha256 } = require("../src/lib/files");

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-migration-ownership-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dest = pluginDest(home);
  fs.mkdirSync(dest, { recursive: true });
  fs.mkdirSync(path.dirname(manifestPath(home)), { recursive: true });
  const owned = path.join(dest, "owned.txt");
  fs.writeFileSync(owned, "prior managed payload\n");
  fs.writeFileSync(manifestPath(home), JSON.stringify({
    version: require("../package.json").version, files: [{ path: "owned.txt", sha256: sha256(owned) }],
  }));
  fs.writeFileSync(path.join(home, "config.yaml"), "custom_setting: keep-me\n");
  const flags = { yes: true, "hermes-home": home, "no-patch-installed-hermes": true };
  return { home, dest, owned, flags };
}

for (const relative of ["personal-notes.txt", "__pycache__/personal.txt", "personal.pyc"]) {
  test(`repeat install refuses and preserves unrecorded ${relative}`, (t) => {
    const { home, dest, owned, flags } = fixture(t);
    const extra = path.join(dest, relative);
    fs.mkdirSync(path.dirname(extra), { recursive: true });
    fs.writeFileSync(extra, "user content\n");
    const config = fs.readFileSync(path.join(home, "config.yaml"));
    const manifest = fs.readFileSync(manifestPath(home));
    assert.throws(() => installLitHermes(flags), (error) => error.exitCode === 5);
    assert.equal(fs.readFileSync(extra, "utf8"), "user content\n");
    assert.equal(fs.readFileSync(owned, "utf8"), "prior managed payload\n");
    assert.deepEqual(fs.readFileSync(path.join(home, "config.yaml")), config);
    assert.deepEqual(fs.readFileSync(manifestPath(home)), manifest);
    assert.equal(fs.existsSync(path.join(home, "lithermes", "install.lock")), false);
  });
  test(`uninstall preserves unrecorded ${relative}`, (t) => {
    const { dest, owned, flags } = fixture(t);
    const extra = path.join(dest, relative);
    fs.mkdirSync(path.dirname(extra), { recursive: true });
    fs.writeFileSync(extra, "user content\n");
    uninstallLitHermes(flags);
    assert.equal(fs.readFileSync(extra, "utf8"), "user content\n");
    assert.equal(fs.existsSync(owned), false);
  });
}

test("explicit force keeps the documented replacement override", (t) => {
  const { dest, flags } = fixture(t);
  const extra = path.join(dest, "personal-notes.txt");
  fs.writeFileSync(extra, "backed-up user content\n");
  installLitHermes({ ...flags, force: true });
  assert.equal(fs.existsSync(extra), false);
  assert.equal(fs.existsSync(path.join(dest, "plugin.yaml")), true);
});

test("uninstall preserves modified managed files", (t) => {
  const { owned, flags } = fixture(t);
  fs.writeFileSync(owned, "user modification\n");
  uninstallLitHermes(flags);
  assert.equal(fs.readFileSync(owned, "utf8"), "user modification\n");
});

test("repeat install refuses a symlink even when its target matches the receipt", (t) => {
  const { home, dest, owned, flags } = fixture(t);
  const outside = path.join(home, "outside.txt");
  fs.renameSync(owned, outside);
  fs.symlinkSync(outside, owned);
  assert.throws(() => installLitHermes(flags), (error) => error.exitCode === 5);
  assert.equal(fs.lstatSync(owned).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(outside, "utf8"), "prior managed payload\n");
});

test("uninstall never follows a managed directory replaced with a symlink", (t) => {
  const { home, dest, flags } = fixture(t);
  const outside = path.join(home, "outside");
  fs.mkdirSync(outside);
  const file = path.join(outside, "user.txt");
  fs.writeFileSync(file, "user content\n");
  fs.symlinkSync(outside, path.join(dest, "linked"));
  fs.writeFileSync(manifestPath(home), JSON.stringify({ files: [{ path: "linked/user.txt", sha256: sha256(file) }] }));
  uninstallLitHermes(flags);
  assert.equal(fs.readFileSync(file, "utf8"), "user content\n");
  assert.equal(fs.lstatSync(path.join(dest, "linked")).isSymbolicLink(), true);
});

test("uninstall refuses a receipt path outside the plugin tree", (t) => {
  const { home, flags } = fixture(t);
  const file = path.join(home, "outside.txt");
  fs.writeFileSync(file, "user content\n");
  fs.writeFileSync(manifestPath(home), JSON.stringify({ files: [{ path: "../../outside.txt", sha256: sha256(file) }] }));
  assert.throws(() => uninstallLitHermes(flags), (error) => error.exitCode === 5);
  assert.equal(fs.readFileSync(file, "utf8"), "user content\n");
});

test("pristine prior receipt migrates and repeats while preserving unrelated settings", (t) => {
  const { home, dest, owned, flags } = fixture(t);
  installLitHermes(flags);
  assert.equal(fs.existsSync(owned), false);
  assert.equal(fs.existsSync(path.join(dest, "plugin.yaml")), true);
  const config = fs.readFileSync(path.join(home, "config.yaml"));
  assert.match(config.toString(), /custom_setting: keep-me/);
  installLitHermes(flags);
  assert.deepEqual(fs.readFileSync(path.join(home, "config.yaml")), config);
  uninstallLitHermes(flags);
  assert.equal(fs.existsSync(dest), false);
  assert.match(fs.readFileSync(path.join(home, "config.yaml"), "utf8"), /custom_setting: keep-me/);
});

test("repeat install refuses a dangling plugin symlink", (t) => {
  const { home, dest, flags } = fixture(t);
  fs.rmSync(dest, { recursive: true });
  fs.symlinkSync(path.join(home, "absent"), dest);
  assert.throws(() => installLitHermes(flags), (error) => error.exitCode === 5);
  assert.equal(fs.lstatSync(dest).isSymbolicLink(), true);
});

test("repeat install refuses modified managed files", (t) => {
  const { owned, flags } = fixture(t);
  fs.writeFileSync(owned, "user modification\n");
  assert.throws(() => installLitHermes(flags), (error) => error.exitCode === 5);
  assert.equal(fs.readFileSync(owned, "utf8"), "user modification\n");
});

test("stale receipt with a missing destination supports fresh install and uninstall", (t) => {
  const { dest, flags } = fixture(t);
  fs.rmSync(dest, { recursive: true });
  installLitHermes(flags);
  assert.equal(fs.existsSync(path.join(dest, "plugin.yaml")), true);
  fs.rmSync(dest, { recursive: true });
  uninstallLitHermes(flags);
  assert.equal(fs.existsSync(dest), false);
});

for (const action of [installLitHermes, uninstallLitHermes]) {
  for (const parentKind of ["symlink", "dangling symlink", "file"]) {
    test(`${action.name} refuses a ${parentKind} plugins parent even with force`, (t) => {
      const { home, flags } = fixture(t);
      const plugins = path.join(home, "plugins");
      const outside = path.join(home, "outside-plugins");
      fs.renameSync(plugins, outside);
      if (parentKind === "file") fs.writeFileSync(plugins, "user content\n");
      else fs.symlinkSync(parentKind === "symlink" ? outside : path.join(home, "absent"), plugins);
      const manifest = fs.readFileSync(manifestPath(home));
      const config = fs.readFileSync(path.join(home, "config.yaml"));
      assert.throws(() => action({ ...flags, force: true }), (error) => error.exitCode === 5);
      assert.equal(fs.readFileSync(path.join(outside, "lithermes", "owned.txt"), "utf8"), "prior managed payload\n");
      assert.deepEqual(fs.readFileSync(manifestPath(home)), manifest);
      assert.deepEqual(fs.readFileSync(path.join(home, "config.yaml")), config);
      assert.equal(fs.existsSync(path.join(home, "lithermes", "install.lock")), false);
      assert.equal(fs.lstatSync(plugins).isSymbolicLink(), parentKind !== "file");
    });
  }
}

test("an explicitly selected symlinked Hermes home remains supported", (t) => {
  const { home, dest, flags } = fixture(t);
  const alias = path.join(home, "home-alias");
  fs.symlinkSync(home, alias);
  const selected = { ...flags, "hermes-home": alias };
  installLitHermes(selected);
  assert.equal(fs.existsSync(path.join(dest, "plugin.yaml")), true);
  uninstallLitHermes(selected);
  assert.equal(fs.existsSync(dest), false);
});

test("normal Python import cache is retained outside a successful repeat installation", (t) => {
  const { home, dest, flags } = fixture(t);
  const source = path.join(dest, "migration_owned.py");
  fs.writeFileSync(source, "VALUE = 42\n");
  const manifest = JSON.parse(fs.readFileSync(manifestPath(home), "utf8"));
  manifest.files.push({ path: "migration_owned.py", sha256: sha256(source) });
  fs.writeFileSync(manifestPath(home), JSON.stringify(manifest));
  const imported = require("node:child_process").spawnSync(process.env.LITHERMES_PYTHON || "python3", [
    "-E", "-c", "import sys; sys.dont_write_bytecode = False; sys.path.insert(0, sys.argv[1]); import migration_owned; assert migration_owned.VALUE == 42; print(migration_owned.__cached__)", dest,
  ], {
    encoding: "utf8", cwd: home, timeout: 10000,
    env: { ...process.env, HOME: home, USERPROFILE: home, HERMES_HOME: home, TMPDIR: home },
  });
  assert.equal(imported.status, 0, `${imported.error || ""}${imported.stderr}`);
  const cache = imported.stdout.trim();
  assert.equal(path.dirname(cache), path.join(dest, "__pycache__"));
  const bytes = fs.readFileSync(cache);
  assert.ok(bytes.length > 0);
  const result = installLitHermes(flags);
  const receipt = JSON.parse(fs.readFileSync(manifestPath(home), "utf8"));
  assert.ok(receipt.retainedPythonCache);
  assert.match(result.message, /Retained Python cache backup:/);
  const retained = path.join(receipt.retainedPythonCache, path.relative(dest, cache));
  assert.deepEqual(fs.readFileSync(retained), bytes);
  assert.equal(fs.existsSync(cache), false);
  installLitHermes(flags);
  uninstallLitHermes(flags);
  assert.deepEqual(fs.readFileSync(retained), bytes);
  assert.equal(fs.existsSync(source), false);
});

function cacheFixture(t, nested = false) {
  const value = fixture(t);
  const relative = nested ? "nested/module.py" : "module.py";
  const source = path.join(value.dest, relative);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, "VALUE = 42\n");
  const manifest = JSON.parse(fs.readFileSync(manifestPath(value.home), "utf8"));
  manifest.files.push({ path: relative, sha256: sha256(source) });
  fs.writeFileSync(manifestPath(value.home), JSON.stringify(manifest));
  const cache = path.join(path.dirname(source), "__pycache__", "module.cpython-314.opt-1.pyc");
  fs.mkdirSync(path.dirname(cache));
  fs.writeFileSync(cache, Buffer.from([0, 255, 20, 0, 44]));
  return { ...value, source, cache };
}

test("cache-shaped opaque bytes are retained exactly and never installed as bytecode", (t) => {
  const { home, dest, cache, flags } = cacheFixture(t, true);
  const bytes = fs.readFileSync(cache);
  installLitHermes(flags);
  const backup = JSON.parse(fs.readFileSync(manifestPath(home))).retainedPythonCache;
  assert.equal(fs.statSync(backup).mode & 0o777, 0o700);
  assert.deepEqual(fs.readFileSync(path.join(backup, path.relative(dest, cache))), bytes);
  assert.equal(fs.existsSync(cache), false);
  const retained = JSON.parse(fs.readFileSync(path.join(backup, "retention.json")));
  assert.equal(retained.caches[0].files[0].sha256, require("node:crypto").createHash("sha256").update(bytes).digest("hex"));
});

for (const mutation of ["foreign source", "modified source", "cache symlink", "nested directory", "noncache file"]) {
  test(`cache retention refuses ${mutation} without moving bytes`, (t) => {
    const { home, source, cache, flags } = cacheFixture(t);
    if (mutation === "foreign source") fs.renameSync(cache, path.join(path.dirname(cache), "foreign.cpython-314.pyc"));
    if (mutation === "modified source") fs.appendFileSync(source, "# user change\n");
    if (mutation === "cache symlink") {
      fs.renameSync(cache, path.join(home, "opaque-bytes"));
      fs.symlinkSync(path.join(home, "opaque-bytes"), cache);
    }
    if (mutation === "nested directory") fs.mkdirSync(path.join(path.dirname(cache), "nested"));
    if (mutation === "noncache file") fs.writeFileSync(path.join(path.dirname(cache), "notes.txt"), "user content");
    assert.throws(() => installLitHermes(flags), (error) => error.exitCode === 5);
    assert.equal(fs.readdirSync(path.join(home, "lithermes")).some((name) => name.startsWith("retained-python-cache-")), false);
    assert.equal(fs.existsSync(path.dirname(cache)), true);
  });
}

for (const target of ["source", "cache"]) {
  test(`cache retention rejects ${target} drift after inspection`, (t) => {
    const { home, source, cache, flags } = cacheFixture(t);
    const changed = target === "source" ? source : cache;
    assert.throws(() => installLitHermes({ ...flags, onProgress(step) {
      if (step === "Copying LitHermes payload") fs.appendFileSync(changed, "user change");
    } }), (error) => error.exitCode === 5 && /changed before retention/.test(error.message));
    assert.match(fs.readFileSync(changed, "utf8"), /user change$/);
    assert.equal(fs.readdirSync(path.join(home, "lithermes")).some((name) => name.startsWith("retained-python-cache-")), false);
  });
}

for (const mutation of ["collision", "symlink"]) {
  test(`cache retention refuses backup ${mutation}`, (t) => {
    const { home, cache, flags } = cacheFixture(t);
    const original = fs.mkdtempSync;
    const outside = path.join(home, "outside-backup");
    fs.mkdirSync(outside);
    t.mock.method(fs, "mkdtempSync", (...args) => {
      const backup = original(...args);
      if (mutation === "collision") fs.writeFileSync(path.join(backup, "user.txt"), "existing bytes");
      else {
        fs.rmdirSync(backup);
        fs.symlinkSync(outside, backup);
      }
      return backup;
    });
    assert.throws(() => installLitHermes(flags), (error) => error.exitCode === 5 && /Unsafe Python cache backup destination/.test(error.message));
    assert.equal(fs.existsSync(cache), true);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
}

test("source drift after cache relocation refuses replacement and reports recoverable bytes", (t) => {
  const { home, dest, source, cache, flags } = cacheFixture(t);
  const bytes = fs.readFileSync(cache);
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => {
    const result = rename(from, to);
    if (from === path.dirname(cache)) fs.appendFileSync(source, "# user change\n");
    return result;
  });
  let failure;
  assert.throws(() => installLitHermes(flags), (error) => { failure = error; return error.exitCode === 5; });
  assert.match(failure.message, /Retained Python cache backup:/);
  const backup = failure.message.split("Retained Python cache backup: ")[1];
  assert.deepEqual(fs.readFileSync(path.join(backup, path.relative(dest, cache))), bytes);
  assert.match(fs.readFileSync(source, "utf8"), /user change/);
  assert.equal(fs.existsSync(manifestPath(home)), true);
});

test("failure after first cache relocation reports retained and unmoved bytes", (t) => {
  const { home, dest, source, cache, flags } = cacheFixture(t);
  const nestedSource = path.join(dest, "nested", "second.py");
  fs.mkdirSync(path.dirname(nestedSource));
  fs.copyFileSync(source, nestedSource);
  const manifest = JSON.parse(fs.readFileSync(manifestPath(home)));
  manifest.files.push({ path: "nested/second.py", sha256: sha256(nestedSource) });
  fs.writeFileSync(manifestPath(home), JSON.stringify(manifest));
  const nestedCache = path.join(dest, "nested", "__pycache__", "second.cpython-314.pyc");
  fs.mkdirSync(path.dirname(nestedCache));
  fs.copyFileSync(cache, nestedCache);
  const bytes = fs.readFileSync(cache);
  const rename = fs.renameSync;
  let moved = 0;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (path.basename(from) === "__pycache__" && ++moved === 2) throw new Error("injected second relocation failure");
    return rename(from, to);
  });
  let failure;
  assert.throws(() => installLitHermes(flags), (error) => { failure = error; return error.exitCode === 5; });
  const backup = failure.message.split("Retained Python cache backup: ")[1];
  assert.ok(backup);
  assert.deepEqual(fs.readFileSync(path.join(backup, path.relative(dest, cache))), bytes);
  assert.deepEqual(fs.readFileSync(nestedCache), bytes);
  assert.equal(fs.existsSync(source), true);
  assert.equal(fs.existsSync(nestedSource), true);
});

test("payload copy failure retains cache backup and includes its path", (t) => {
  const { dest, cache, flags } = cacheFixture(t);
  const bytes = fs.readFileSync(cache);
  t.mock.method(fs, "copyFileSync", () => { throw new Error("injected payload copy failure"); });
  let failure;
  assert.throws(() => installLitHermes(flags), (error) => { failure = error; return /injected payload copy failure/.test(error.message); });
  const backup = failure.message.split("Retained Python cache backup: ")[1];
  assert.ok(backup);
  assert.deepEqual(fs.readFileSync(path.join(backup, path.relative(dest, cache))), bytes);
});

test("uninstall rejects an embedded NUL before removing any receipt entry", (t) => {
  const { home, owned, flags } = fixture(t);
  const manifest = JSON.parse(fs.readFileSync(manifestPath(home)));
  manifest.files.unshift({ path: "invalid\0path", sha256: sha256(owned) });
  fs.writeFileSync(manifestPath(home), JSON.stringify(manifest));
  assert.throws(() => uninstallLitHermes(flags), (error) => error.exitCode === 5);
  assert.equal(fs.readFileSync(owned, "utf8"), "prior managed payload\n");
});

for (const mutation of ["nested symlink", "existing cache target"]) {
  test(`cache relocation refuses ${mutation} in its backup tree`, (t) => {
    const { home, cache, flags } = cacheFixture(t, true);
    const outside = path.join(home, "outside-tree");
    fs.mkdirSync(outside);
    const mkdir = fs.mkdirSync;
    t.mock.method(fs, "mkdirSync", (dir, options) => {
      if (path.basename(dir) === "nested" && dir.includes("retained-python-cache-")) {
        if (mutation === "nested symlink") return fs.symlinkSync(outside, dir);
        mkdir(dir, options);
        return mkdir(path.join(dir, "__pycache__"));
      }
      return mkdir(dir, options);
    });
    assert.throws(() => installLitHermes(flags), (error) => error.exitCode === 5 && /Retained Python cache backup:/.test(error.message));
    assert.equal(fs.existsSync(cache), true);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
}

test("cache relocation refuses a symlinked backup parent", (t) => {
  const { home, cache, flags } = cacheFixture(t);
  const state = path.join(home, "lithermes");
  const outside = path.join(home, "outside-state");
  fs.renameSync(state, outside);
  fs.symlinkSync(outside, state);
  assert.throws(() => installLitHermes(flags), (error) => error.exitCode === 5 && /Refusing unsafe or replaced LitHermes state directory/.test(error.message));
  assert.equal(fs.existsSync(cache), true);
  assert.deepEqual(fs.readdirSync(outside), ["install-manifest.json"]);
});
