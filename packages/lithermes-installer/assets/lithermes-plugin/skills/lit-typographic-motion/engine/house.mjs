// The house file: `motion-house.json` beside a film's output folder, in the user's directory.
// A full render that passes its gate writes it, or appends the film to it. While it exists,
// the treatment validator holds every new film in that folder to its style unless the request
// names another. It is validator input, so the second film inherits the first one's style
// without anyone having to carry it over.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { STYLE_IDS } from './styles.mjs';

export const HOUSE_FILE = 'motion-house.json';
export const HOUSE_SCHEMA = 'litfamily.motion-house/v1';
const MAX_FILMS = 50;

export const houseFileFor = (out) => path.join(path.dirname(path.resolve(out)), HOUSE_FILE);

/** The house record for an output folder, or null when missing or unusable. */
export function readHouse(out) {
  const file = houseFileFor(out);
  if (!existsSync(file)) return null;
  try {
    const house = JSON.parse(readFileSync(file, 'utf8'));
    if (house?.schema !== HOUSE_SCHEMA || !STYLE_IDS.includes(house.style)) return null;
    return house;
  } catch {
    return null;
  }
}

/**
 * Record a passed film. The first film fixes the house style; later films append. A film
 * whose style the request named outright appends without moving the house style.
 */
export function recordHouse(out, { style, path: renderPath, format, durationSec, now = new Date() }) {
  const file = houseFileFor(out);
  const house = readHouse(out) ?? { schema: HOUSE_SCHEMA, style, createdAt: now.toISOString(), films: [] };
  const dir = path.basename(path.resolve(out));
  const films = (Array.isArray(house.films) ? house.films : []).filter((film) => film?.dir !== dir);
  films.push({ dir, style, path: renderPath, format, durationSec, at: now.toISOString() });
  const next = { ...house, films: films.slice(-MAX_FILMS) };
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, file);
  return next;
}
