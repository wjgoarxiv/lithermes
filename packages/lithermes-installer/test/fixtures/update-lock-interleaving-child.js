const fs = require("node:fs");
const path = require("node:path");

const [role, home, gatePath, nowArgument] = process.argv.slice(2);
const cachePath = path.join(home, "lithermes", "update-check.json");
const attemptLockPath = path.join(home, "lithermes", "update-check.lock");
const originalUnlinkSync = fs.unlinkSync;

function waitForGate() {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(gatePath)) Atomics.wait(sleeper, 0, 0, 10);
}

if (role === "observer-a") {
  let paused = false;
  fs.unlinkSync = (target) => {
    if (!paused && path.resolve(target) === path.resolve(attemptLockPath)) {
      paused = true;
      process.send({ phase: "a-observed-stale" });
      waitForGate();
    }
    return originalUnlinkSync(target);
  };
}

const notifier = require("../../src/lib/updateNotifier");
const nowMs = Number(nowArgument);

const options = { now: () => nowMs };
if (role === "mutation-owner-a") {
  options.writeUpdateCacheFn = (target, record) => {
    process.send({ phase: "a-created-attempt-lock" });
    waitForGate();
    notifier.writeUpdateCache(target, record);
  };
}
if (role === "replacement-b") {
  options.writeUpdateCacheFn = (target, record) => {
    process.send({ phase: "b-created-owner" });
    waitForGate();
    notifier.writeUpdateCache(target, record);
  };
}

const result = notifier.reserveUpdateAttempt(cachePath, options);
process.send({ phase: "result", role, result });
