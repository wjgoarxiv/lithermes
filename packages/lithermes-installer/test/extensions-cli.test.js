const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { EXTENSION_FAMILIES, RECEIPT, cacheDir } = require("../src/lib/extensions");
const { EXTENSION_IDS, SHELF_URL } = require("../src/lib/sessionNotices");

// `lithermes extensions <verb>` in a throwaway Hermes home, user home and cache folder. The source is a
// small stand-in for a wjgoarxiv-skills clone; the real shelf is probed separately (see the B report).
const pkg = path.resolve(__dirname, "..");
const bin = path.join(pkg, "bin", "lithermes.js");

function box() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-ext-cli-")));
  const home = path.join(root, "hermes");
  const user = path.join(root, "user");
  const project = path.join(root, "project");
  const clone = path.join(root, "clone");
  for (const dir of [home, user, project]) fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(project, ".git"));
  for (const id of ["lit-pptx", "visual-qa"]) writeVariant(clone, id, "v1");
  return { root, home, user, project, clone, cache: path.join(root, "cache") };
}

function writeVariant(clone, id, version) {
  const dir = path.join(clone, "variants", "lithermes", id);
  fs.mkdirSync(path.join(dir, "references"), { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${id}\ndescription: ${id} ${version}\n---\nbody ${version}\n`);
  fs.writeFileSync(path.join(dir, "references", "guide.md"), `guide ${version}\n`);
}

function run(b, args, { env = {}, cwd = b.project } = {}) {
  const result = spawnSync(process.execPath, [bin, "extensions", ...args, "--hermes-home", b.home], {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH, HOME: b.user, XDG_CACHE_HOME: b.cache,
      NO_COLOR: "1", LITHERMES_NO_UPDATE_CHECK: "1", LITHERMES_NO_AUTO_UPDATE: "1", ...env,
    },
  });
  return { ...result, text: result.stdout + result.stderr };
}

function tree(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (folder, rel) => {
    for (const name of fs.readdirSync(folder).sort()) {
      const full = path.join(folder, name);
      const key = rel ? `${rel}/${name}` : name;
      if (fs.lstatSync(full).isDirectory()) walk(full, key);
      else out.push(key);
    }
  };
  walk(dir, "");
  return out;
}

const backups = (b) => {
  const root = path.join(b.home, "extension-backups");
  return fs.existsSync(root) ? fs.readdirSync(root).filter((name) => !name.startsWith(".")).sort().map((name) => path.join(root, name)) : [];
};

test("install is a dry run without --yes, then copies one folder with a receipt into an empty profile", () => {
  const b = box();
  const dry = run(b, ["install", "lit-pptx", "--from", b.clone]);
  assert.equal(dry.status, 0, dry.text);
  assert.match(dry.text, /dry run, nothing changes\. Add --yes to do it\./);
  assert.ok(dry.text.includes(`lit-pptx: would copy ${path.join(b.clone, "variants", "lithermes", "lit-pptx")} to ${path.join(b.home, "skills", "lit-pptx")}`), dry.text);
  assert.deepEqual(fs.readdirSync(b.home), [], "a dry run writes nothing");

  const done = run(b, ["install", "lit-pptx", "--from", b.clone, "--yes"]);
  assert.equal(done.status, 0, done.text);
  const live = path.join(b.home, "skills", "lit-pptx");
  assert.ok(done.text.includes(`lit-pptx: copied: ${live}`), done.text);
  assert.deepEqual(tree(live), [RECEIPT, "SKILL.md", "references/guide.md"], "the folder itself, not a nested copy");
  const receipt = JSON.parse(fs.readFileSync(path.join(live, RECEIPT), "utf8"));
  assert.deepEqual(Object.keys(receipt).slice(0, 4), ["id", "source", "variant", "installed_at"], "the stub lines' four keys come first");
  assert.equal(receipt.id, "lit-pptx");
  assert.equal(receipt.variant, "lithermes");
  assert.equal(receipt.source, path.join(b.clone, "variants", "lithermes", "lit-pptx"));
  assert.equal(receipt.family, "decks");
  assert.match(receipt.hash, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(backups(b), [], "nothing to move aside in a fresh profile");
  assert.deepEqual(fs.readdirSync(path.join(b.home, "extension-backups")), [], "the staging folder is gone");

  const list = run(b, ["list"]);
  assert.match(list.text, /lit-pptx \(decks\): installed \d{4}-\d\d-\d\dT[\d:]+Z from /);
  assert.match(list.text, /lit-docx \(documents\): not installed/);
  const json = JSON.parse(run(b, ["list", "--json"]).stdout);
  assert.equal(json.records.find((record) => record.id === "lit-pptx").state, "installed");
  assert.equal(run(b, ["check"]).status, 0, "a profile with one clean install needs nothing");
});

test("install over a user folder moves it whole into extension-backups/ and leaves one clean live copy", () => {
  const b = box();
  const live = path.join(b.home, "skills", "lit-pptx");
  fs.mkdirSync(live, { recursive: true });
  fs.writeFileSync(path.join(live, "SKILL.md"), "---\nname: lit-pptx\n---\nold\n");
  fs.writeFileSync(path.join(live, "my-notes.md"), "mine\n");
  const check = run(b, ["check"]);
  assert.equal(check.status, 1, check.text);
  assert.ok(check.text.includes(`lit-pptx: ${live} has no LitHermes receipt`), check.text);
  assert.match(check.text, /fix: lithermes extensions install lit-pptx --yes --hermes-home /);
  assert.match(run(b, ["list"]).text, /lit-pptx \(decks\): user-managed \(no receipt\)/);

  const done = run(b, ["install", "lit-pptx", "--from", b.clone, "--yes"]);
  assert.equal(done.status, 0, done.text);
  const [backup] = backups(b);
  assert.ok(done.text.includes(`lit-pptx: moved aside: ${path.join(backup, "lit-pptx")}`), done.text);
  assert.match(path.basename(backup), /^\d{8}-\d{6}-[A-Za-z0-9]{6}$/);
  assert.equal(fs.readFileSync(path.join(backup, "lit-pptx", "my-notes.md"), "utf8"), "mine\n", "the user's file is intact in the backup");
  assert.match(fs.readFileSync(path.join(backup, "lit-pptx", "SKILL.md"), "utf8"), /old/);
  assert.deepEqual(tree(live), [RECEIPT, "SKILL.md", "references/guide.md"], "no old file mixes into the copy");
  assert.ok(!backup.startsWith(path.join(b.home, "skills")), "the backup sits outside skills/");
  assert.equal(run(b, ["check"]).status, 0);
});

test("a same-name skill in another folder Hermes reads stops the install and is never touched", () => {
  const b = box();
  const personal = path.join(b.project, ".agents", "skills", "lit-pptx");
  fs.mkdirSync(personal, { recursive: true });
  fs.writeFileSync(path.join(personal, "SKILL.md"), "---\nname: lit-pptx\n---\nmy own\n");
  const stopped = run(b, ["install", "lit-pptx", "--from", b.clone, "--yes"]);
  assert.equal(stopped.status, 1, stopped.text);
  assert.ok(stopped.text.includes(`lit-pptx: stopped: another skill named lit-pptx is at ${personal} (project)`), stopped.text);
  assert.match(stopped.text, /add --allow-shadow to install anyway\.\nNothing was changed\./);
  assert.equal(fs.existsSync(path.join(b.home, "skills")), false);
  const check = run(b, ["check"]);
  assert.equal(check.status, 1);
  assert.ok(check.text.includes(`another skill named lit-pptx is at ${personal} (project)`), check.text);

  const shadow = run(b, ["install", "lit-pptx", "--from", b.clone, "--yes", "--allow-shadow"]);
  assert.equal(shadow.status, 0, shadow.text);
  assert.ok(shadow.text.includes(`lit-pptx: warning: ${personal} (project) wins over the extension inside ${b.project} once that folder is in skills.trusted_project_dirs`), shadow.text);
  assert.equal(fs.readFileSync(path.join(personal, "SKILL.md"), "utf8"), "---\nname: lit-pptx\n---\nmy own\n", "the personal copy is left alone");
  assert.ok(fs.existsSync(path.join(b.home, "skills", "lit-pptx", RECEIPT)));
  // Outside that project the personal copy is out of sight.
  assert.equal(run(b, ["check"], { cwd: b.root }).status, 0);
});

test("a second copy inside skills/ (a backup or a category folder) stops even with --allow-shadow, because Hermes refuses both", () => {
  const b = box();
  for (const dir of [path.join(b.home, "skills", "lit-pptx.bak-20261112"), path.join(b.home, "skills", "creative", "visual-qa")]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${path.basename(dir).replace(/\.bak.*/, "")}\n---\nold\n`);
  }
  const check = run(b, ["check", "--json"]);
  assert.equal(check.status, 1);
  const issues = JSON.parse(check.stdout).issues.filter((issue) => issue.kind === "ambiguous").map((issue) => [issue.id, issue.path]);
  assert.deepEqual(issues, [
    ["lit-pptx", path.join(b.home, "skills", "lit-pptx.bak-20261112")],
    ["visual-qa", path.join(b.home, "skills", "creative", "visual-qa")],
  ]);
  assert.match(run(b, ["check"]).text, /ties with skills\/lit-pptx\/, and Hermes then loads neither/);
  const stopped = run(b, ["install", "lit-pptx", "visual-qa", "--from", b.clone, "--yes", "--allow-shadow"]);
  assert.equal(stopped.status, 1, stopped.text);
  assert.match(stopped.text, /Move it out of skills\/ first/);
  assert.equal(fs.existsSync(path.join(b.home, "skills", "lit-pptx")), false, "nothing installed, not even the first id");
  assert.equal(fs.existsSync(path.join(b.home, "skills", "visual-qa")), false);
});

