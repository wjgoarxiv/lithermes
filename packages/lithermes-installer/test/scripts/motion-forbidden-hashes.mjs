#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = join(root, 'test', 'fixtures', 'motion-forbidden-sha256.txt');
export const canonical = readFileSync(fixture, 'utf8').trim().split('\n').map(line => line.split(/\s+/)[0]);
if (canonical.length !== 61 || !canonical.every(value => /^[0-9a-f]{64}$/.test(value))) throw new Error('Expected exactly 61 canonical forbidden hashes');
export const forbidden = new Set([...canonical,
  '70da9c14dedbc4bba92906967f0b4e3cab024855ac740d2e89eb3a90ba983acc',
  'ac2f817836a14789b2f17e8e834714600621b316862bc855defd9f24785c5e8a',
  'a7b9cb8f6465a66d7b1b2f774579749edf1f960b0ed929f0908bd97211f479fa',
  'bc0cbdca869d455d000e9961cca0191843cc1c2d7e134a732be2b5081b32eb3b',
  '63e5c88e6fd3a1c2b9a3c90b239c7af3086a15df80373cac80daedbf29b0c04a',
]);

export function scanPaths(paths, hashes = forbidden) {
  const offenders = [];
  const seenDirectories = new Set();
  const visit = path => {
    if (!existsSync(path)) return;
    const resolved = realpathSync(path);
    const metadata = statSync(resolved);
    if (metadata.isDirectory()) {
      if (seenDirectories.has(resolved)) return;
      seenDirectories.add(resolved);
      for (const name of readdirSync(resolved)) visit(join(resolved, name));
    } else if (metadata.isFile()) {
      const digest = createHash('sha256').update(readFileSync(resolved)).digest('hex');
      if (hashes.has(digest)) offenders.push({ path, digest });
    }
  };
  for (const path of paths) visit(path);
  return offenders;
}

export function scanEngineKeys(directory) {
  const offenders = [];
  const keys = /\b(?:shoggoth|paperclips|leftturn|ilya)\b/i;
  const visit = path => {
    const stat = statSync(path);
    if (stat.isDirectory()) for (const name of readdirSync(path)) visit(join(path, name));
    else if (stat.isFile() && /\.(?:mjs|js|ts|json)$/.test(path) && keys.test(readFileSync(path, 'utf8'))) offenders.push(path);
  };
  visit(directory);
  return offenders;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: resolve(root, '..', '..'), encoding: 'buffer' });
  if (tracked.status !== 0) throw new Error('git ls-files failed');
  const repo = resolve(root, '..', '..');
  const files = tracked.stdout.toString().split('\0').filter(Boolean).map(path => join(repo, path));
  const paths = [...files, ...process.argv.slice(2).map(path => resolve(path))];
  const offenders = scanPaths(paths);
  offenders.push(...scanEngineKeys(join(root, 'assets', 'lithermes-plugin', 'skills', 'lit-typographic-motion', 'engine')).map(path => ({ path, digest: 'scene-id key' })));
  if (offenders.length) { for (const row of offenders) console.error(`${row.digest} ${row.path}`); process.exitCode = 1; }
  else console.log(`motion forbidden-hash guard PASS (${canonical.length} canonical + 5 extra hashes; ${paths.length} roots)`);
}
