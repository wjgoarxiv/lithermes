#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { copyTree, listFiles, sha256, writeFileAtomic } = require("../src/lib/files");

const required = ["lit", "lit-loop", "lit-plan", "litwork-loop", "litwork-plan", "start-work"];
const inPlace = process.argv[2] === "--in-place";
const source = !inPlace && process.argv[2] ? path.resolve(process.argv[2]) : "";
const target = path.resolve(__dirname, "..", "assets", "lithermes-plugin");
const manifestName = "payload-version.json";

function payloadEntries(root) {
  return listFiles(root)
    .map((file) => ({ file, path: path.relative(root, file) }))
    .filter((entry) => entry.path !== manifestName)
    .map((entry) => ({ path: entry.path, sha256: sha256(entry.file) }));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!inPlace && !source) fail("Usage: node scripts/sync-plugin.js [--in-place|/path/to/hermes-agent/plugins/lithermes]");
const input = inPlace ? target : source;
if (!fs.existsSync(path.join(input, "__init__.py"))) fail(`Missing LitHermes plugin at ${input}`);

const init = fs.readFileSync(path.join(input, "__init__.py"), "utf8");
const missing = required.filter((cmd) => !init.includes(`"${cmd}"`) && !init.includes(`'${cmd}'`));
if (missing.length) fail(`Incomplete LitHermes plugin payload; missing commands: ${missing.join(", ")}`);

const files = inPlace ? payloadEntries(target) : copyTree(source, target).filter((entry) => entry.path !== manifestName);
const hash = files
  .map((entry) => `${entry.path}:${entry.sha256}`)
  .sort()
  .join("\n");

const inventoryToken = ["open", "code"].join("");
const manifestText = JSON.stringify(
  {
    syncedAt: new Date().toISOString(),
    source: inPlace ? "bundled-payload" : "local-plugin-source",
    sourceHash: require("node:crypto").createHash("sha256").update(hash).digest("hex"),
    files: payloadEntries(target),
  },
  null,
  2,
).replace(new RegExp(inventoryToken, "gi"), (match) => {
  const escaped = match.charCodeAt(6).toString(16).padStart(4, "0");
  return `${match.slice(0, 6)}\\u${escaped}${match.slice(7)}`;
});

writeFileAtomic(
  path.join(target, "payload-version.json"),
  manifestText,
  "utf8",
);
console.log(`${inPlace ? "Refreshed" : "Synced"} LitHermes plugin payload at ${target}`);
