// The cover treatment: treatment.json with "mode": "cover" (references/cover.md). A cover is not
// a film. It has no beats, no arc, no end card, no sound and no copy lines; it names a recipe, one
// rule copied many times, three speed layers, the brand word set once (plus at most one motto the
// user or the project already uses), the aspect and loop length, and the title box the contrast
// and cap-height gates measure. Every cover render validates it and stops with exit 16 naming the
// first bad field. Its text is the user's content, never instructions.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COVER, EXIT } from './constants.mjs';
import { normalizeText, sharesSubstring } from './treatment.mjs';

export const RECIPES = Object.freeze(['painted-light', 'weight-tide', 'orbit-loop', 'own']);
const PLACEHOLDER = /<[^<>\n]{1,80}>|^\s*(?:todo|tbd|xxx|\.\.\.|…)\s*$/iu;

class Invalid extends Error {
  constructor(field, message) { super(message); this.field = field; }
}
const need = (cond, field, message) => { if (!cond) throw new Invalid(field, message); };
const sentences = (value) => String(value).trim().split(/(?<=[.!?。])\s+/u).filter((s) => s.trim()).length;
const words = (value) => String(value).trim().split(/\s+/u).filter(Boolean).length;
const isBox = (b) => Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === 'number' && v >= 0 && v <= 1)
  && b[2] > 0 && b[3] > 0 && b[0] + b[2] <= 1 + 1e-9 && b[1] + b[3] <= 1 + 1e-9;

function prose(t, path, { max = 2 } = {}) {
  const value = path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), t);
  need(typeof value === 'string' && value.trim(), path, `${path} is required (a non-empty string)`);
  need(!PLACEHOLDER.test(value), path, `${path} is a placeholder (${JSON.stringify(value.slice(0, 40))})`);
  need(sentences(value) <= max, path, `${path} takes at most ${max} sentence(s)`);
  return value;
}