test("update reinstalls only a changed source, reports current otherwise, and leaves changed or unreceipted folders alone", () => {
  const b = box();
  assert.equal(run(b, ["install", "--all", "--from", b.clone, "--yes"]).status, 3, "--all stops when the source lacks some ids");
  const family = run(b, ["install", "--family", "design", "--from", b.clone, "--yes"]);
  assert.equal(family.status, 3, "frontend-ui-ux is missing from the stand-in");
  assert.match(family.text, /frontend-ui-ux is missing or holds no SKILL\.md\. Nothing was changed\./);
  assert.equal(fs.existsSync(path.join(b.home, "skills")), false, "a missing id stops the whole call before any copy");
  assert.equal(run(b, ["install", "lit-pptx", "visual-qa", "--from", b.clone, "--yes"]).status, 0);
  const live = path.join(b.home, "skills", "lit-pptx");
  const before = JSON.parse(fs.readFileSync(path.join(live, RECEIPT), "utf8"));

  const same = run(b, ["update", "--from", b.clone, "--yes"]);
  assert.equal(same.status, 0, same.text);
  assert.match(same.text, /lit-pptx: current\nvisual-qa: current/);
  assert.deepEqual(backups(b), []);

  writeVariant(b.clone, "lit-pptx", "v2");
  const dry = run(b, ["update", "--from", b.clone]);
  assert.match(dry.text, /lit-pptx: would move .* aside into .*extension-backups\/<date-time>-XXXXXX\/, then copy /);
  assert.match(dry.text, /visual-qa: current/);
  const changed = run(b, ["update", "--from", b.clone, "--yes"]);
  assert.equal(changed.status, 0, changed.text);
  assert.match(changed.text, /lit-pptx: moved aside: .*\nlit-pptx: updated: /);
  assert.match(fs.readFileSync(path.join(live, "SKILL.md"), "utf8"), /body v2/);
  const after = JSON.parse(fs.readFileSync(path.join(live, RECEIPT), "utf8"));
  assert.notEqual(after.hash, before.hash);
  assert.equal(backups(b).length, 1);
  assert.match(fs.readFileSync(path.join(backups(b)[0], "lit-pptx", "SKILL.md"), "utf8"), /body v1/);

  fs.appendFileSync(path.join(path.join(b.home, "skills", "visual-qa"), "SKILL.md"), "my edit\n");
  writeVariant(b.clone, "visual-qa", "v2");
  const refused = run(b, ["update", "visual-qa", "--from", b.clone, "--yes"]);
  assert.equal(refused.status, 1, refused.text);
  assert.match(refused.text, /visual-qa: refused: files in .* changed since it was installed/);
  assert.match(fs.readFileSync(path.join(b.home, "skills", "visual-qa", "SKILL.md"), "utf8"), /my edit/);

  fs.unlinkSync(path.join(b.home, "skills", "visual-qa", RECEIPT));
  const unreceipted = run(b, ["update", "visual-qa", "--from", b.clone, "--yes"]);
  assert.equal(unreceipted.status, 1);
  assert.match(unreceipted.text, /has no LitHermes receipt, so update leaves it alone/);
  assert.match(run(b, ["update", "lit-docx", "--from", b.clone]).text, /lit-docx: not installed/);
  // Put a receipt back on visual-qa, then take its source away: update keeps the installed copy.
  assert.equal(run(b, ["install", "visual-qa", "--from", b.clone, "--yes"]).status, 0);
  fs.rmSync(path.join(b.clone, "variants", "lithermes", "visual-qa"), { recursive: true });
  writeVariant(b.clone, "lit-pptx", "v3");
  const partial = run(b, ["update", "--from", b.clone, "--yes"]);
  assert.equal(partial.status, 1, partial.text);
  assert.match(partial.text, /lit-pptx: updated: /);
  assert.match(partial.text, /visual-qa: kept as it is: .* is missing or holds no SKILL\.md/);
});

