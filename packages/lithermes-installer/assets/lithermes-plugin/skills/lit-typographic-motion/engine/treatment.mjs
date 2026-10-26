// treatment.json: the film's plan, written before any render on either path.
// The validator runs before every render (stills-only too) and names the first
// field that breaks a rule; the CLI turns that into exit 16. It checks shape and
// the anti-restatement rules, never taste: taste is the look rounds' job.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYOUT_IDS, pickStyle, readStyle, styleColors, styleFamilies } from './styles.mjs';
import { readHouse } from './house.mjs';
import { EVENT_SOUNDS } from './sound.mjs';
import { SCORE_GENRES } from './score.mjs';

export const GENRES = Object.freeze(['announcement', 'brand-mood', 'event', 'explainer', 'motion-graphics', 'type-led', 'other']);
export const ARC_STAGES = Object.freeze({ announcement: 5, 'brand-mood': 4, event: 4, explainer: 4, 'motion-graphics': 5, other: 3 });
export const DEVICE_KINDS = Object.freeze(['illustration', 'diagram', 'chart', 'icon', 'shape', 'path', 'mask', 'depth3d', 'particles', 'grid', 'gradient', 'photo-texture']);
export const TEXTURE_KINDS = Object.freeze(['grid', 'gradient', 'particles', 'photo-texture']);
export const FORMATS = Object.freeze({ '16:9': [1920, 1080], '9:16': [1080, 1920] });
export const SOUND_MODES = Object.freeze(['score', 'generated', 'supplied', 'authored', 'none']);
export const EVENT_OFF_CUT_SEC = 0.1;
// The families fonts.css serves; the type engine draws from the same set.
export const FACES = Object.freeze(['Pretendard', 'Archivo', 'Galmuri9', 'VT323', 'Silkscreen', 'MesloLGS NF']);
export const SOUND_PALETTES = Object.freeze(['soft-mallet', 'warm-keys', 'glass-pulse', 'low-strings']);
export const PROTAGONIST_KINDS = Object.freeze(['character', 'object']);
// A rich stage film plans its density before any page exists: the depth layers
// of its world, the labelled parts the viewer reads and the camera moves.
export const RICH_WORLD = Object.freeze({ layers: 3, labels: 6, labelWords: 4, cameraShare: 0.5 });
const LOCKED_CAMERA = /^\s*(?:none|locked|static|still|hold|fixed|no move)\s*\.?\s*$/iu;
// A bare deferred-work marker with no value: the global placeholder sweep only
// sees <angle> markers, so story, protagonist and world fields check this too.
const BARE_PLACEHOLDER = /^\s*(?:todo|tbd|tk|xxx|\.\.\.|…)\s*$/iu;
const FLOOR_GENRES = new Set(['announcement', 'event', 'explainer', 'motion-graphics']);
const MIN_BEAT_SEC = 1.2;
const MAX_GAP_SEC = 0.25;
const REGISTERS = Object.freeze(['rich', 'minimal']);
// The request asks for a calm, quiet or minimal film: the one case the minimal register is for.
const MINIMAL_ASKED = /미니멀|잔잔|차분|조용|심플|절제|단순하게|고요|\bminimal(?:ist|ism)?\b|\bcalm\b|\bquiet\b|\bsimple\b|\bunderstated\b|\brestrained\b|\bsparse\b|\bserene\b/iu;
const PREVIEW_ASKED = /미리\s?보기|스토리보드|콘티|\bpreview\b|\bstoryboard\b/iu;

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const normalizeText = (value) => String(value ?? '').normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const QUOTED = /"[^"\n]*"|“[^”\n]*”|(?<![A-Za-z])'[^'\n]*'(?![A-Za-z])|「[^」\n]*」/gu;
export const withoutQuoted = (value) => String(value ?? '').replace(QUOTED, ' ');