function check(t) {
  need(t && typeof t === 'object' && !Array.isArray(t), 'treatment', 'treatment.json must be a JSON object');
  need(t.mode === 'cover', 'mode', 'a cover render needs "mode": "cover"');
  prose(t, 'request', { max: 20 });
  prose(t, 'idea', { max: 1 });
  need(!sharesSubstring(t.idea, t.request), 'idea', 'idea restates the request; say what the loop does');
  need(RECIPES.includes(t.recipe), 'recipe', `recipe must be one of ${RECIPES.join(', ')}`);
  prose(t, 'recipeReason');
  prose(t, 'brandWord', { max: 1 });
  need(words(t.brandWord) <= 3, 'brandWord', 'brandWord is the name set once: at most three words');
  if (t.motto !== undefined) {
    need(t.motto && typeof t.motto === 'object', 'motto', 'motto must be { text, source }');
    prose(t, 'motto.text', { max: 1 });
    need(words(t.motto.text) <= 6, 'motto.text', 'motto.text takes at most six words');
    need(['user', 'project'].includes(t.motto.source), 'motto.source', 'motto.source is user (it appears in the request) or project (with from)');
    if (t.motto.source === 'user') need(normalizeText(t.request).includes(normalizeText(t.motto.text)), 'motto.text', 'a user motto appears in the request; a cover never invents a tagline');
    else prose(t, 'motto.from');
  }
  for (const key of ['copy', 'beats', 'lines']) need(t[key] === undefined, key, `${key}: a cover has no copy lines and no beats; the brand word is set once and never swapped`);
  need(t.sound === undefined || t.sound === 'none' || t.sound?.mode === 'none', 'sound', 'a cover is silent: leave sound out or set it to none');
  need(Object.hasOwn(COVER.aspects, t.aspect), 'aspect', `aspect must be ${Object.keys(COVER.aspects).join(' or ')}`);
  need(typeof t.loopSec === 'number' && t.loopSec >= COVER.minSec && t.loopSec <= COVER.maxSec, 'loopSec', `loopSec must be ${COVER.minSec}-${COVER.maxSec} seconds`);
  need(COVER.fps.includes(t.fps), 'fps', `fps must be one of ${COVER.fps.join(', ')}`);
  need(t.layers && typeof t.layers === 'object', 'layers', 'layers names what moves on the slow, mid and beat layers');
  for (const k of ['slow', 'mid', 'beat']) prose(t, `layers.${k}`);
  need(t.system && typeof t.system === 'object', 'system', 'system names the one rule, its copies and where their offsets come from');
  for (const k of ['rule', 'copies', 'offset']) prose(t, `system.${k}`);
  need(t.title && typeof t.title === 'object', 'title', 'title is { box: [x, y, w, h] in cover fractions, kind: live or painted }');
  need(isBox(t.title.box), 'title.box', 'title.box is [x, y, w, h], fractions of the cover, inside it');
  need(['live', 'painted'].includes(t.title.kind), 'title.kind', 'title.kind is live (set as text) or painted (part of the base art)');
  if (t.palette !== undefined) {
    need(Array.isArray(t.palette) && t.palette.length >= 2 && t.palette.length <= 6, 'palette', 'palette takes 2-6 { color, role } entries');
    t.palette.forEach((p, i) => {
      need(/^#[0-9a-f]{6}$/iu.test(p?.color ?? ''), `palette[${i}].color`, 'a colour is #rrggbb');
      need(typeof p?.role === 'string' && p.role.trim(), `palette[${i}].role`, 'say the colour\'s job');
    });
  }
  if (t.encode !== undefined) {
    need(t.encode && typeof t.encode === 'object', 'encode', 'encode is { q, edgeQ, edgeFrames }');
    for (const [k, lo, hi] of [['q', 50, 100], ['edgeQ', 50, 100], ['edgeFrames', 0, 60]]) {
      if (t.encode[k] !== undefined) need(Number.isInteger(t.encode[k]) && t.encode[k] >= lo && t.encode[k] <= hi, `encode.${k}`, `encode.${k} is an integer ${lo}-${hi}`);
    }
  }
  if (t.seed !== undefined) need(Number.isInteger(t.seed) && t.seed >= 0, 'seed', 'seed is a non-negative integer');
  prose(t, 'ambition');
}

// { ok, field, message }; a valid treatment also returns the derived render plan.
export function validateCoverTreatment(t) {
  try {
    check(t);
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, field: error.field, message: error.message };
    return { ok: false, field: 'treatment', message: `treatment could not be read: ${error.message}` };
  }
  const { page, size } = COVER.aspects[t.aspect];
  return { ok: true, plan: { page, size, frames: Math.round(t.loopSec * t.fps), encode: { ...COVER.encode, ...(t.encode || {}) }, seed: t.seed ?? 20261020 } };
}

export const isCoverTreatment = (t) => Boolean(t && typeof t === 'object' && t.mode === 'cover');

// Read and validate <out>/treatment.json as a cover; a failure is exit 16 naming the field.
export function loadCoverTreatment(out) {
  const file = join(out, 'treatment.json');
  const blocked = (field, message) => Object.assign(new Error(`BLOCKED_TREATMENT_INVALID: field ${field}: ${message}`), { exitCode: EXIT.BLOCKED_TREATMENT_INVALID, field });
  if (!existsSync(file)) throw blocked('treatment', `no treatment.json in ${out}; write the cover treatment first (references/cover.md)`);
  let t;
  try { t = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { throw blocked('treatment', `treatment.json is not valid JSON: ${error.message}`); }
  if (!isCoverTreatment(t)) throw blocked('mode', 'this treatment is a film; render it with `stage` or `run` (a cover treatment sets "mode": "cover")');
  const result = validateCoverTreatment(t);
  if (!result.ok) throw blocked(result.field, result.message);
  return { treatment: t, file, ...result.plan };
}
