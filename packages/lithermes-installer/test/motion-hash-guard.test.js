import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonical, forbidden, scanEngineKeys, scanPaths } from './scripts/motion-forbidden-hashes.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '..', '..');

test('the forbidden-hash guard has all 61 canonical rows plus the 5 method-only and Hershey hashes', () => {
  assert.equal(canonical.length, 61);
  assert.equal(forbidden.size, 66);
  for (const hash of ['70da9c14dedbc4bba92906967f0b4e3cab024855ac740d2e89eb3a90ba983acc', 'ac2f817836a14789b2f17e8e834714600621b316862bc855defd9f24785c5e8a',
    'a7b9cb8f6465a66d7b1b2f774579749edf1f960b0ed929f0908bd97211f479fa', 'bc0cbdca869d455d000e9961cca0191843cc1c2d7e134a732be2b5081b32eb3b', '63e5c88e6fd3a1c2b9a3c90b239c7af3086a15df80373cac80daedbf29b0c04a']) {
    assert.ok(forbidden.has(hash), hash);
  }
});

test('hashing follows symlinks, so a linked forbidden file is still caught', () => {
  const home = mkdtempSync(join(tmpdir(), 'motion-hash-'));
  try {
    const source = join(home, 'source');
    const link = join(home, 'link');
    writeFileSync(source, 'fixture bytes');
    symlinkSync(source, link);
    const expected = createHash('sha256').update(readFileSync(source)).digest('hex');
    assert.deepEqual(scanPaths([link], new Set([expected])), [{ path: link, digest: expected }]);
    assert.deepEqual(scanPaths([link], new Set()), []);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('no tracked file matches a forbidden hash', () => {
  const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'buffer' });
  assert.equal(tracked.status, 0);
  const files = tracked.stdout.toString().split('\0').filter(Boolean).map((p) => join(repoRoot, p)).filter((p) => existsSync(p));
  assert.ok(files.length > 500);
  assert.deepEqual(scanPaths(files), []);
});

test('the extracted pack tarball holds no forbidden hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'motion-pack-'));
  try {
    const packed = spawnSync('npm', ['pack', '--ignore-scripts', '--pack-destination', dir, '--json'], { cwd: packageRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(packed.status, 0, packed.stderr);
    const tarball = join(dir, JSON.parse(packed.stdout)[0].filename);
    const extract = spawnSync('tar', ['-xzf', tarball, '-C', dir]);
    assert.equal(extract.status, 0);
    assert.deepEqual(scanPaths([join(dir, 'package')]), []);
    assert.deepEqual(scanEngineKeys(join(dir, 'package', 'assets', 'lithermes-plugin', 'skills', 'lit-typographic-motion', 'engine')), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the pre-warmed cache holds no forbidden hash (Hershey trio included)', (t) => {
  const xdg = process.env.LITHERMES_MOTION_TEST_XDG;
  if (!xdg || !existsSync(join(xdg, 'lithermes', 'motion'))) {
    t.skip('LITHERMES_MOTION_TEST_XDG does not name a pre-warmed motion cache');
    return;
  }
  assert.deepEqual(scanPaths([join(xdg, 'lithermes', 'motion')]), []);
});

test('shipped engine files carry none of the method-only scene-id keys', () => {
  assert.deepEqual(scanEngineKeys(join(packageRoot, 'assets', 'lithermes-plugin', 'skills', 'lit-typographic-motion', 'engine')), []);
  assert.deepEqual(scanEngineKeys(join(packageRoot, 'assets', 'lithermes-plugin', 'skills', 'lit-typographic-motion', 'bin')), []);
});