// Port of this product's router cue (core_routing.motion_cue): a type compound,
// an explicit kinetic-type or lyric ask, or a quoted span of two or more words.
const TYPE_CUE = /타이포\s*모션|키네틱\s*타이포(?:그래피)?|타이포(?:그래피)?\s*영상|가사\s*영상|리릭\s*(?:비디오|영상)|타이틀\s*시퀀스|오프닝\s*타이틀|(?<![A-Za-z])(?:kinetic\s+type(?:graphy)?|typographic\s+motion|typography\s+videos?|lyric\s+videos?|title\s+sequences?|opening\s+titles?)(?![A-Za-z])/iu;
export function typeCue(request) {
  const value = String(request ?? '');
  const compound = value.match(TYPE_CUE);
  if (compound) return compound[0];
  for (const span of value.match(QUOTED) || []) {
    if (span.slice(1, -1).trim().split(/\s+/u).length >= 2) return span;
  }
  return null;
}

const SILENT_REQUEST = /무음|소리\s*없|음악\s*없|(?<![A-Za-z])(?:silent|silence|no\s+(?:sound|music|audio)|without\s+(?:sound|music|audio)|muted?)(?![A-Za-z])/iu;
const LENGTH_REQUEST = /\d+(?:\.\d+)?\s*(?:초|분|s\b|sec|secs|seconds?|min|minutes?)/iu;

// The shared-substring limit: min(10, half the normalized request length).
export function restatementLimit(request) {
  return Math.min(10, Math.floor(normalizeText(withoutQuoted(request)).length / 2));
}

export function sharesSubstring(text, request, limit = restatementLimit(request)) {
  if (limit < 2) return false;
  const a = normalizeText(text), b = normalizeText(withoutQuoted(request));
  const chars = Array.from(a);
  for (let i = 0; i + limit <= chars.length; i++) if (b.includes(chars.slice(i, i + limit).join(''))) return true;
  return false;
}

// Free-text leaves the copiedExample rule compares.
export function freeTextLeaves(t) {
  const leaves = [t?.idea, t?.audience, t?.channel, t?.ambition];
  for (const beat of Array.isArray(t?.beats) ? t.beats : []) leaves.push(beat?.purpose, beat?.onScreen, beat?.motion, beat?.sound, beat?.hero);
  for (const key of ['expect', 'turn', 'payoff']) leaves.push(t?.story?.[key]);
  leaves.push(t?.protagonist?.look);
  for (const act of Array.isArray(t?.protagonist?.acts) ? t.protagonist.acts : []) leaves.push(act?.action);
  for (const line of Array.isArray(t?.copy?.lines) ? t.copy.lines : []) leaves.push(line);
  for (const entry of Array.isArray(t?.palette) ? t.palette : []) leaves.push(entry?.role);
  return leaves.filter((v) => typeof v === 'string').map(normalizeText).filter(Boolean);
}

// Every JSON example shipped in the references. They use placeholders, so an
// example never validates as it stands; copying one is caught before that.
export function shippedExamples(root = skillRoot) {
  const out = [];
  for (const ref of ['treatment.md', 'stage.md']) {
    const file = join(root, 'references', ref);
    if (!existsSync(file)) continue;
    for (const block of readFileSync(file, 'utf8').matchAll(/```json\n([\s\S]*?)```/g)) {
      try {
        const parsed = JSON.parse(block[1]);
        if (parsed && typeof parsed === 'object' && 'beats' in parsed) out.push(parsed);
      } catch { /* a non-JSON snippet is documentation, not an example */ }
    }
  }
  return out;
}

const PLACEHOLDER = /<[^<>\n]{1,80}>/u;
function findPlaceholder(value, at) {
  if (typeof value === 'string') return PLACEHOLDER.test(value) ? at : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) { const hit = findPlaceholder(value[i], `${at}[${i}]`); if (hit) return hit; }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) { const hit = findPlaceholder(inner, at ? `${at}.${key}` : key); if (hit) return hit; }
  }
  return null;
}

