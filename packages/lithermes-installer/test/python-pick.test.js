// A host Python is only usable for a pinned venv when every locked wheel ships for it. Python 3.15
// has no PyYAML or llvmlite wheel yet, so a bare `python3` that resolves to 3.15 must be passed
// over, not used. Fake interpreters on a temp PATH stand in for the host; nothing here installs.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const skills = path.join(__dirname, "..", "assets", "lithermes-plugin", "skills");
// The deck, film and diagram copies left with their skills; the interface probe keeps the last one.
const copies = [
  path.join(skills, "frontend-ui-ux", "scripts", "hostexec.mjs"),
];
const posixOnly = { skip: process.platform === "win32" };
const temps = [];
const tmp = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(dir); return dir; };
after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

// A directory of fake interpreters; each prints the version it pretends to be.
function fakeBin(versions) {
  const dir = tmp("lh-pyfake-");
  for (const [name, version] of Object.entries(versions)) fs.writeFileSync(path.join(dir, name), `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
  return dir;
}

for (const file of copies) {
  const label = path.relative(skills, file);
  const load = () => import(pathToFileURL(file).href);

  test(`${label}: the newest supported python3.X wins over a python3 that is too new`, posixOnly, async () => {
    const { pickPython } = await load();
    const bin = fakeBin({ python3: "3.15.0", "python3.12": "3.12.4", "python3.13": "3.13.1" });
    const picked = pickPython({ env: { PATH: bin }, min: [3, 10] });
    assert.equal(picked.python, "python3.13");
    assert.equal(picked.version, "3.13.1");
  });

  test(`${label}: python3.14 is the ceiling and python3.15 is never picked`, posixOnly, async () => {
    const { pickPython, PYTHON_MAX } = await load();
    assert.deepEqual(PYTHON_MAX, [3, 14]);
    const bin = fakeBin({ "python3.15": "3.15.0", "python3.14": "3.14.7" });
    assert.equal(pickPython({ env: { PATH: bin }, min: [3, 10] }).python, "python3.14");
  });

  test(`${label}: with only a python3.15 python3 nothing is picked and the reason names it`, posixOnly, async () => {
    const { pickPython } = await load();
    const bin = fakeBin({ python3: "3.15.0" });
    const picked = pickPython({ env: { PATH: bin }, min: [3, 10] });
    assert.equal(picked.python, null);
    assert.match(picked.detail, /no supported Python \(3\.10 to 3\.14\) on PATH/);
    assert.match(picked.detail, /python3 3\.15\.0/);
  });

  test(`${label}: a plain python3 inside the range is used when no versioned name exists`, posixOnly, async () => {
    const { pickPython } = await load();
    const bin = fakeBin({ python3: "3.12.2" });
    assert.equal(pickPython({ env: { PATH: bin }, min: [3, 10] }).python, "python3");
  });

  test(`${label}: the floor is the caller's and a python below it is passed over`, posixOnly, async () => {
    const { pickPython } = await load();
    const bin = fakeBin({ "python3.10": "3.10.9" });
    assert.equal(pickPython({ env: { PATH: bin }, min: [3, 10] }).python, "python3.10");
    assert.equal(pickPython({ env: { PATH: bin }, min: [3, 11] }).python, null);
  });

  test(`${label}: an override variable is authoritative, even outside the range`, posixOnly, async () => {
    const { pickPython } = await load();
    const bin = fakeBin({ "python3.13": "3.13.1" });
    const pinned = path.join(fakeBin({ mypy: "3.15.0" }), "mypy");
    const picked = pickPython({ env: { PATH: bin, LITHERMES_TEST_PYTHON: pinned }, override: "LITHERMES_TEST_PYTHON", min: [3, 10] });
    assert.equal(picked.python, pinned);
    const broken = pickPython({ env: { PATH: bin, LITHERMES_TEST_PYTHON: "/nonexistent/python" }, override: "LITHERMES_TEST_PYTHON", min: [3, 10] });
    assert.equal(broken.python, null);
    assert.match(broken.detail, /LITHERMES_TEST_PYTHON is set to \/nonexistent\/python, which does not run/);
  });
}
