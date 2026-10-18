const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "lithermes.js");

function tempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-update-doctor-"));
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  fs.mkdirSync(path.join(home, "lithermes"), { recursive: true });
  return home;
}

function writeState(home, name, value) {
  fs.writeFileSync(path.join(home, "lithermes", name), JSON.stringify(value));
}

function manifest(home, extra = {}) {
  writeState(home, "install-manifest.json", { version: "2.0.1", distribution: "npm", installedAt: "2026-10-17T10:00:00.000Z", ...extra });
}

function lines(home, options = {}) {
  const { autoUpdateDoctorLines } = require("../src/lib/updateDoctor");
  return autoUpdateDoctorLines(home, { env: {}, now: Date.parse("2026-10-17T12:00:00Z"), ...options });
}

test("doctor names the version an automatic update installed and from what", (t) => {
  const home = tempHome(t);
  manifest(home);
  writeState(home, "auto-update-receipt.json", { status: "updated", currentVersion: "2.0.0", targetVersion: "2.0.1", completedAt: "2026-10-17T10:00:01.000Z", rollback: { status: "not-needed" } });
  const out = lines(home);
  assert.match(out[0], /^update: installed 2\.0\.1 at 2026-10-17 10:00 UTC by an automatic update from 2\.0\.0$/);
  assert.ok(out.some((line) => /cannot see which version a running Hermes loaded/.test(line)), out.join("\n"));
});

test("a gateway that started before the install is told to restart", (t) => {
  const home = tempHome(t);
  manifest(home);
  fs.writeFileSync(path.join(home, "gateway.pid"), JSON.stringify({ pid: 4242, kind: "hermes-gateway" }));
  const before = lines(home, { isAlive: () => true, processStartedAt: () => Date.parse("2026-10-17T09:00:00Z") });
  assert.ok(before.includes("update: gateway pid 4242 started before 2.0.1 was installed and still runs the older plugin; restart it: hermes gateway restart"), before.join("\n"));
  const after = lines(home, { isAlive: () => true, processStartedAt: () => Date.parse("2026-10-17T11:00:00Z") });
  assert.ok(after.includes("update: gateway pid 4242 started after the install, so it loaded 2.0.1"), after.join("\n"));
  const gone = lines(home, { isAlive: () => false, processStartedAt: () => null });
  assert.ok(!gone.some((line) => line.includes("gateway pid")), gone.join("\n"));
});

test("each recorded cause comes with its own remedy", (t) => {
  const cases = [
    [{ status: "failed", reason: "update-check-failed" }, /could not reach the npm registry/, /network or proxy/],
    [{ status: "failed", reason: "automatic-install-failed", failedReason: "automatic-install-failed", failedAt: "2026-10-17T11:00:00Z" }, /npm could not install 2\.0\.2/, /npx --yes --package @litfamily\/lithermes@2\.0\.2 -- lithermes install --yes --no-hud/],
    [{ status: "failed", reason: "automatic-install-timeout", failedReason: "automatic-install-timeout", failedAt: "2026-10-17T11:00:00Z" }, /ran past 90 seconds/, /install it by hand/],
    [{ status: "skipped", reason: "backoff-after-failure", failedReason: "automatic-install-failed", failedAt: "2026-10-17T11:00:00Z" }, /waits until 2026-10-18 11:00 UTC/, /install it by hand/],
  ];
  for (const [attempt, cause, remedy] of cases) {
    const home = tempHome(t);
    manifest(home);
    writeState(home, "auto-update-attempt.json", { schemaVersion: 1, at: "2026-10-17T11:00:00Z", currentVersion: "2.0.1", latestVersion: "2.0.2", ...attempt });
    const out = lines(home).join("\n");
    assert.match(out, cause, out);
    assert.match(out, remedy, out);
  }
});

test("rollback, opt-out and a catalog copy each explain themselves", (t) => {
  const rolled = tempHome(t);
  manifest(rolled);
  writeState(rolled, "auto-update-receipt.json", { status: "failed", reason: "post-install doctor did not prove a healthy payload", doctor: "failed", currentVersion: "2.0.1", targetVersion: "2.0.2", completedAt: "2026-10-17T11:00:00.000Z", rollback: { status: "restored" } });
  assert.match(lines(rolled).join("\n"), /2\.0\.2 failed its check after install and was rolled back; you are still on 2\.0\.1/);
  writeState(rolled, "auto-update-attempt.json", { status: "failed", reason: "automatic-install-failed", latestVersion: "2.0.2", at: "2026-10-17T11:00:01Z" });
  assert.equal(lines(rolled).filter((line) => line.startsWith("update: remedy:")).length, 1);

  const optedOut = tempHome(t);
  manifest(optedOut);
  assert.ok(lines(optedOut, { env: { LITHERMES_NO_AUTO_UPDATE: "1" } }).includes("update: automatic updates are off (LITHERMES_NO_AUTO_UPDATE is set); install new versions yourself"));

  const catalog = tempHome(t);
  manifest(catalog, { distribution: "catalog" });
  assert.match(lines(catalog).join("\n"), /not installed by the npm installer, so it never updates itself/);
});

test("lithermes doctor prints the restart line for a live gateway that predates the install", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-update-doctor-cli-"));
  t.after(() => fs.rmSync(home, { force: true, recursive: true }));
  const gateway = spawn("/bin/sleep", ["60"], { stdio: "ignore" });
  t.after(() => gateway.kill("SIGKILL"));
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const env = { ...process.env };
  for (const key of ["LITHERMES_NO_AUTO_UPDATE", "NO_UPDATE_NOTIFIER", "LITHERMES_NO_UPDATE_CHECK", "CI"]) delete env[key];
  const install = spawnSync(process.execPath, [bin, "install", "--yes", "--offline", "--no-hud", "--hermes-home", home], { cwd: root, encoding: "utf8", env });
  assert.equal(install.status, 0, install.stdout + install.stderr);
  fs.writeFileSync(path.join(home, "gateway.pid"), JSON.stringify({ pid: gateway.pid, kind: "hermes-gateway" }));
  const doctor = spawnSync(process.execPath, [bin, "doctor", "--offline", "--no-auto-update", "--hermes-home", home], { cwd: root, encoding: "utf8", env });
  const version = require("../package.json").version;
  assert.match(doctor.stdout, new RegExp(`^update: gateway pid ${gateway.pid} started before ${version.replaceAll(".", "\\.")} was installed and still runs the older plugin; restart it: hermes gateway restart$`, "m"), doctor.stdout + doctor.stderr);
});