const text = (value) => typeof value === 'string' && value.trim().length > 0;
const sentences = (value) => String(value).trim().split(/(?<=[.!?。])\s+/u).filter((s) => s.trim());

class Invalid extends Error {
  constructor(field, message) { super(message); this.field = field; }
}
const need = (cond, field, message) => { if (!cond) throw new Invalid(field, message); };

function check(t, { outDir, examples }) {
  need(t && typeof t === 'object' && !Array.isArray(t), 'treatment', 'treatment.json must be a JSON object');
  need(t.mode !== 'cover', 'mode', 'this is a cover treatment; render it with `cover --out DIR` (references/cover.md)');
  for (const field of ['request', 'genre', 'path', 'pathReason', 'style', 'idea', 'audience', 'channel', 'format', 'durationSec', 'beats', 'subject', 'visualDevices', 'typePlan', 'palette', 'sound', 'copy', 'ambition']) {
    need(t[field] !== undefined && t[field] !== null && t[field] !== '', field, `${field} is required`);
  }
  const mine = freeTextLeaves(t);
  for (const example of examples) {
    const theirs = new Set(freeTextLeaves(example));
    const same = mine.filter((leaf) => theirs.has(leaf)).length;
    need(!(mine.length && same * 2 >= mine.length), 'copiedExample', `${same} of ${mine.length} free-text values equal a shipped example; write this film's own treatment`);
  }
  const placeholder = findPlaceholder(t, '');
  need(!placeholder, placeholder, `${placeholder} still holds a <placeholder>; replace it with this film's value`);

  need(text(t.request), 'request', 'request must be the user\'s words, verbatim');
  need(GENRES.includes(t.genre), 'genre', `genre must be one of ${GENRES.join(', ')}`);
  need(['type', 'stage'].includes(t.path), 'path', 'path must be type or stage');
  need(text(t.pathReason), 'pathReason', 'pathReason must say why this path fits');
  const house = outDir ? readHouse(outDir) : null;
  const pick = pickStyle({ request: t.request, copy: Array.isArray(t.copy?.lines) ? t.copy.lines : [], path: t.path, house, genre: t.genre });
  need('style' in t, 'style', 'missing: one of swiss-signal, tidal, terminalcore, paper (references/studio.md)');
  need(['swiss-signal', 'tidal', 'terminalcore', 'paper'].includes(t.style), 'style', 'must be one of swiss-signal, tidal, terminalcore, paper');
  if (t.path === 'type' && t.style === 'paper') need(false, 'style', 'paper is stage-only; the type path takes swiss-signal, tidal or terminalcore');
  need(t.style === pick.id, 'style', `${pick.reason}; this film takes the ${pick.id} style`);
  const register = t.register ?? 'rich';
  need(REGISTERS.includes(register), 'register', 'rich (the default) or minimal');
  need(!(register === 'minimal' && !MINIMAL_ASKED.test(t.request)), 'register', 'minimal only when the request asks for a calm, quiet or minimal film; the default is rich (references/studio.md, Register)');
  need(!(register === 'rich' && MINIMAL_ASKED.test(t.request)), 'register', 'the request asks for a calm or minimal film: register minimal');
  if (t.preview === true) need(PREVIEW_ASKED.test(t.request), 'preview', 'true only when the request asks for a preview or storyboard first');
  need(Object.hasOwn(FORMATS, t.format), 'format', 'format must be 16:9 or 9:16');
  need(text(t.formatReason), 'formatReason', 'formatReason must tie the format to the channel');
  need(text(t.audience), 'audience', 'audience must say who watches');
  need(text(t.channel), 'channel', 'channel must say where it plays');

  need(text(t.idea) && sentences(t.idea).length === 1, 'idea', 'idea must be one sentence');
  need(!sharesSubstring(t.idea, t.request), 'idea', `idea restates the request (a shared run of ${restatementLimit(t.request)} or more characters); say the film's own idea`);
  need(text(t.ambition) && sentences(t.ambition).length <= 2, 'ambition', 'ambition must be one or two sentences in craft terms');

  const copy = t.copy;
  need(copy && ['user', 'invented'].includes(copy.source), 'copy.source', 'copy.source must be user or invented');
  need(Array.isArray(copy.lines) && copy.lines.length > 0 && copy.lines.every(text), 'copy.lines', 'copy.lines must be a non-empty list of lines');
  const request = normalizeText(t.request);
  copy.lines.forEach((line, i) => {
    if (copy.source === 'user') need(request.includes(normalizeText(line)), `copy.lines[${i}]`, `copy.lines[${i}] is marked user but is not in the request; mark the copy invented or use the user's words`);
    else need(!sharesSubstring(line, t.request), `copy.lines[${i}]`, `copy.lines[${i}] restates the request; write copy from subject.specifics`);
  });

  const cue = typeCue(t.request);
  if (t.path === 'type') {
    need(t.format === '16:9', 'path', 'a 9:16 film always takes the stage path');
    need(copy.source === 'user' || cue, 'path', 'the type path needs the user\'s own words or a type-led cue in the request; take the stage path');
  }

  const d = t.durationSec;
  need(typeof d === 'number' && Number.isFinite(d) && d >= 4 && d <= 90, 'durationSec', 'durationSec must be 4 to 90');
  if (FLOOR_GENRES.has(t.genre) && !LENGTH_REQUEST.test(t.request)) need(d >= 10, 'durationSec', `a ${t.genre} film runs at least 10 s unless the user asked for a length`);

  const beats = t.beats;
  need(Array.isArray(beats) && beats.length > 0, 'beats', 'beats must be a list');
  const arc = t.genre === 'type-led' ? copy.lines.length : ARC_STAGES[t.genre];
  need(beats.length >= arc, 'beats', `a ${t.genre} arc needs at least ${arc} beats; this has ${beats.length}`);
  let cursor = 0;
  beats.forEach((beat, i) => {
    const at = `beats[${i}]`;
    need(beat && typeof beat.t0 === 'number' && typeof beat.t1 === 'number', at, `${at} needs numeric t0 and t1`);
    for (const key of ['purpose', 'onScreen', 'motion', 'sound']) need(text(beat[key]), `${at}.${key}`, `${at}.${key} is required`);
    if (t.path === 'stage') {
      const style = readStyle(t.style);
      need(LAYOUT_IDS.includes(beat.layout), `${at}.layout`, `${at}.layout must be one of ${LAYOUT_IDS.join(', ')}`);
      need(text(beat.hero) && !PLACEHOLDER.test(String(beat.hero)), `${at}.hero`, `${at}.hero names the one move the eye follows in this shot`);
      if (i === beats.length - 1) need(beat.transition === 'end', `${at}.transition`, `${at}.transition: the last shot's transition is end`);
      else need(style.transitions.includes(beat.transition), `${at}.transition`, `${at}.transition: the ${t.style} style hands off with ${style.transitions.join(', ')}`);
      if ('lines' in beat) {
        const count = Array.isArray(t.copy?.lines) ? t.copy.lines.length : 0;
        need(Array.isArray(beat.lines) && beat.lines.every((key) => Number.isInteger(key) && key >= 0 && key < count), `${at}.lines`, `${at}.lines lists the indices of the copy lines this shot shows`);
        need(!(beat.layout === 'full' && beat.lines.length), `${at}.lines`, `${at}.lines: a full shot has no type zone, so it shows no copy`);
      }
    }
    need(beat.t1 - beat.t0 >= MIN_BEAT_SEC - 1e-9, at, `${at} lasts ${(beat.t1 - beat.t0).toFixed(2)} s; every beat is at least ${MIN_BEAT_SEC} s`);
    need(beat.t0 - cursor <= MAX_GAP_SEC + 1e-9, at, `${at} leaves a ${(beat.t0 - cursor).toFixed(2)} s gap; beats cover the film with no gap over ${MAX_GAP_SEC} s`);
    cursor = Math.max(cursor, beat.t1);
  });
  need(d - cursor <= MAX_GAP_SEC + 1e-9 && cursor <= d + MAX_GAP_SEC, 'beats', `beats end at ${cursor} s but the film runs ${d} s`);
  if (t.path === 'stage') {
    for (let i = 1; i < beats.length; i++) {
      need(beats[i].layout !== beats[i - 1].layout, `beats[${i}].layout`, `shots ${i} and ${i + 1} both use ${beats[i].layout}; adjacent shots change layout (references/studio.md)`);
    }
    const used = new Set(beats.map((beat) => beat.layout));
    need(beats.length < 4 || used.size >= 3, 'beats', `${beats.length} shots use only ${[...used].join(' and ')}; a film of four or more shots uses at least three layouts`);
  }

  const story = t.story;
  need(story && typeof story === 'object', 'story', 'story is required: { expect, turn, beat, payoff }: what the viewer expects, what happens instead, the shot where it lands, what the ending gives');
  for (const key of ['expect', 'turn', 'payoff']) {
    need(text(story[key]) && !BARE_PLACEHOLDER.test(story[key]), `story.${key}`, `story.${key} must be a non-empty string`);
    need(sentences(story[key]).length <= 2, `story.${key}`, `story.${key} is at most 2 sentences`);
  }
  need(normalizeText(story.turn) !== normalizeText(story.expect), 'story.turn', 'the turn is what the viewer does not expect; it cannot equal story.expect');
  need(Number.isInteger(story.beat) && story.beat >= 1 && story.beat < beats.length, 'story.beat', `story.beat is the index of the shot where the turn lands: after the opening, before the end (1-${beats.length - 1})`);

  if (t.path === 'stage') {
    const protagonist = t.protagonist;
    need(protagonist && typeof protagonist === 'object', 'protagonist', 'protagonist is required: { name, kind, look, acts[] }: the character or hero object that acts across the film');
    need(text(protagonist.name) && !BARE_PLACEHOLDER.test(protagonist.name), 'protagonist.name', 'protagonist.name must name it');
    need(PROTAGONIST_KINDS.includes(protagonist.kind), 'protagonist.kind', `protagonist.kind must be ${PROTAGONIST_KINDS.join(' or ')}`);
    need(text(protagonist.look) && !BARE_PLACEHOLDER.test(protagonist.look), 'protagonist.look', 'protagonist.look says what it looks like on screen: shape, material, colour role, scale in the frame');
    need(Array.isArray(protagonist.acts) && protagonist.acts.length > 0, 'protagonist.acts', 'protagonist.acts lists what it does, shot by shot: [{ beat, action }]');
    const seen = new Set();
    protagonist.acts.forEach((act, i) => {
      need(Number.isInteger(act?.beat) && act.beat >= 0 && act.beat < beats.length, `protagonist.acts[${i}].beat`, 'protagonist.acts[].beat must be a beat index');
      need(!seen.has(act.beat), `protagonist.acts[${i}].beat`, 'one act per shot');
      seen.add(act.beat);
      need(text(act.action) && !BARE_PLACEHOLDER.test(act.action), `protagonist.acts[${i}].action`, 'say what it does in this shot, as a viewer would see it');
    });
    const covered = [...seen].reduce((sum, b) => sum + (beats[b].t1 - beats[b].t0), 0);
    need(covered >= 0.5 * d - 1e-9, 'protagonist.acts', `it acts for ${covered.toFixed(1)} s, under half the film; it carries the film, not one shot`);
    need(seen.has(story.beat), 'protagonist.acts', `the turn lands at shot ${story.beat + 1}, and the protagonist has no act there`);
  }

  const subject = t.subject;
  need(subject && text(subject.name), 'subject.name', 'subject.name is required');
  need(['user', 'invented'].includes(subject.source), 'subject.source', 'subject.source must be user or invented');
  need(Array.isArray(subject.specifics) && subject.specifics.filter(text).length >= (subject.source === 'invented' ? 2 : 1), 'subject.specifics',
    'an invented subject needs at least 2 concrete specifics (what it is or does, for whom, one distinctive detail)');

  const devices = t.visualDevices;
  need(Array.isArray(devices), 'visualDevices', 'visualDevices must be a list');
  devices.forEach((device, i) => {
    const at = `visualDevices[${i}]`;
    need(DEVICE_KINDS.includes(device?.kind), `${at}.kind`, `${at}.kind must be one of ${DEVICE_KINDS.join(', ')}`);
    need(['subject', 'support', 'texture'].includes(device.role), `${at}.role`, `${at}.role must be subject, support or texture`);
    need(!TEXTURE_KINDS.includes(device.kind) || device.role === 'texture', `${at}.role`, `${device.kind} is always a texture`);
    need(Array.isArray(device.beats) && device.beats.every((b) => Number.isInteger(b) && b >= 0 && b < beats.length), `${at}.beats`, `${at}.beats must list beat indexes`);
  });
  if (t.path === 'stage') {
    const subjects = devices.filter((device) => device.role === 'subject');
    need(subjects.length > 0, 'visualDevices', 'the stage path needs a role:subject device: a drawn depiction of what the film is about');
    const covered = new Set(subjects.flatMap((device) => device.beats));
    const seconds = [...covered].reduce((sum, b) => sum + (beats[b].t1 - beats[b].t0), 0);
    need(seconds >= 0.5 * d - 1e-9, 'visualDevices', `subject devices cover ${seconds.toFixed(1)} s of ${d} s; they must cover at least half the film`);
    const kinds = new Set(devices.filter((device) => !TEXTURE_KINDS.includes(device.kind)).map((device) => device.kind));
    need(kinds.size >= 2, 'visualDevices', `the stage path needs at least 2 distinct non-texture device kinds; this has ${kinds.size}`);
  }

  if ('depth' in t) need(['2d', '3d'].includes(t.depth), 'depth', 'depth is 2d (the default) or 3d');
  const solid = Array.isArray(devices) && devices.some((device) => device?.kind === 'depth3d' && device?.role === 'subject');
  if (t.path === 'stage') {
    need(!(solid && t.depth !== '3d'), 'depth', 'the subject is a depth3d device: set depth to 3d, so the film takes the 3D route (references/depth.md)');
    need(!(t.depth === '3d' && !solid), 'depth', 'depth 3d needs the subject drawn as a depth3d device (role subject)');
    if ('render3d' in t) need(['three', 'blender'].includes(t.render3d), 'render3d', 'render3d is three (the GPU rung, the default) or blender (the offline Cycles rung)');
    need(t.render3d !== 'blender' || t.depth === '3d', 'render3d', 'the Blender rung renders a 3D world: set depth to 3d with a depth3d subject');
  } else {
    need(t.depth !== '3d', 'depth', 'depth 3d is a stage-path route');
  }

  if (t.path === 'stage' && register === 'rich') {
    const world = t.world;
    need(world && typeof world === 'object', 'world', 'world is required: { layers, labels, camera }: the layered world, its labelled parts and its camera moves');
    need(Array.isArray(world.layers) && world.layers.filter(text).length >= RICH_WORLD.layers, 'world.layers', `world.layers needs at least ${RICH_WORLD.layers} depth layers, back to front, each saying what lives there`);
    need(Array.isArray(world.labels) && world.labels.length >= RICH_WORLD.labels, 'world.labels', `world.labels needs at least ${RICH_WORLD.labels} labelled parts the viewer reads on screen`);
    world.labels.forEach((label, i) => {
      need(text(label) && !BARE_PLACEHOLDER.test(label), `world.labels[${i}]`, 'the label as it appears on screen');
      need(String(label).trim().split(/\s+/u).length <= RICH_WORLD.labelWords, `world.labels[${i}]`, `a label is at most ${RICH_WORLD.labelWords} words; longer text is copy`);
    });
    need(Array.isArray(world.camera), 'world.camera', 'world.camera lists the camera moves: [{ beat, move }]');
    const moving = new Set();
    world.camera.forEach((entry, i) => {
      need(Number.isInteger(entry?.beat) && entry.beat >= 0 && entry.beat < beats.length, `world.camera[${i}].beat`, 'world.camera[].beat must be a beat index');
      need(text(entry.move) && !BARE_PLACEHOLDER.test(entry.move) && !LOCKED_CAMERA.test(entry.move), `world.camera[${i}].move`, 'name the move (push-in, truck, crane, orbit, rack focus); a locked shot is not listed');
      moving.add(entry.beat);
    });
    need(moving.size >= RICH_WORLD.cameraShare * beats.length - 1e-9, 'world.camera', `the camera moves in ${moving.size} of ${beats.length} shots; a rich film moves it in at least half`);
  }

  const plan = t.typePlan;
  need(plan && Array.isArray(plan.faces) && plan.faces.length > 0, 'typePlan.faces', 'typePlan.faces must list faces');
  plan.faces.forEach((face, i) => need(FACES.some((f) => f.toLowerCase() === String(face).toLowerCase()), `typePlan.faces[${i}]`, `${face} is not a verified face; use ${FACES.join(', ')}`));
  if (t.path === 'stage') {
    const families = styleFamilies(readStyle(t.style));
    const off = plan.faces.find((face) => ![...families].some((family) => family.toLowerCase() === String(face).toLowerCase()));
    need(!off, 'typePlan.faces', `${off} is not a face of the ${t.style} style (${[...families].join(', ')})`);
  }
  need(text(plan.hierarchy), 'typePlan.hierarchy', 'typePlan.hierarchy is required');
  need(Number.isInteger(plan.maxWordsOnScreen) && plan.maxWordsOnScreen > 0, 'typePlan.maxWordsOnScreen', 'typePlan.maxWordsOnScreen must be a positive integer');

  if (t.path === 'stage') {
    const rich = register === 'rich';
    const allowed = new Set(styleColors(readStyle(t.style), { rich }));
    need(Array.isArray(t.palette) && t.palette.length <= (rich ? 14 : 9), 'palette', 'palette lists the style\u2019s colours with their roles');
    t.palette.forEach((entry, i) => {
      need(allowed.has(String(entry?.color ?? '').toLowerCase()), `palette[${i}].color`, `${entry?.color} is not a colour of the ${t.style} style${rich ? ' or one of its role accents' : ' (a minimal film keeps to the core palette)'}; the stage palette comes from the style`);
      need(text(entry.role), `palette[${i}].role`, `palette[${i}].role is required`);
    });
  } else {
    need(Array.isArray(t.palette) && t.palette.length >= 3 && t.palette.length <= 6, 'palette', 'palette must hold 3 to 6 colours');
    t.palette.forEach((entry, i) => {
      need(/^#[0-9a-f]{6}$/iu.test(entry?.color || ''), `palette[${i}].color`, `palette[${i}].color must be #rrggbb`);
      need(text(entry.role), `palette[${i}].role`, `palette[${i}].role is required`);
    });
  }

  const sound = t.sound;
  need(sound && SOUND_MODES.includes(sound.mode), 'sound.mode', `sound.mode must be one of ${SOUND_MODES.join(', ')}`);
  if (sound.mode === 'none') {
    need(SILENT_REQUEST.test(t.request) || /무음|소리\s*없이|(?<![A-Za-z])muted?(?![A-Za-z])/iu.test(t.channel), 'sound.mode',
      'sound none is allowed only when the user asked for silence or the channel plays muted by design; the default is a score');
  } else {
    need(text(sound.plan), 'sound.plan', 'sound.plan is required');
    if (sound.mode === 'score' && register === 'minimal') need(false, 'sound.mode', 'a minimal film keeps the generated bed; the score is for rich films');
    if (sound.mode === 'generated' && register === 'rich') need(false, 'sound.mode', 'a rich film scores its own music (mode score); the generated bed is for minimal films');
    if ('genre' in sound) need(SCORE_GENRES.includes(sound.genre), 'sound.genre', `sound.genre must be one of ${SCORE_GENRES.join(', ')}`);
    if (sound.mode === 'generated') need(SOUND_PALETTES.includes(sound.palette), 'sound.palette', `sound.palette must be one of ${SOUND_PALETTES.join(', ')}`);
    else if (sound.mode !== 'score') {
      need(text(sound.file), 'sound.file', `a ${sound.mode} track names its WAV in sound.file`);
      if (sound.mode === 'authored') need(/^stage\//u.test(sound.file), 'sound.file', 'an authored track lives in the stage dir (stage/*.wav)');
      if (outDir) need(existsSync(resolve(outDir, sound.file)), 'sound.file', `${sound.file} does not exist in the output dir`);
    }
    if ((sound.mode === 'generated' || sound.mode === 'score') && t.path === 'stage') {
      need('events' in sound, 'sound.events', 'list the on-screen events that make a sound: [{ t, on, kind }], at least 2, half of them away from the cuts');
    }
    if ('events' in sound) {
      const events = sound.events;
      need(Array.isArray(events) && events.length >= 2, 'sound.events', 'at least 2 on-screen events that make a sound: [{ t, on, kind }]');
      const cuts = beats.slice(1).map((beat) => beat.t0);
      let offCut = 0;
      events.forEach((entry, i) => {
        need(typeof entry?.t === 'number' && entry.t > 0 && entry.t < d, `sound.events[${i}].t`, `the second the event happens on screen, inside the film (0-${d})`);
        need(text(entry.on), `sound.events[${i}].on`, 'what happens on screen at that moment, as a viewer would see it');
        need(EVENT_SOUNDS.includes(entry.kind), `sound.events[${i}].kind`, `must be one of ${EVENT_SOUNDS.join(', ')}`);
        if (cuts.every((cut) => Math.abs(cut - entry.t) >= EVENT_OFF_CUT_SEC - 1e-9)) offCut += 1;
      });
      need(offCut * 2 >= events.length, 'sound.events', `${events.length - offCut} of ${events.length} events sit on a cut; at least half sync to something moving inside a shot`);
    }
  }

  const inventedSubject = subject.source === 'invented';
  if (inventedSubject || copy.source === 'invented') {
    need(Array.isArray(t.inventions) && t.inventions.filter(text).length > 0, 'inventions', 'list every invented part in inventions[]');
    if (inventedSubject) need(t.inventions.some((entry) => normalizeText(entry).includes(normalizeText(subject.name))), 'inventions', 'inventions[] must contain subject.name');
  }
}

export function validateTreatment(treatment, { outDir = null, examples = shippedExamples() } = {}) {
  try {
    check(treatment, { outDir, examples });
    return { ok: true };
  } catch (error) {
    if (!(error instanceof Invalid)) return { ok: false, field: 'treatment', message: `treatment could not be read: ${error.message}` };
    return { ok: false, field: error.field, message: error.message };
  }
}

// Read and validate <out>/treatment.json; a failure carries exit 16 and the field.
export function loadTreatment(outDir, exitCode = 16) {
  const file = join(outDir, 'treatment.json');
  const blocked = (field, message) => Object.assign(new Error(`BLOCKED_TREATMENT_INVALID: field ${field}: ${message}`), { exitCode, field });
  if (!existsSync(file)) throw blocked('treatment', `no treatment.json in ${outDir}; write the treatment first (references/treatment.md)`);
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { throw blocked('treatment', `treatment.json is not valid JSON: ${error.message}`); }
  const result = validateTreatment(parsed, { outDir });
  if (!result.ok) throw blocked(result.field, result.message);
  return { treatment: parsed, file, size: FORMATS[parsed.format] };
}
