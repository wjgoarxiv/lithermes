const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(packageRoot, "assets", "lithermes-plugin");
const lspRoot = path.join(pluginRoot, "skills", "lsp");
const setupRoot = path.join(pluginRoot, "skills", "lsp-setup");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

// Hermes Agent has no lsp.* agent tools: diagnostics arrive automatically after
// file writes, and server state is managed with `hermes lsp ...`. The docs must
// describe that surface — never the lsp.* tool calls of a different host.
test("lsp skill does not document nonexistent lsp.* agent tools", () => {
  const doc = read(path.join(lspRoot, "SKILL.md"));
  const toolListLines = doc.split("\n").filter((line) => line.startsWith("- `lsp."));
  assert.deepEqual(toolListLines, [], "lsp/SKILL.md must not list lsp.* tools as callable");
  assert.ok(
    doc.includes("those names do not exist"),
    "lsp/SKILL.md must say the lsp.* names do not exist on this host",
  );
});

test("lsp skill describes the real Hermes surface", () => {
  const doc = read(path.join(lspRoot, "SKILL.md"));
  assert.ok(doc.includes("hermes lsp"), "lsp/SKILL.md must name the hermes lsp CLI");
  for (const sub of ["status", "install"]) {
    assert.ok(doc.includes(sub), `lsp/SKILL.md must mention hermes lsp ${sub}`);
  }
});

test("lsp skill Config section targets config.yaml lsp.servers", () => {
  const doc = read(path.join(lspRoot, "SKILL.md"));
  assert.ok(doc.includes("lsp.servers"), "lsp/SKILL.md Config must use lsp.servers");
  assert.ok(doc.includes("config.yaml"), "lsp/SKILL.md Config must name config.yaml");
  assert.ok(!doc.includes(".lithermes/lsp.json"), "lsp/SKILL.md must not point at .lithermes/lsp.json");
});

test("lsp-setup Configure section teaches config.yaml lsp.servers in YAML", () => {
  const doc = read(path.join(setupRoot, "SKILL.md"));
  const configure = doc.slice(doc.indexOf("### 3. Configure"));
  assert.ok(configure.includes("lsp.servers"), "lsp-setup Configure must use lsp.servers");
  assert.ok(configure.includes("config.yaml"), "lsp-setup Configure must name config.yaml");
  assert.ok(configure.includes("```yaml"), "lsp-setup Configure snippet must be YAML");
  assert.ok(
    configure.includes("Hermes never reads") && configure.includes(".lithermes/lsp.json"),
    "lsp-setup must label .lithermes/lsp.json as a file Hermes never reads",
  );
  assert.ok(
    !configure.includes("project copy lives at"),
    "lsp-setup must not present .lithermes/lsp.json as the file Hermes reads",
  );
  assert.ok(
    !configure.includes("shipped default declares"),
    "lsp-setup must not claim a shipped .lithermes/lsp.json default",
  );
});

test("every language reference configures via lsp.servers in YAML", () => {
  const references = path.join(setupRoot, "references");
  const languages = fs.readdirSync(references).filter((entry) => {
    return fs.statSync(path.join(references, entry)).isDirectory();
  });
  assert.ok(languages.length >= 20, `expected 20 language references, saw ${languages.length}`);
  for (const language of languages) {
    const doc = read(path.join(references, language, "README.md"));
    assert.ok(doc.includes("lsp.servers"), `${language}/README.md must use lsp.servers`);
    assert.ok(!doc.includes('"lsp": {'), `${language}/README.md must not carry the JSON lsp map`);
    assert.ok(!doc.includes("lsp.<language>"), `${language}/README.md must not use the lsp.<language> key path`);
  }
});

test("python reference names the pyright built-in and keeps basedpyright custom", () => {
  const doc = read(path.join(setupRoot, "references", "python", "README.md"));
  assert.ok(doc.includes("pyright"), "python/README.md must name the pyright built-in");
});

test("typescript install hints stay on the v6 line", () => {
  const doc = read(path.join(setupRoot, "references", "typescript", "README.md"));
  assert.ok(!/typescript-language-server typescript["'\s]/.test(doc), "typescript/README.md must pin typescript@6");
  assert.ok(doc.includes("typescript@6"), "typescript/README.md must pin typescript@6");
  const table = read(path.join(setupRoot, "scripts", "lsp-server-table.ts"));
  assert.ok(table.includes("typescript@6"), "lsp-server-table.ts installHint must pin typescript@6");
});

test("helper scripts label the JSON file as LitHermes-only input", () => {
  for (const script of ["detect-lsp.ts", "verify-lsp.ts", "lsp-server-table.ts"]) {
    const doc = read(path.join(setupRoot, "scripts", script));
    assert.ok(
      doc.includes("LitHermes-only"),
      `${script} must label .lithermes/lsp.json as LitHermes-only helper input`,
    );
  }
});
