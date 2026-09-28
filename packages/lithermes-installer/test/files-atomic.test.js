const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

// Not yet exported — will exist after GREEN step
let writeFileAtomic;
const tempDirs = [];
try {
  ({ writeFileAtomic } = require("../src/lib/files"));
} catch {
  writeFileAtomic = null;
}

function makeTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-atomic-test-"));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { force: true, recursive: true });
});

test("writeFileAtomic is exported from src/lib/files", () => {
  assert.equal(typeof writeFileAtomic, "function", "writeFileAtomic must be exported from src/lib/files");
});

test("writeFileAtomic writes exact content to the target file", () => {
  const dir = makeTmp();
  const target = path.join(dir, "out.json");
  const content = JSON.stringify({ hello: "world" }, null, 2);
  writeFileAtomic(target, content);
  assert.equal(fs.readFileSync(target, "utf8"), content);
});

test("writeFileAtomic leaves no .tmp residue after success", () => {
  const dir = makeTmp();
  const target = path.join(dir, "out.json");
  writeFileAtomic(target, "data");
  const leftover = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftover, [], `Expected no .tmp files but found: ${leftover.join(", ")}`);
});

test("writeFileAtomic replaces an existing file atomically (new content visible)", () => {
  const dir = makeTmp();
  const target = path.join(dir, "out.txt");
  fs.writeFileSync(target, "old-content", "utf8");
  writeFileAtomic(target, "new-content");
  // After the call the file must contain exactly the new content
  assert.equal(fs.readFileSync(target, "utf8"), "new-content");
});

test("writeFileAtomic works for utf8 string data", () => {
  const dir = makeTmp();
  const target = path.join(dir, "config.yaml");
  const content = "plugins:\n  enabled:\n    - lithermes\n";
  writeFileAtomic(target, content, "utf8");
  assert.equal(fs.readFileSync(target, "utf8"), content);
});

test("writeFileAtomic removes its temporary sibling when rename is interrupted", () => {
  // Given: a directory target that makes the final rename fail
  const dir = makeTmp();
  const target = path.join(dir, "occupied");
  fs.mkdirSync(target);
  // When: the atomic replacement is interrupted at rename
  assert.throws(() => writeFileAtomic(target, "new-content"));
  // Then: the original target survives and no sensitive temporary file remains
  assert.equal(fs.statSync(target).isDirectory(), true);
  assert.equal(fs.readdirSync(dir).some((name) => name.startsWith(".occupied.") && name.endsWith(".tmp")), false);
});

test("writeFileAtomic starts temporary files at 0600 and cleans pre-rename write failure", () => {
  // Given: a write failure after the secure temporary sibling is opened
  const dir = makeTmp();
  const target = path.join(dir, "secret.yaml");
  const original = fs.writeSync;
  let observedMode = null;
  fs.writeSync = (fd, ...args) => {
    observedMode = fs.fstatSync(fd).mode & 0o777;
    throw new Error("forced write failure");
  };
  // When: the pre-rename write fails
  try {
    assert.throws(() => writeFileAtomic(target, "secret"), /forced write failure/);
  } finally {
    fs.writeSync = original;
  }
  // Then: the temporary was private and neither target nor residue remains
  assert.equal(observedMode, 0o600);
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.readdirSync(dir).some((name) => name.startsWith(".secret.yaml.") && name.endsWith(".tmp")), false);
});

test("writeFileAtomic ignores a preplanted predictable temp symlink", () => {
  // Given: an attacker-controlled legacy <target>.tmp symlink to a victim
  const dir = makeTmp();
  const target = path.join(dir, "config.yaml");
  const victim = path.join(dir, "victim.txt");
  const planted = `${target}.tmp`;
  fs.writeFileSync(victim, "do-not-overwrite", { mode: 0o600 });
  fs.symlinkSync(victim, planted);
  // When: the atomic writer replaces the intended target
  writeFileAtomic(target, "safe-config", "utf8");
  // Then: unique exclusive temp creation never follows or removes the planted link
  assert.equal(fs.readFileSync(target, "utf8"), "safe-config");
  assert.equal(fs.readFileSync(victim, "utf8"), "do-not-overwrite");
  assert.equal(fs.lstatSync(planted).isSymbolicLink(), true);
});
