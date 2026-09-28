const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(packageRoot, "assets", "lithermes-plugin");

test("removed skill review has no installer route or shipped bridge", () => {
  const cli = fs.readFileSync(path.join(packageRoot, "src", "cli.js"), "utf8");
  const payload = fs.readFileSync(path.join(packageRoot, "src", "lib", "skillPayload.js"), "utf8");

  assert.doesNotMatch(cli, /skillLoop|skill-loop/);
  assert.doesNotMatch(payload, /skill-observer/);
  assert.equal(fs.existsSync(path.join(packageRoot, "src", "lib", "skillLoop.js")), false);
  assert.equal(fs.existsSync(path.join(pluginRoot, "skill_loop.py")), false);
  assert.equal(fs.existsSync(path.join(pluginRoot, "skill_observer.py")), false);
  assert.equal(fs.existsSync(path.join(pluginRoot, "skills", "skill-observer")), false);

  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-no-review-route-"));
  try {
    const result = spawnSync(process.execPath, [
      path.join(packageRoot, "bin", "lithermes.js"),
      "skill-loop",
      "--hermes-home",
      hermesHome,
      "--offline",
      "--no-auto-update",
    ], {
      encoding: "utf8",
      env: { ...process.env, HOME: hermesHome, HERMES_HOME: hermesHome, LITHERMES_NO_AUTO_UPDATE: "1" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /lithermes commands:/);
    assert.doesNotMatch(result.stdout, /skill-loop/);
  } finally {
    fs.rmSync(hermesHome, { recursive: true, force: true });
  }
});
