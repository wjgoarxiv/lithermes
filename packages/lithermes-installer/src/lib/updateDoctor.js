const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PACKAGE_NAME = "@litfamily/lithermes";
const BACKOFF_MS = 24 * 60 * 60 * 1000;
const OPT_OUT_NAMES = ["LITHERMES_NO_AUTO_UPDATE", "NO_UPDATE_NOTIFIER", "LITHERMES_NO_UPDATE_CHECK", "CI"];

// Doctor only reads these records; a link or a non-file is treated as absent.
function readRecord(file) {
  try {
    if (!fs.lstatSync(file).isFile()) return null;
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function when(value) {
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC` : "an unknown time";
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function processStartedAt(pid) {
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, timeout: 5000 });
  const ms = result.status === 0 ? Date.parse(result.stdout.trim()) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function byHand(version) {
  return `install it by hand: npx --yes --package ${PACKAGE_NAME}@${version} -- lithermes install --yes --no-hud`;
}

function attemptLines(attempt) {
  if (!attempt) return [];
  const target = attempt.latestVersion || "the latest release";
  const at = when(attempt.at);
  switch (attempt.reason) {
    case "current":
      return [`update: last check ${at}: up to date`];
    case "updated":
      return [`update: last check ${at}: updated ${attempt.currentVersion} to ${target}`];
    case "update-check-failed":
      return [`update: last check ${at}: could not reach the npm registry`, "update: remedy: check the network or proxy; the next Hermes CLI session checks again"];
    case "automatic-install-failed":
      return [`update: last check ${at}: npm could not install ${target}`, `update: remedy: check npm's registry and proxy settings, or ${byHand(target)}`];
    case "automatic-install-timeout":
      return [`update: last check ${at}: installing ${target} ran past 90 seconds and was stopped`, `update: remedy: ${byHand(target)}`];
    case "backoff-after-failure":
      return [
        `update: last check ${at}: ${target} failed to install (${attempt.failedReason}), so the next try waits until ${when(Date.parse(attempt.failedAt) + BACKOFF_MS)}`,
        `update: remedy: fix the cause above, or ${byHand(target)}`,
      ];
    default:
      return attempt.status === "failed"
        ? [`update: last check ${at}: installing ${target} did not finish cleanly (${attempt.reason}); the old version stayed`, `update: remedy: ${byHand(target)}, then run lithermes doctor`]
        : [];
  }
}

function receiptLines(receipt, installed) {
  if (!receipt || receipt.status !== "failed") return [];
  const target = receipt.targetVersion || "the new version";
  if (receipt.state === "unknown" || receipt.rollback?.status === "failed") {
    return [`update: the automatic update to ${target} could not restore the old files`, "update: remedy: keep the backup under lithermes/auto-update/ and get doctor --offline to pass before you start Hermes"];
  }
  const cause = receipt.doctor === "failed"
    ? "failed its check after install"
    : /timed out|interrupted/.test(String(receipt.reason)) ? "took longer than 30 seconds to install" : "did not install";
  return [`update: ${target} ${cause} and was rolled back; you are still on ${installed} (${when(receipt.completedAt)})`, `update: remedy: run npx --yes --package ${PACKAGE_NAME}@${target} -- lithermes install --yes --no-hud yourself to see the error`];
}

function gatewayLines(hermesHome, installed, installedAtMs, probes) {
  const record = readRecord(path.join(hermesHome, "gateway.pid"));
  const pid = Number(record?.pid);
  if (!record || record.kind !== "hermes-gateway" || !Number.isInteger(pid) || pid <= 0 || !probes.isAlive(pid)) return [];
  const started = probes.processStartedAt(pid);
  if (started === null || !Number.isFinite(installedAtMs)) return [`update: gateway pid ${pid} is running; doctor could not tell whether it started before ${installed} was installed`];
  return started < installedAtMs
    ? [`update: gateway pid ${pid} started before ${installed} was installed and still runs the older plugin; restart it: hermes gateway restart`]
    : [`update: gateway pid ${pid} started after the install, so it loaded ${installed}`];
}

function autoUpdateDoctorLines(hermesHome, options = {}) {
  const env = options.env || process.env;
  const probes = { isAlive: options.isAlive || isAlive, processStartedAt: options.processStartedAt || processStartedAt };
  const state = path.join(hermesHome, "lithermes");
  const manifest = readRecord(path.join(state, "install-manifest.json"));
  if (!manifest?.version) return ["update: no install record; run lithermes install"];
  const installed = manifest.version;
  const receipt = readRecord(path.join(state, "auto-update-receipt.json"));
  const viaUpdate = receipt?.status === "updated" && receipt.targetVersion === installed;
  const lines = [`update: installed ${installed} at ${when(manifest.installedAt)} by ${viaUpdate ? `an automatic update from ${receipt.currentVersion}` : "the installer"}`];
  lines.push(...gatewayLines(hermesHome, installed, Date.parse(manifest.installedAt), probes));
  lines.push(`update: a Hermes CLI, TUI or gateway started before then keeps the older plugin until restarted; doctor cannot see which version a running Hermes loaded`);
  const optOut = OPT_OUT_NAMES.find((name) => Object.prototype.hasOwnProperty.call(env, name));
  if (manifest.distribution !== "npm") {
    lines.push("update: this copy was not installed by the npm installer, so it never updates itself; run lithermes install once to turn updates on");
  } else if (optOut) {
    lines.push(`update: automatic updates are off (${optOut} is set); install new versions yourself`);
  } else {
    lines.push("update: only the first message of a classic hermes CLI session, or lithermes install/check/doctor in a terminal, installs updates; the TUI and gateways never do");
  }
  const attempt = readRecord(path.join(state, "auto-update-attempt.json"));
  const rolledBack = receiptLines(receipt, installed);
  // A rolled-back transaction also makes the bridge exit non-zero; the receipt already names that cause.
  const sameFailure = rolledBack.length && attempt?.reason === "automatic-install-failed" && attempt.latestVersion === receipt.targetVersion;
  lines.push(...rolledBack, ...(sameFailure ? [] : attemptLines(attempt)));
  return lines;
}

module.exports = { autoUpdateDoctorLines };
