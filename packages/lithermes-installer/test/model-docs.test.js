const { readDocumentation } = require("./documentation-reader");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

test("package and plugin docs describe exact Hermes model capability boundaries", () => {
  // Given: every shipped user-facing guide and the release checklist
  const docs = [
    readDocumentation(path.join(packageRoot, "README.md")),
    readDocumentation(path.join(packageRoot, "README_Ko-KR.md")),
    read(path.join(packageRoot, "assets", "lithermes-plugin", "README.md")),
    read(path.join(repoRoot, "RELEASE_CHECKLIST.md")),
  ].join("\n");
  // When/Then: the operational model/runtime/no-write contract is searched
  for (const required of [
    "gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "low", "medium", "xhigh", "max", "ultra",
    "global child route", "no per-task model override", "no per-subagent model override",
    "named reviewer route", "litwork-reviewer", "TUI", "execution receipt",
    "delegation.base_url", "delegation.api_mode", "managed child route remains unapplied",
    "OpenAI OAuth", "Responses runtime", "max_concurrent_children", "20",
    "ratio-only", "650K", "372000", "334800", "hermes model", "credential-risk", "no backup",
    "ordinary reinstall", "reconfigure-model", "temperature", "top_p", "top_logprobs", "sampling",
  ]) {
    const escaped = required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(docs, new RegExp(escaped, "i"), `model docs missing ${required}`);
  }
  assert.doesNotMatch(docs, /global child Luna `xhigh` route conflicts with the lead SOL/i);
  assert.doesNotMatch(docs, /Luna `xhigh`는 lead SOL `xhigh`와 충돌/);
  assert.match(docs, /gpt-5\.6-luna` `xhigh` route is forbidden/i);
  assert.match(docs, /gpt-6-luna` accepts `xhigh`/i);
});
