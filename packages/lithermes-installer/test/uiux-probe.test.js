import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const driver = join(root, 'assets/lithermes-plugin/skills/frontend-ui-ux/scripts/probe.mjs');

test('static fallback reports detectable patterns and leaves rendered rules unverified', () => {
  const out = mkdtempSync(join(tmpdir(), 'lithermes-uiux-'));
  try {
    const fixture = join(root, 'test/fixtures/uiux-probe/sloppy.html');
    const run = spawnSync(process.execPath, [driver, '--static', fixture, '--out', out], { encoding: 'utf8' });
    assert.equal(run.status, 2, run.stderr);
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    assert.deepEqual(Object.keys(report).sort(), ['findings', 'manifest']);
    assert.equal(report.manifest.blocked_reason, 'browser unavailable');
    assert.equal(report.manifest.url, null);
    assert.equal(report.manifest.browser_version, null);
    assert.ok(report.findings.every((finding) => finding.viewport === 'static' && /:\d+$/.test(finding.selector)));
    assert.ok(report.findings.some(({ rule }) => rule === 'SLOP-058'));
    assert.ok(report.findings.some(({ rule, severity }) => rule === 'CF-503' && severity === 'LOW'));
    assert.ok(report.manifest.not_verified.some(({ rule }) => rule === 'CF-201'));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('clean static fixture has no detected anti-patterns', () => {
  const out = mkdtempSync(join(tmpdir(), 'lithermes-uiux-'));
  try {
    const fixture = join(root, 'test/fixtures/uiux-probe/clean.html');
    const run = spawnSync(process.execPath, [driver, '--static', fixture, '--out', out], { encoding: 'utf8' });
    assert.equal(run.status, 2, run.stderr);
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    assert.deepEqual(report.findings, []);
    assert.ok(report.manifest.not_verified.length > 0);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('missing browser capability blocks and preserves static findings', () => {
  const out = mkdtempSync(join(tmpdir(), 'lithermes-uiux-'));
  try {
    const fixture = join(root, 'test/fixtures/uiux-probe/sloppy.html');
    const run = spawnSync(process.execPath, [driver, '--url', 'http://127.0.0.1:9/sloppy.html',
      '--static', fixture, '--out', out], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
    assert.equal(run.status, 2, run.stderr);
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    assert.equal(report.manifest.blocked_reason, 'browser unavailable');
    assert.ok(report.findings.some((finding) => finding.rule === 'SLOP-058'));
    assert.ok(report.manifest.not_verified.some(({ rule }) => rule === 'RS-006'));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('static fallback scans a project directory', () => {
  const out = mkdtempSync(join(tmpdir(), 'lithermes-uiux-'));
  try {
    const source = join(root, 'test/fixtures/uiux-probe');
    const run = spawnSync(process.execPath, [driver, '--static', source, '--out', out], { encoding: 'utf8' });
    assert.equal(run.status, 2, run.stderr);
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    assert.ok(report.findings.some((finding) => finding.rule === 'SLOP-058'));
    assert.ok(report.findings.some((finding) => finding.rule === 'CF-503'));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('rendered fixtures distinguish a broken page from a clean page', async (t) => {
  const capability = spawnSync('python3', [join(root, 'assets/lithermes-plugin/skills/browser-drive/scripts/capability_probe.py')],
    { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  if (capability.status !== 0) return t.skip('agent-browser is unavailable or its identity is unverified');
  const fixtureRoot = join(root, 'test/fixtures/uiux-probe');
  const server = createServer((request, response) => {
    const name = request.url === '/sloppy.html' ? 'sloppy.html' : 'clean.html';
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(readFileSync(join(fixtureRoot, name)));
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const out = mkdtempSync(join(tmpdir(), 'lithermes-uiux-'));
  const isolatedHome = join(out, 'long-isolated-browser-home-for-socket-regression');
  mkdirSync(isolatedHome, { recursive: true });
  const invoke = (name) => new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [driver, '--url', `http://127.0.0.1:${server.address().port}/${name}.html`,
      '--static', join(fixtureRoot, `${name}.html`), '--out', join(out, name)],
      { env: { ...process.env, HOME: isolatedHome } });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', rejectRun);
    child.on('close', (status) => resolveRun({ status, stderr }));
  });
  try {
    const broken = await invoke('sloppy');
    assert.equal(broken.status, 1, broken.stderr);
    const brokenReport = JSON.parse(readFileSync(join(out, 'sloppy/report.json'), 'utf8'));
    for (const rule of ['RS-006', 'RS-007', 'CF-201', 'CF-701', 'SLOP-058', 'CF-503'])
      assert.ok(brokenReport.findings.some((finding) => finding.rule === rule), `missing ${rule}`);
    assert.ok(brokenReport.findings.some(({ rule, severity }) => rule === 'SLOP-040' && severity === 'MEDIUM'));
    assert.ok(brokenReport.findings.some(({ rule, severity }) => rule === 'SLOP-036' && severity === 'MEDIUM'));
    assert.ok(brokenReport.findings.some(({ rule, severity }) => rule === 'SLOP-059' && severity === 'HIGH'));
    assert.ok(brokenReport.findings.filter(({ rule }) => rule.startsWith('SLOP-')).every(({ rule, severity }) =>
      severity !== 'HIGH' || ['SLOP-057', 'SLOP-058', 'SLOP-059'].includes(rule)));
    assert.ok(brokenReport.findings.filter(({ rule }) => rule === 'CF-503').every(({ severity }) => severity !== 'HIGH'));
    assert.equal(brokenReport.manifest.screenshots.length, 7);
    const clean = await invoke('clean');
    assert.equal(clean.status, 0, clean.stderr);
    const cleanReport = JSON.parse(readFileSync(join(out, 'clean/report.json'), 'utf8'));
    assert.equal(cleanReport.findings.filter((finding) => finding.severity === 'HIGH').length, 0);
  } finally {
    server.close();
    rmSync(out, { recursive: true, force: true });
  }
});