test("remove moves an installed folder into the backups and refuses a user folder with its path", () => {
  const b = box();
  assert.equal(run(b, ["install", "lit-pptx", "--from", b.clone, "--yes"]).status, 0);
  const mine = path.join(b.home, "skills", "visual-qa");
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, "SKILL.md"), "---\nname: visual-qa\n---\nmine\n");

  const refused = run(b, ["remove", "visual-qa", "--yes"]);
  assert.equal(refused.status, 1);
  assert.ok(refused.text.includes(`visual-qa: refused: ${mine} has no LitHermes receipt (user-managed)`), refused.text);
  assert.ok(fs.existsSync(path.join(mine, "SKILL.md")));
  assert.equal(run(b, ["remove", "lit-pptx", "visual-qa", "--yes"]).status, 1, "one refusal stops the whole call");
  assert.ok(fs.existsSync(path.join(b.home, "skills", "lit-pptx")));

  const dry = run(b, ["remove", "lit-pptx"]);
  assert.match(dry.text, /lit-pptx: would move .* \(nothing is deleted\)/);
  assert.ok(fs.existsSync(path.join(b.home, "skills", "lit-pptx")));
  const done = run(b, ["remove", "lit-pptx", "--yes"]);
  assert.equal(done.status, 0, done.text);
  assert.equal(fs.existsSync(path.join(b.home, "skills", "lit-pptx")), false);
  assert.ok(fs.existsSync(path.join(backups(b)[0], "lit-pptx", RECEIPT)), "the folder and its receipt sit in the backup");
  assert.match(run(b, ["remove", "lit-pptx", "--yes"]).text, /lit-pptx: not installed/);
});

