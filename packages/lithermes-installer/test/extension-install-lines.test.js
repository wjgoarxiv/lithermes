const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const {
  EXTENSION_CLI, EXTENSION_IDS, EXTENSION_REMOVE_LINE, EXTENSION_STEP_LINES, INSTALL_LINES, extensionSetupLine,
} = require("../src/lib/sessionNotices");

// The Hermes install lines for one LitFamily extension: name it, check, move any old copy aside, copy, receipt.
// A plain `cp -R <variant> skills/` merges into an existing folder, so old and new files mix; these lines never do.
const pkg = path.resolve(__dirname, "..");
const repo = path.resolve(pkg, "..", "..");
const PLACEHOLDER = "<path to your wjgoarxiv-skills clone>";
const MERGING = /cp -R [^\n]*variants\/lithermes\/[^\n]*"\$\{HERMES_HOME:-\$HOME\/\.hermes\}\/skills\/"/;
const stub = (id) => fs.readFileSync(path.join(pkg, "assets", "lithermes-plugin", "skills", id, "SKILL.md"), "utf8");

function codeBlocks(text, heading) {
  const start = text.indexOf(`\n## ${heading}\n`);
  assert.notEqual(start, -1, heading);
  const end = text.indexOf("\n## ", start + 1);
  const section = text.slice(start, end === -1 ? undefined : end);
  return [...section.matchAll(/```(?:bash|sh)\n([\s\S]*?)```/g)].map((match) => match[1].trimEnd().split("\n"));
}

function shells() {
  return ["bash", "zsh"].filter((shell) => spawnSync(shell, ["-c", "true"]).status === 0);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-ext-lines-"));
  const clone = path.join(root, "clone");
  const variant = path.join(clone, "variants", "lithermes", "lit-pptx");
  fs.mkdirSync(path.join(variant, "references"), { recursive: true });
  fs.writeFileSync(path.join(variant, "SKILL.md"), "---\nname: lit-pptx\ndescription: deck skill v2\n---\nbody v2\n");
  fs.writeFileSync(path.join(variant, "references", "guide.md"), "guide v2\n");
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  fs.mkdirSync(home);
  fs.mkdirSync(project);
  return { root, clone, home, project };
}

function paste(shell, lines, { clone, home, project }) {
  const script = lines.map((line) => line.split(PLACEHOLDER).join(clone)).join("\n");
  return spawnSync(shell, ["-c", script], {
    cwd: project,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: home, HERMES_HOME: home },
  });
}

const backups = (home) => {
  const root = path.join(home, "extension-backups");
  return fs.existsSync(root) ? fs.readdirSync(root).sort().map((stamp) => path.join(root, stamp)) : [];
};

test("every stub gives the extensions command, then the five install lines and the remove line, and no line that merges into skills/", () => {
  for (const id of EXTENSION_IDS) {
    const text = stub(id);
    const [command, install, remove] = codeBlocks(text, "Install for Hermes");
    assert.deepEqual(command, [`${EXTENSION_CLI} extensions install ${id} --yes`], `${id} command`);
    for (const verb of ["update", "remove", "check", "--allow-shadow", "--from"]) assert.ok(text.includes(verb), `${id} names ${verb}`);
    assert.deepEqual(install, [extensionSetupLine(id, `${PLACEHOLDER}/variants/lithermes/${id}`), ...EXTENSION_STEP_LINES], id);
    assert.deepEqual(remove, [EXTENSION_REMOVE_LINE], `${id} remove line`);
    assert.doesNotMatch(text, MERGING, `${id} drops the merging copy line`);
    assert.ok(text.includes("extension-backups/"), `${id} says where the old copy goes`);
    assert.ok(text.includes(".litfamily-extension.json"), `${id} names the receipt`);
  }
});

