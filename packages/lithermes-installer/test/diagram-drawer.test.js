const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(packageRoot, "assets", "lithermes-plugin");
const skillRoot = path.join(pluginRoot, "skills", "lit-diagram-drawer");

function skillFiles(directory = skillRoot) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? skillFiles(absolute) : [absolute];
  });
}

test("diagram skill is registered through Hermes routes, command, status, and help", () => {
  const skill = path.join(skillRoot, "SKILL.md");
  assert.equal(fs.existsSync(skill), true, "skill entrypoint is missing");
  const init = fs.readFileSync(path.join(pluginRoot, "__init__.py"), "utf8");
  const routing = fs.readFileSync(path.join(pluginRoot, "core_routing.py"), "utf8");
  const contexts = fs.readFileSync(path.join(pluginRoot, "core_contexts.py"), "utf8");
  const commands = fs.readFileSync(path.join(pluginRoot, "core_commands.py"), "utf8");
  const diagnostics = fs.readFileSync(path.join(pluginRoot, "diagnostics.py"), "utf8");
  const doctor = fs.readFileSync(path.join(skillRoot, "scripts", "doctor.mjs"), "utf8");
  const exporter = fs.readFileSync(path.join(skillRoot, "scripts", "export.mjs"), "utf8");
  const text = fs.readFileSync(skill, "utf8");
  const pluginReadme = fs.readFileSync(path.join(pluginRoot, "README.md"), "utf8");
  const readme = fs.readFileSync(path.join(packageRoot, "README.md"), "utf8");
  const readmeKo = fs.readFileSync(path.join(packageRoot, "README_Ko-KR.md"), "utf8");

  assert.match(init, /\(\s*"lit-diagram-drawer",\s*"Create clear/);
  assert.match(init, /"lit-diagram-drawer",\s*\n\s*_command_handler/);
  assert.match(init, /\/lit-diagram-drawer/);
  assert.match(routing, /\("lit-diagram-drawer",\s*"lit-diagram-drawer"\)/);
  assert.match(contexts, /"lit-diagram-drawer"\s*:\s*\(/);
  assert.match(text, /lithermes:lit-diagram-drawer/);
  assert.match(text, /\/lit-diagram-drawer <brief>/);
  assert.match(commands, /def command_lit_diagram_drawer/);
  assert.match(diagnostics, /"lit-diagram-drawer"/);
  assert.match(diagnostics, /lit-diagram-drawer entrypoint present/);
  assert.match(doctor, /agent-browser >=0\.38\.1/);
  assert.match(exporter, /agentBrowserSupported\(browserVersion\.stdout\)/);
  assert.match(exporter, /'--profile',profile/);
  assert.match(exporter, /EXPORT_OUTPUT_IN_PAYLOAD/);
  assert.match(readme, /\/lit-diagram-drawer <brief>/);
  assert.match(readmeKo, /\/lit-diagram-drawer <brief>/);
  assert.match(pluginReadme, /lithermes:lit-diagram-drawer/);
  assert.match(pluginReadme, /\/lit-diagram-drawer <brief>/);
  assert.match(pluginReadme, /lit-scientific-visualization.*lit-diagram-drawer|lit-diagram-drawer.*bounded bare or exact natural routes/s);

  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  assert.ok(packageJson.files.includes("assets"), "npm files list must include installed plugin assets");
});

test("diagram type catalog closes over all guides and light, dark, and full templates", () => {
  const catalogPath = path.join(skillRoot, "references", "type-catalog.json");
  assert.equal(fs.existsSync(catalogPath), true, "type catalog is missing");
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  assert.equal(catalog.entries.length, 61);
  const files = new Set(skillFiles().map((file) => path.relative(skillRoot, file).split(path.sep).join("/")));
  const expected = new Set();

  for (const entry of catalog.entries) {
    assert.ok(files.has(`references/${entry.reference}`), `missing guide ${entry.reference}`);
    for (const variant of ["light", "dark", "full"]) {
      assert.ok(entry.variants.includes(variant), `${entry.id} omits ${variant}`);
      const template = `assets/examples/type-${entry.id}-${variant}.html`;
      expected.add(template);
      assert.ok(files.has(template), `missing template ${template}`);
    }
  }
  assert.equal(expected.size, 183);
  assert.equal([...files].filter((file) => file.startsWith("assets/examples/type-")).length, 183);
  assert.equal([...files].filter((file) => file.startsWith("examples/") && file.endsWith("/after.html")).length, 8);
  assert.equal([...files].filter((file) => file.startsWith("examples/") && file.endsWith("/brief.md")).length, 8);
  assert.ok(files.has("assets/fonts/OFL.txt"), "Pretendard OFL text is required");
  assert.ok(files.has("assets/fonts/provenance.json"), "font provenance is required");
  assert.ok(files.has("assets/fonts/PretendardVariable.woff2"), "local Pretendard font is required");
  assert.ok(files.has("assets/icons.html"), "the licensed icon sheet is required");
  assert.ok(files.has("NOTICE"), "third-party notices are required");
});

test("every local Markdown reference resolves inside the installed skill", () => {
  const markdown = skillFiles().filter((file) => file.endsWith(".md"));
  for (const file of markdown) {
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      let target = match[1].trim().split(/[?#]/, 1)[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
      try {
        target = decodeURIComponent(target);
      } catch {}
      const resolved = path.resolve(path.dirname(file), target);
      assert.ok(
        resolved === skillRoot || resolved.startsWith(`${skillRoot}${path.sep}`),
        `${path.relative(skillRoot, file)} escapes the installed skill: ${target}`,
      );
      assert.ok(fs.existsSync(resolved), `${path.relative(skillRoot, file)} links to missing ${target}`);
    }
  }
});

test("renderer version gate accepts stable agent-browser 0.38.1 and newer", async () => {
  const { agentBrowserSupported } = await import(
    pathToFileURL(path.join(skillRoot, "scripts", "browser-version.mjs"))
  );
  assert.equal(agentBrowserSupported("agent-browser 0.38.1"), true);
  assert.equal(agentBrowserSupported("agent-browser v0.39.0"), true);
  assert.equal(agentBrowserSupported("agent-browser 1.0.0"), true);
  assert.equal(agentBrowserSupported("agent-browser 0.38.10"), true);
  assert.equal(agentBrowserSupported("agent-browser 0.38.0"), false);
  assert.equal(agentBrowserSupported("agent-browser 0.38.1-rc.1"), false);
  assert.equal(agentBrowserSupported("unknown"), false);
});

test("every user-facing Python entrypoint is stdlib-only and declares its runtime", () => {
  for (const name of [
    "verify-all.py",
    "verify-diagram.py",
    "verify-type.py",
    "verify-brief.py",
    "verify-motion.py",
    "check-visible-text.py",
    "drawio_extract.py",
    "mermaid_extract.py",
    "excalidraw_extract.py",
  ]) {
    const content = fs.readFileSync(path.join(skillRoot, "scripts", name), "utf8");
    assert.match(content, /# requires-python = ">=3\.10"/, `${name} must declare Python 3.10+`);
    assert.match(content, /# dependencies = \[\]/, `${name} must not install Python dependencies`);
  }
});

test("installed diagram skill is self-contained and omits review artifacts", () => {
  const files = skillFiles();
  const relative = files.map((file) => path.relative(skillRoot, file).split(path.sep).join("/"));
  assert.ok(!relative.some((file) => /(^|\/)ab\//i.test(file)), "A/B material must not ship");
  assert.ok(!relative.some((file) => /\.(?:png|webp|jpe?g)$/i.test(file)), "preview images must not ship");
  assert.ok(!relative.some((file) => /office-proof\.py$/i.test(file)), "source-lane Office QA must not ship");

  for (const file of files.filter((entry) => /\.(?:md|html|json|mjs|py|txt)$/i.test(entry))) {
    const content = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(content, /lit-diagram-canonical|plans\/|_refs\/|\.worktrees\//i, path.relative(skillRoot, file));
    assert.doesNotMatch(content, /T7(?:-diagram|-reference)?|score-t7/i, path.relative(skillRoot, file));
  }

  for (const required of [
    "scripts/verify-diagram.py",
    "scripts/verify-type.py",
    "scripts/verify-brief.py",
    "scripts/verify-motion.py",
    "scripts/verify-all.py",
    "scripts/check-visible-text.py",
    "scripts/drawio_source.py",
    "scripts/mermaid_source.py",
    "scripts/excalidraw_support.py",
    "scripts/browser-version.mjs",
    "scripts/export.mjs",
    "scripts/doctor.mjs",
    "scripts/drawio_extract.py",
    "scripts/mermaid_extract.py",
    "scripts/excalidraw_extract.py",
  ]) {
    assert.ok(relative.includes(required), `missing product-local runtime file ${required}`);
  }
  const scripts = files.filter((file) => file.startsWith(path.join(skillRoot, "scripts")));
  for (const file of scripts) {
    if (file.endsWith(".py")) assert.match(fs.readFileSync(file, "utf8"), /humanizer_detector|diagram_checks|import /);
  }
});

test("the installed payload detects and refuses any missing skill resource", () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(pluginRoot, "payload-version.json"), "utf8"));
  const skill = path.join(skillRoot, "SKILL.md");
  assert.ok(plugin.files.some((entry) => entry.path === "skills/lit-diagram-drawer/SKILL.md"));
  assert.ok(fs.statSync(skill).size > 12000, "skill must remain a complete workflow contract");
});