test("prune-backups lists the backups with sizes, deletes nothing without --yes and only old ones with --older-than", () => {
  const b = box();
  assert.equal(run(b, ["install", "lit-pptx", "--from", b.clone, "--yes"]).status, 0);
  assert.equal(run(b, ["install", "lit-pptx", "--from", b.clone, "--yes"]).status, 0);
  const root = path.join(b.home, "extension-backups");
  const old = path.join(root, "20200101-000000-abcdef");
  fs.mkdirSync(path.join(old, "lit-pptx"), { recursive: true });
  fs.writeFileSync(path.join(old, "lit-pptx", "SKILL.md"), "x".repeat(2048));
  const outside = path.join(b.root, "outside");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(root, "20190101-000000-linked"));
  assert.equal(backups(b).length, 3);
  assert.match(run(b, ["check"]).text, /note: backups: 3 folders in .*extension-backups, /);

  const dry = run(b, ["prune-backups"]);
  assert.equal(dry.status, 0, dry.text);
  assert.match(dry.text, /20200101-000000-abcdef {2}lit-pptx {2}2\.0 KB/);
  assert.match(dry.text, /20190101-000000-linked .*\(left alone: not a plain folder\)/);
  assert.match(dry.text, /would delete 2 folders/);
  assert.equal(backups(b).length, 3);

  const aged = run(b, ["prune-backups", "--older-than", "30", "--yes"]);
  assert.equal(aged.status, 0, aged.text);
  assert.match(aged.text, /deleted 1 folder, 2\.0 KB/);
  assert.equal(fs.existsSync(old), false);
  assert.equal(backups(b).length, 2, "the newer backup and the link stay");
  assert.ok(fs.existsSync(outside), "a link is never followed");
  assert.equal(run(b, ["prune-backups", "--yes"]).status, 0);
  assert.deepEqual(backups(b).map((dir) => path.basename(dir)), ["20190101-000000-linked"]);
  assert.equal(run(b, ["prune-backups", "--older-than", "soon"]).status, 2);
});