test("every surface that tells the user to run the extension verbs uses one command form, pinned to @latest", () => {
  assert.equal(EXTENSION_CLI, "npx --package @litfamily/lithermes@latest -- lithermes");
  const files = ["README.md", "README_Ko-KR.md", "packages/lithermes-installer/README.md", "packages/lithermes-installer/README_Ko-KR.md",
    "docs/skills.md", "docs/skills.ko.md", "packages/lithermes-installer/src/lib/sessionNotices.js",
    "packages/lithermes-installer/src/lib/extensions.js", "packages/lithermes-installer/assets/lithermes-plugin/core_contract.py",
    "packages/lithermes-installer/assets/lithermes-plugin/install_notices.py",
    ...EXTENSION_IDS.map((id) => `packages/lithermes-installer/assets/lithermes-plugin/skills/${id}/SKILL.md`)];
  for (const file of files) {
    const text = fs.readFileSync(path.join(repo, file), "utf8");
    assert.doesNotMatch(text, /@litfamily\/lithermes -- lithermes extensions/, `${file} names the package without @latest`);
    assert.doesNotMatch(text, /[`"] *lithermes extensions (?:list|check|install|update|remove|prune-backups) /, `${file} gives a bare lithermes extensions command`);
  }
});

test("the READMEs, the skills pages and the installer notice carry the same lines and no merging copy", () => {
  assert.deepEqual(INSTALL_LINES, [
    "git clone https://github.com/wjgoarxiv/wjgoarxiv-skills.git",
    extensionSetupLine("lit-pptx", "$PWD/wjgoarxiv-skills/variants/lithermes/$ID"),
    ...EXTENSION_STEP_LINES,
  ]);
  for (const file of ["README.md", "README_Ko-KR.md", "packages/lithermes-installer/README.md",
    "packages/lithermes-installer/README_Ko-KR.md", "docs/skills.md", "docs/skills.ko.md"]) {
    const text = fs.readFileSync(path.join(repo, file), "utf8");
    assert.doesNotMatch(text, MERGING, `${file} drops the merging copy line`);
    for (const line of EXTENSION_STEP_LINES) assert.ok(text.includes(line), `${file}: ${line}`);
  }
  const notice = fs.readFileSync(path.join(pkg, "assets", "lithermes-plugin", "install_notices.py"), "utf8");
  assert.doesNotMatch(notice, MERGING);
});

for (const shell of shells()) {
  test(`${shell}: fresh install, install over an old folder, update and remove keep exactly one live copy`, () => {
    const box = fixture();
    const install = codeBlocks(stub("lit-pptx"), "Install for Hermes")[1];
    const live = path.join(box.home, "skills", "lit-pptx");

    // 1. Fresh: an empty profile gets the folder itself, not a nested copy, and a receipt.
    let run = paste(shell, install, box);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /free: .*skills\/lit-pptx/);
    assert.deepEqual(fs.readdirSync(live).sort(), [".litfamily-extension.json", "SKILL.md", "references"]);
    const receipt = JSON.parse(fs.readFileSync(path.join(live, ".litfamily-extension.json"), "utf8"));
    assert.deepEqual(Object.keys(receipt), ["id", "source", "variant", "installed_at"]);
    assert.equal(receipt.id, "lit-pptx");
    assert.equal(receipt.variant, "lithermes");
    assert.equal(receipt.source, path.join(box.clone, "variants", "lithermes", "lit-pptx"));
    assert.match(receipt.installed_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.deepEqual(backups(box.home), []);

    // 2. Over an old same-name folder with a file of the user's: the whole folder moves aside, the copy is clean.
    fs.rmSync(live, { recursive: true });
    fs.mkdirSync(live);
    fs.writeFileSync(path.join(live, "SKILL.md"), "---\nname: lit-pptx\ndescription: old\n---\nold\n");
    fs.writeFileSync(path.join(live, "my-notes.md"), "mine\n");
    run = paste(shell, install, box);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /taken: .*skills\/lit-pptx/);
    assert.match(run.stdout, /moved aside: .*extension-backups\/\d{8}-\d{6}-\w{4}\/lit-pptx/);
    assert.deepEqual(fs.readdirSync(live).sort(), [".litfamily-extension.json", "SKILL.md", "references"], "no old file mixed in");
    const [first] = backups(box.home);
    assert.equal(fs.readFileSync(path.join(first, "lit-pptx", "my-notes.md"), "utf8"), "mine\n");
    assert.ok(path.relative(path.join(box.home, "skills"), first).startsWith(".."), "the backup sits outside skills/");

    // A same-name skill in a project folder Hermes reads is named by the check line.
    const project = path.join(box.project, ".agents", "skills", "decks");
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, "SKILL.md"), "---\nname: 'lit-pptx'\ndescription: project copy\n---\n");

    // 3. Update: the same lines again move the current copy aside and rewrite the receipt.
    fs.writeFileSync(path.join(box.clone, "variants", "lithermes", "lit-pptx", "SKILL.md"), "---\nname: lit-pptx\ndescription: v3\n---\nv3\n");
    spawnSync("sleep", ["1"]);
    run = paste(shell, install, box);
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.includes(path.join(".agents", "skills", "decks", "SKILL.md")), run.stdout);
    assert.match(fs.readFileSync(path.join(live, "SKILL.md"), "utf8"), /v3/);
    assert.equal(backups(box.home).length, 2, "each update keeps its own dated backup");
    const again = JSON.parse(fs.readFileSync(path.join(live, ".litfamily-extension.json"), "utf8"));
    assert.notEqual(again.installed_at, receipt.installed_at, "the receipt is rewritten");

    // 4. Remove: the folder moves into the backups; nothing is deleted.
    run = paste(shell, [install[0], EXTENSION_REMOVE_LINE], box);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(fs.existsSync(live), false);
    assert.equal(backups(box.home).length, 3);
    assert.ok(fs.existsSync(path.join(backups(box.home)[2], "lit-pptx", ".litfamily-extension.json")));
    fs.rmSync(box.root, { recursive: true, force: true });
  });

  test(`${shell}: a source path with a double quote or a backslash still gives a receipt that parses`, () => {
    const box = fixture();
    const odd = path.join(box.root, 'my "shelf" \\ copy');
    fs.renameSync(box.clone, odd);
    const install = codeBlocks(stub("lit-pptx"), "Install for Hermes")[1];
    // The user escapes the path for the double-quoted SRC="..." of the first line, as bash and zsh need.
    const quoted = odd.replace(/[\\"$`]/g, "\\$&");
    const run = paste(shell, install, { ...box, clone: quoted });
    assert.equal(run.status, 0, run.stderr);
    const receipt = JSON.parse(fs.readFileSync(path.join(box.home, "skills", "lit-pptx", ".litfamily-extension.json"), "utf8"));
    assert.equal(receipt.source, path.join(odd, "variants", "lithermes", "lit-pptx"));
    fs.rmSync(box.root, { recursive: true, force: true });
  });

  test(`${shell}: an unset ID stops every writing line before it touches skills/`, () => {
    const box = fixture();
    const skills = path.join(box.home, "skills");
    fs.mkdirSync(path.join(skills, "mine"), { recursive: true });
    const lines = [`H="${box.home}"; ID=; SRC="${box.clone}/variants/lithermes/"`, ...EXTENSION_STEP_LINES.slice(1), EXTENSION_REMOVE_LINE];
    for (const line of lines.slice(1)) paste(shell, [lines[0], line], box);
    assert.deepEqual(fs.readdirSync(skills), ["mine"], "the skills folder stays where it was");
    assert.deepEqual(backups(box.home), []);
    fs.rmSync(box.root, { recursive: true, force: true });
  });
}
