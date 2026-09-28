const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

// Operational contracts may live in a guide only when the entry page links to it.
function readDocumentation(file) {
  const text = fs.readFileSync(file, "utf8");
  const directory = path.dirname(file);
  const name = path.basename(file);
  if (![repoRoot, packageRoot].includes(directory) || !["README.md", "README_Ko-KR.md"].includes(name)) return text;
  const guide = name === "README.md" ? "docs/guide.md" : "docs/guide.ko.md";
  const prefix = directory === repoRoot ? "./" : "https://github.com/wjgoarxiv/lithermes/blob/main/";
  assert.ok(text.includes(`](${prefix}${guide})`), `${file} must link its operating guide`);
  return `${text}\n${fs.readFileSync(path.join(repoRoot, guide), "utf8")}`;
}

module.exports = { readDocumentation };