test("without --from and without git or a network, install stops before any change and names --from", () => {
  const b = box();
  const noGit = run(b, ["install", "lit-pptx", "--yes"], { env: { PATH: path.join(b.root, "empty-bin") } });
  assert.equal(noGit.status, 3, noGit.text);
  assert.match(noGit.text, /could not fetch the extension shelf \(git is not installed or not on PATH\)\. Nothing was installed\./);
  assert.match(noGit.text, /pass --from <path to your wjgoarxiv-skills clone>/);
  assert.equal(fs.existsSync(path.join(b.home, "skills")), false);
  assert.equal(fs.existsSync(path.join(b.cache, "lithermes", "extensions-src")), false);

  const dry = run(b, ["install", "lit-pptx"]);
  assert.equal(dry.status, 0, dry.text);
  assert.ok(dry.text.includes(`source: would fetch ${SHELF_URL}.git (variants/lithermes/ only) into ${path.join(b.cache, "lithermes", "extensions-src")}`), dry.text);
  assert.equal(fs.existsSync(path.join(b.cache, "lithermes", "extensions-src")), false, "a dry run fetches nothing");

  if (spawnSync("git", ["--version"]).status !== 0) return;
  const offline = run(b, ["install", "lit-pptx", "--yes"], {
    env: { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${path.join(b.root, "nowhere")}/.insteadOf`, GIT_CONFIG_VALUE_0: "https://github.com/wjgoarxiv/" },
  });
  assert.equal(offline.status, 3, offline.text);
  assert.match(offline.text, /could not fetch the extension shelf \(git clone exited 128/);
  assert.equal(fs.existsSync(path.join(b.home, "skills")), false);
  assert.deepEqual(fs.readdirSync(path.join(b.cache, "lithermes")), [], "a failed fetch leaves no half clone");

  const missing = run(b, ["install", "lit-pptx", "--from", path.join(b.root, "no-clone"), "--yes"]);
  assert.equal(missing.status, 2);
  assert.match(missing.text, /has no variants\/lithermes\/ folder; point --from at a wjgoarxiv-skills clone/);
});

test("without --from the source is a sparse clone in the cache folder, and update pulls it", { skip: spawnSync("git", ["--version"]).status !== 0 }, () => {
  const b = box();
  const git = (...args) => spawnSync("git", args, { cwd: b.clone, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  writeVariant(b.clone, "lit-docx", "v1");
  fs.mkdirSync(path.join(b.clone, "variants", "otherhost", "lit-pptx"), { recursive: true });
  fs.writeFileSync(path.join(b.clone, "variants", "otherhost", "lit-pptx", "SKILL.md"), "other harness\n");
  for (const args of [["init", "-q", "-b", "main"], ["add", "."], ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-qm", "v1"]]) assert.equal(git(...args).status, 0);
  const env = { GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: `url.file://${b.clone}.insteadOf`, GIT_CONFIG_VALUE_0: `${SHELF_URL}.git`, GIT_CONFIG_KEY_1: "protocol.file.allow", GIT_CONFIG_VALUE_1: "always" };

  const done = run(b, ["install", "lit-docx", "--yes"], { env });
  assert.equal(done.status, 0, done.text);
  const src = cacheDir({ XDG_CACHE_HOME: b.cache });
  assert.equal(fs.existsSync(path.join(src, "variants", "otherhost")), false, "only variants/lithermes/ is checked out");
  const receipt = JSON.parse(fs.readFileSync(path.join(b.home, "skills", "lit-docx", RECEIPT), "utf8"));
  assert.equal(receipt.source, path.join(src, "variants", "lithermes", "lit-docx"));
  assert.match(receipt.commit, /^[0-9a-f]{4,}$/);

  writeVariant(b.clone, "lit-docx", "v2");
  assert.equal(git("-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-qam", "v2").status, 0);
  const updated = run(b, ["update", "--yes"], { env });
  assert.equal(updated.status, 0, updated.text);
  assert.match(updated.text, /refreshed from/);
  assert.match(updated.text, /lit-docx: updated: /);
  assert.match(fs.readFileSync(path.join(b.home, "skills", "lit-docx", "SKILL.md"), "utf8"), /body v2/);

  fs.rmSync(path.join(src, "variants"), { recursive: true });
  assert.equal(run(b, ["check"]).status, 1, "a receipt whose source is gone needs a hand");
});

test("a symbolic link at skills/<id> or at skills/ itself fails closed", () => {
  const b = box();
  const elsewhere = path.join(b.root, "elsewhere");
  fs.mkdirSync(elsewhere);
  fs.mkdirSync(path.join(b.home, "skills"));
  fs.symlinkSync(elsewhere, path.join(b.home, "skills", "lit-pptx"));
  const linked = run(b, ["install", "lit-pptx", "--from", b.clone, "--yes"]);
  assert.equal(linked.status, 1, linked.text);
  assert.match(linked.text, /is a symbolic link; move it away by hand/);
  assert.equal(run(b, ["remove", "lit-pptx", "--yes"]).status, 1);
  assert.deepEqual(fs.readdirSync(elsewhere), []);

  const c = box();
  const target = path.join(c.root, "real-skills");
  fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(c.home, "skills"));
  const parent = run(c, ["install", "lit-pptx", "--from", c.clone, "--yes"]);
  assert.equal(parent.status, 5, parent.text);
  assert.match(parent.text, /is a symbolic link or not a folder; the extension verbs will not write through it/);
  assert.deepEqual(fs.readdirSync(target), []);
});

test("the verbs refuse unknown ids, families and options that belong to another verb", () => {
  const b = box();
  for (const args of [["install", "lit-pptxx"], ["install", "--family", "posters"], ["list", "--yes"], ["check", "lit-pptx"], ["remove"], ["install"], ["frobnicate"]]) {
    const result = run(b, args);
    assert.equal(result.status, 2, `${args.join(" ")}: ${result.text}`);
  }
  assert.deepEqual(fs.readdirSync(b.home), []);
});

test("help, doctor and the families table name the verbs and stay in step with the plugin", () => {
  const help = spawnSync(process.execPath, [bin, "help"], { encoding: "utf8" });
  assert.match(help.stdout, /extensions list\|check\|install\|update\|remove\|prune-backups \[<id>\.\.\.\]/);
  const contract = fs.readFileSync(path.join(pkg, "assets", "lithermes-plugin", "core_contract.py"), "utf8");
  const block = /MOVED_SKILL_FAMILIES = \{([^}]*)\}/.exec(contract)[1];
  assert.deepEqual(Object.fromEntries([...block.matchAll(/"([a-z-]+)": "([a-z-]+)"/g)].map((m) => [m[1], m[2]])), EXTENSION_FAMILIES);
  assert.deepEqual(Object.keys(EXTENSION_FAMILIES), EXTENSION_IDS);

  const b = box();
  const env = { PATH: process.env.PATH, HOME: b.user, XDG_CACHE_HOME: b.cache, NO_COLOR: "1", LITHERMES_NO_UPDATE_CHECK: "1", LITHERMES_NO_AUTO_UPDATE: "1" };
  assert.equal(spawnSync(process.execPath, [bin, "install", "--yes", "--offline", "--no-style", "--no-hud", "--hermes-home", b.home], { cwd: b.root, encoding: "utf8", env }).status, 0);
  assert.equal(run(b, ["install", "lit-pptx", "--from", b.clone, "--yes"]).status, 0);
  const doctor = spawnSync(process.execPath, [bin, "doctor", "--offline", "--hermes-home", b.home], { cwd: b.root, encoding: "utf8", env });
  assert.match(doctor.stdout, /moved skill copy: lit-pptx at .* \(local skills; receipt: installed \d{4}-[\d-]+T[\d:]+Z from .*\); the lithermes:lit-pptx stub hands over to it/);
  assert.match(doctor.stdout, /^extensions: 1 of 9 installed, check clean$/m);
});

test("an upgrade's notice points at extensions check when the profile needs a hand", () => {
  const b = box();
  const env = { PATH: process.env.PATH, HOME: b.user, XDG_CACHE_HOME: b.cache, NO_COLOR: "1", LITHERMES_NO_UPDATE_CHECK: "1", LITHERMES_NO_AUTO_UPDATE: "1" };
  const install = () => spawnSync(process.execPath, [bin, "install", "--yes", "--offline", "--no-style", "--no-hud", "--hermes-home", b.home], { cwd: b.root, encoding: "utf8", env });
  assert.equal(install().status, 0);
  const old = path.join(b.home, "skills", "lit-pptx");
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, "SKILL.md"), "---\nname: lit-pptx\n---\ncopied by hand\n");
  const manifest = path.join(b.home, "lithermes", "install-manifest.json");
  fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest, "utf8")), version: "1.0.39" }));
  const upgraded = install();
  assert.equal(upgraded.status, 0, upgraded.stderr);
  assert.match(upgraded.stdout, /This profile has one thing to look at \(a second copy or a folder without a receipt\): npx --package @litfamily\/lithermes -- lithermes extensions check/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(b.home, "lithermes", "notices", "extensions.json"), "utf8")).extensionsCheck, 1);
  assert.ok(fs.existsSync(path.join(old, "SKILL.md")), "nothing changes on its own");
});
