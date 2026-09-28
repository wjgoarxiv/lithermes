// Director-wave state shared by both render paths: the first valid treatment
// (the done-check compares against it) and the run-state file every command
// leaves behind.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

export function recordFirstTreatment(out, treatment) {
  const dir = join(out, '.run');
  const first = join(dir, 'treatment-first.json');
  if (existsSync(first)) return first;
  mkdirSync(dir, { recursive: true });
  if (existsSync(join(out, 'treatment.json'))) copyFileSync(join(out, 'treatment.json'), first);
  else writeJson(first, treatment);
  return first;
}

export function writeRunState(out, state) {
  mkdirSync(out, { recursive: true });
  writeJson(join(out, 'run-state.json'), { ...state, finishedAt: new Date().toISOString() });
}

// Every stills file look.json lists as viewed, across rounds. Read fresh on
// each report, so a gate rerun never resets the count.
export function viewedFiles(out) {
  const file = join(out, 'look.json');
  if (!existsSync(file)) return [];
  try {
    const look = JSON.parse(readFileSync(file, 'utf8'));
    return [...new Set((look.rounds || []).flatMap((r) => (r.frames || []).map((f) => f.file)))];
  } catch { return []; }
}
