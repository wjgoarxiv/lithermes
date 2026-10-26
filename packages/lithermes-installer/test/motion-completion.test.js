const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..', 'assets', 'lithermes-plugin', 'skills', 'lit-typographic-motion');
const load = () => import(pathToFileURL(path.join(root, 'engine', 'completion.mjs')).href);
const ARTIFACTS = ['film.mp4', 'preview.webp', 'poster.png', 'reduced-motion.png'];

// A run directory in a given end state; `brief` is written first so the
// manifest and report are newer than the last scene edit unless a case says otherwise.
function runDir({ exit, mode = 'run', round = 1, failed = [], at = 'deliverable', report = true, manifest = true, staleBrief = false, withheldText = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-done-'));
  const brief = path.join(dir, 'brief.json');
  fs.writeFileSync(brief, JSON.stringify({ text: ['A quiet line'] }));
  const sha = crypto.createHash('sha256').update(fs.readFileSync(brief)).digest('hex');
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(brief, past, past);
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  if (manifest) fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ schemaVersion: 1, lithermes: { brief: { path: brief, sha256: sha }, round, mode } }));
  if (report) fs.writeFileSync(path.join(out, 'gate-report.txt'), `lit-typographic-motion — render report\nQA gate: ${failed.length ? 'FAIL' : 'PASS'}\nfailed rules: ${failed.join(', ') || 'none'}\n${withheldText ? 'WITHHELD: the WCAG 2.3.1 flash gate failed; the MP4, preview and poster are diagnostics only and must not be delivered.\n' : ''}`);
  if (at === 'deliverable') for (const name of ARTIFACTS) fs.writeFileSync(path.join(out, name), name);
  if (at === 'withheld') { fs.mkdirSync(path.join(out, 'withheld')); for (const name of ARTIFACTS) fs.writeFileSync(path.join(out, 'withheld', name), name); }
  fs.writeFileSync(path.join(out, 'run-state.json'), JSON.stringify({ exitCode: exit, mode, round, failed, finished: exit !== null }));
  if (staleBrief) { const future = new Date(Date.now() + 60_000); fs.utimesSync(brief, future, future); }
  return { dir, out };
}

const notDone = [
  ['the command only started', { exit: null, at: 'none', report: false, manifest: false }],
  ['--stills-only', { exit: 0, mode: 'stills-only', at: 'none', report: false }],
  ['BLOCKED exit 10', { exit: 10, at: 'none', report: false }],
  ['BLOCKED exit 14', { exit: 14, at: 'none', report: false, manifest: false }],
  ['a manifest older than the last scene edit', { exit: 0, staleBrief: true }],
  ['a missing gate report', { exit: 0, report: false }],
  ['exit 13 before round 3', { exit: 13, round: 2, failed: ['MO-C-06'] }],
  ['exit 13 for MO-C-03 with exports at the deliverable names', { exit: 13, round: 3, failed: ['MO-C-03'], at: 'deliverable', withheldText: true }],
];
const done = [
  ['gate 0 with the manifest and four artifacts', { exit: 0 }],
  ['round 3, exit 13 without MO-C-03, artifacts delivered and failed rules named', { exit: 13, round: 3, failed: ['MO-C-06'] }],
  ['round 3, exit 13 with MO-C-03, exports only in withheld/ and the report says withheld', { exit: 13, round: 3, failed: ['MO-C-03'], at: 'withheld', withheldText: true }],
];

for (const [name, state] of notDone) {
  test(`completion does NOT count: ${name}`, async () => {
    const { checkCompletion } = await load();
    const { dir, out } = runDir(state);
    try {
      const result = checkCompletion(out);
      assert.equal(result.done, false, `${name} counted as done: ${result.reason}`);
      assert.ok(result.reason.length > 0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

for (const [name, state] of done) {
  test(`completion counts: ${name}`, async () => {
    const { checkCompletion } = await load();
    const { dir, out } = runDir(state);
    try {
      const result = checkCompletion(out);
      assert.equal(result.done, true, result.reason);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

function previewDir({ pass = true }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-done-'));
  const out = path.join(dir, 'out');
  fs.mkdirSync(path.join(out, 'stills'), { recursive: true });
  fs.writeFileSync(path.join(out, 'treatment.json'), JSON.stringify({ preview: true }));
  fs.writeFileSync(path.join(out, 'stills', 'check.json'), JSON.stringify({ rules: [{ id: 'text-overlap', status: pass ? 'PASS' : 'FAIL', detail: pass ? 'no overlap' : 'overlap' }] }));
  if (pass) fs.writeFileSync(path.join(out, 'stills', 'board.png'), 'board');
  fs.writeFileSync(path.join(out, 'run-state.json'), JSON.stringify({ exitCode: 0, mode: 'stills-only', round: 1, failed: [], finished: true }));
  return { dir, out };
}

test('completion counts: a preview film is done at its board', async () => {
  const { checkCompletion } = await load();
  const { dir, out } = previewDir({ pass: true });
  try {
    const result = checkCompletion(out);
    assert.equal(result.done, true, result.reason);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('completion does NOT count: a preview film whose board check failed', async () => {
  const { checkCompletion } = await load();
  const { dir, out } = previewDir({ pass: false });
  try {
    const result = checkCompletion(out);
    assert.equal(result.done, false);
    assert.ok(result.reason.length > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('completion records a downgrade but still counts the render', async () => {
  const { checkCompletion } = await load();
  const { dir, out } = runDir({ exit: 0 });
  try {
    fs.mkdirSync(path.join(out, '.run'), { recursive: true });
    fs.writeFileSync(path.join(out, '.run', 'treatment-first.json'), JSON.stringify({ durationSec: 20, path: 'stage', sound: { mode: 'score' }, visualDevices: [{ role: 'subject', beats: [0, 1, 2, 3] }] }));
    fs.writeFileSync(path.join(out, 'treatment.json'), JSON.stringify({ durationSec: 10, path: 'stage', sound: { mode: 'score' }, visualDevices: [{ role: 'subject', beats: [0] }] }));
    const result = checkCompletion(out);
    assert.equal(result.done, true, result.reason);
    assert.ok(result.downgraded.length > 0, 'the shortened film is recorded as downgraded');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
