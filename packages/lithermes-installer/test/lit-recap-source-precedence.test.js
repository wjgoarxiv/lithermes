const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const skillPath = path.resolve(
  __dirname,
  "..",
  "assets",
  "lithermes-plugin",
  "skills",
  "lit-recap",
  "SKILL.md",
);

// The runtime pre-renders durable `pass` criteria into context already labelled as
// completed work, so a recap that merely "combines" the two sources will present a
// stale ledger entry as current. Precedence has to be stated, not implied.
test("lit-recap declares which source wins when the ledger and the session disagree", () => {
  const skill = fs.readFileSync(skillPath, "utf8");
  assert.match(skill, /precedence|takes? priority|outranks?/i);
  assert.match(skill, /current session|this session|live session/i);
});

test("lit-recap requires the conflict to be surfaced rather than silently resolved", () => {
  const skill = fs.readFileSync(skillPath, "utf8");
  assert.match(skill, /stale/i);
  assert.match(skill, /\b(say so|flag|surface|report)\b/i);
});
