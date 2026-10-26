// House styles as data: palette, faces, type scale, layout zones, motion tokens, transitions
// and sound for one look, so every film in a style shares them. A style lives in
// `styles/<id>.json`; the treatment names one, the validator checks it against the rules
// (named in the request, the project's house style, or the fixed keyword auto-pick), the
// renderer serves it to the stage page as /lit/style.css and /lit/style.js, and the text QA
// judges copy against it. Zones are one grid per layout, named per shot and mapped per
// format, so a story re-lays itself per format instead of cropping. Four styles ship;
// `paper` is stage-only (the type engine has no preset for it, so the type path skips it).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contrastRatio, relativeLuminance } from './util.mjs';

export const STYLE_SCHEMA = 'litfamily.motion-style/v1';
export const STYLE_IDS = Object.freeze(['swiss-signal', 'tidal', 'terminalcore', 'paper']);
export const DEFAULT_STYLE = 'swiss-signal';
export const TYPE_ROLES = Object.freeze(['display', 'headline', 'body', 'label']);
export const TRANSITIONS = Object.freeze(['cut', 'match', 'wipe', 'push', 'iris', 'dissolve', 'morph']);
// Copy may sit this far (a share of the frame side) outside its zone, and this far off a scale step.
export const ZONE_TOLERANCE = 0.012;
export const SIZE_TOLERANCE = 0.04;

// [x, y, w, h] as frame fractions. `type` bounds where copy may sit; `subject` bounds where the
// drawing leads (a `title` or `full` subject fills the frame as backdrop). Every type zone sits
// inside the central 90 % title-safe area.
export const LAYOUTS = Object.freeze({
  '16:9': Object.freeze({
    title: { type: [0.08, 0.2, 0.84, 0.6], subject: [0, 0, 1, 1] },
    split: { type: [0.08, 0.16, 0.36, 0.68], subject: [0.48, 0.08, 0.46, 0.84] },
    'split-alt': { type: [0.56, 0.16, 0.36, 0.68], subject: [0.06, 0.08, 0.46, 0.84] },
    stage: { type: [0.08, 0.75, 0.84, 0.18], subject: [0.06, 0.07, 0.88, 0.64] },
    hero: { type: [0.08, 0.76, 0.84, 0.17], subject: [0.03, 0.03, 0.94, 0.94] },
    full: { type: null, subject: [0, 0, 1, 1] },
  }),
  '9:16': Object.freeze({
    title: { type: [0.09, 0.26, 0.82, 0.48], subject: [0, 0, 1, 1] },
    split: { type: [0.09, 0.08, 0.82, 0.26], subject: [0.06, 0.36, 0.88, 0.56] },
    'split-alt': { type: [0.09, 0.66, 0.82, 0.26], subject: [0.06, 0.06, 0.88, 0.56] },
    stage: { type: [0.09, 0.79, 0.82, 0.13], subject: [0.06, 0.06, 0.88, 0.68] },
    hero: { type: [0.09, 0.8, 0.82, 0.12], subject: [0.03, 0.03, 0.94, 0.94] },
    full: { type: null, subject: [0, 0, 1, 1] },
  }),
});
export const LAYOUT_IDS = Object.freeze(Object.keys(LAYOUTS['16:9']));
const FRAME = Object.freeze({ '16:9': [1920, 1080], '9:16': [1080, 1920] });

// With no name, house file or keyword, the genre chooses the style that reads best: an
// explainer on the warm, legible paper ground (stage only), a brand mood on the tidal flow.
export const GENRE_STYLE = Object.freeze({ explainer: 'paper', 'brand-mood': 'tidal' });

// Checked in order; the first row with a whole-word hit wins. `paper` has no type-engine preset,
// so the type path skips its row.
export const STYLE_PICK = Object.freeze([
  { style: 'terminalcore', korean: ['터미널', 'CRT', '해커'], latin: ['terminal', 'hacker', 'crt'] },
  { style: 'tidal', korean: ['물결', '파도', '잔잔한', '흐름'], latin: ['gradient', 'wave', 'tide', 'calm'] },
  { style: 'paper', korean: ['따뜻한', '밝은', '종이', '손그림', '포근한', '아기자기'], latin: ['warm', 'cozy', 'bright', 'paper', 'handmade', 'hand-drawn'] },
]);
const NAMED = Object.freeze({
  'swiss-signal': ['swiss-signal', 'swiss signal', '스위스 시그널'],
  tidal: ['tidal', '타이달'],
  terminalcore: ['terminalcore', '터미널코어'],
  paper: ['paper style', 'paper look', '페이퍼 스타일', '페이퍼'],
});

export class StyleError extends Error {}

const HEX = /^#[0-9a-f]{6}$/iu;
const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const escape = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export const matchesKeyword = (text, keyword, korean) => {
  const pattern = korean
    ? new RegExp(`(?<![\\p{L}\\p{N}])${escape(keyword)}`, 'u')
    : new RegExp(`(?<![\\p{L}\\p{N}])${escape(keyword)}(?![\\p{L}\\p{N}])`, 'iu');
  return pattern.test(String(text ?? ''));
};

/** Validate a style document; returns it, or throws StyleError naming the first bad field. */
export function validateStyle(style) {
  const fail = (field, message) => {
    throw new StyleError(`style ${style?.id ?? '?'}: ${field}: ${message}`);
  };
  if (!style || typeof style !== 'object') fail('style', 'must be an object');
  if (style.schema !== STYLE_SCHEMA) fail('schema', `must be ${STYLE_SCHEMA}`);
  if (!STYLE_IDS.includes(style.id)) fail('id', `must be one of ${STYLE_IDS.join(', ')}`);
  for (const key of ['name', 'summary']) if (!isText(style[key])) fail(key, 'must be a non-empty string');
  const palette = style.palette ?? {};
  for (const role of ['ground', 'surface', 'ink', 'muted', 'signal', 'line']) {
    if (!HEX.test(palette[role] ?? '')) fail(`palette.${role}`, 'must be #rrggbb');
  }
  if (!Array.isArray(style.textRoles) || style.textRoles.some((role) => !HEX.test(palette[role] ?? ''))) {
    fail('textRoles', 'every text role names a palette colour');
  }
  const ground = relativeLuminance(palette.ground);
  if (contrastRatio(relativeLuminance(palette.ink), ground) < 7) fail('palette.ink', 'ink on ground needs 7:1');
  if (contrastRatio(relativeLuminance(palette.muted), ground) < 4.5) fail('palette.muted', 'muted on ground needs 4.5:1');
  for (const role of ['signal', 'accent']) {
    if (palette[role] && contrastRatio(relativeLuminance(palette[role]), ground) < 3) {
      fail(`palette.${role}`, `${role} on ground needs 3:1 (large type)`);
    }
  }
  if (!Array.isArray(style.accents) || style.accents.length < 3) fail('accents', 'names at least three role accents a rich film may add');
  style.accents.forEach((accent, index) => {
    if (!isText(accent?.role)) fail(`accents[${index}].role`, 'says what the colour marks');
    if (!HEX.test(accent?.color ?? '')) fail(`accents[${index}].color`, 'must be #rrggbb');
    if (contrastRatio(relativeLuminance(accent.color), ground) < 3) fail(`accents[${index}].color`, 'an accent on ground needs 3:1 (large type)');
  });
  for (const role of TYPE_ROLES) if (!isText(style.faces?.[role]?.family)) fail(`faces.${role}`, 'needs a family');
  for (const format of Object.keys(FRAME)) {
    const steps = style.scale?.[format];
    if (!steps || TYPE_ROLES.some((role) => !(steps[role] > 0))) fail(`scale.${format}`, 'needs a size per type role');
    if (!(steps.display > steps.headline && steps.headline > steps.body && steps.body > steps.label)) {
      fail(`scale.${format}`, 'steps must descend display > headline > body > label');
    }
  }
  const motion = style.motion ?? {};
  for (const key of ['enter', 'move', 'exit']) {
    if (!Array.isArray(motion.ease?.[key]) || motion.ease[key].length !== 4) fail(`motion.ease.${key}`, 'is a cubic-bezier [x1, y1, x2, y2]');
  }
  for (const key of ['micro', 'move', 'hero', 'exit']) if (!(motion.dur?.[key] > 0)) fail(`motion.dur.${key}`, 'seconds > 0');
  if (!(motion.dur.exit <= motion.dur.hero)) fail('motion.dur.exit', 'an exit is never longer than the hero move');
  if (!Array.isArray(style.transitions) || !style.transitions.length || style.transitions.some((name) => !TRANSITIONS.includes(name))) {
    fail('transitions', `a subset of ${TRANSITIONS.join(', ')}`);
  }
  if (!isText(style.score?.genre)) fail('score.genre', 'names the genre a film\u2019s score takes by default');
  if (!style.sound || !isText(style.sound.timbre)) fail('sound', 'needs the generated bed\u2019s palette');
  if (!Array.isArray(style.beds) || style.beds.length < 2 || style.beds.some((bed) => !isText(bed?.timbre) || !isText(bed?.key) || !(bed?.tempo > 0))) {
    fail('beds', 'lists at least two beds a film may pick, each { timbre, key, mode, tempo }');
  }
  if (!Array.isArray(style.bans) || style.bans.length < 3) fail('bans', 'names at least three defaults this style never uses');
  return style;
}

const cache = new Map();
/** Load a shipped style by id (validated, frozen). */
export function readStyle(id) {
  if (!STYLE_IDS.includes(id)) throw new StyleError(`unknown style: ${id} (choose ${STYLE_IDS.join(', ')})`);
  if (!cache.has(id)) {
    const file = fileURLToPath(new URL(`../styles/${id}.json`, import.meta.url));
    cache.set(id, Object.freeze(validateStyle(JSON.parse(readFileSync(file, 'utf8')))));
  }
  return cache.get(id);
}

/** Every font family copy may use in this style (the role faces, the Hangul face, Pretendard). */
export const styleFamilies = (style) => new Set([...TYPE_ROLES.map((role) => style.faces[role].family), style.hangul?.family ?? 'Pretendard', 'Pretendard']);
/** The hex colours copy may use. */
export const styleTextColors = (style) => style.textRoles.map((role) => style.palette[role].toLowerCase());
/** The beds a film in this style may pick from, the default first. */
export const styleBeds = (style) => style.beds;
/** The role accents a rich film may add to the core palette, each { role, color }. */
export const styleAccents = (style) => style.accents;
/** All palette colours of the style (what a stage treatment's palette may list); rich adds the accents. */
export const styleColors = (style, { rich = false } = {}) => [...Object.values(style.palette), ...(rich ? style.accents.map((accent) => accent.color) : [])].map((color) => color.toLowerCase());

/**
 * Which style a film takes. A style named in the request wins; then the project's house style;
 * then the keyword auto-pick; then the genre's style; then the default. Returns { id, source, reason }.
 */
export function pickStyle({ request = '', copy = [], path = 'stage', house = null, genre = null } = {}) {
  const text = String(request);
  for (const [id, names] of Object.entries(NAMED)) {
    if (path === 'type' && !readStyle(id).typePreset) continue;
    const hit = names.find((name) => matchesKeyword(text, name, /[가-힣]/u.test(name)));
    if (hit) return { id, source: 'request', reason: `the request names the ${id} style ("${hit}")` };
  }
  if (house?.style && STYLE_IDS.includes(house.style) && (path !== 'type' || readStyle(house.style).typePreset)) {
    return { id: house.style, source: 'house', reason: `the project's house style is ${house.style} (motion-house.json)` };
  }
  const haystack = [text, ...copy].join('\n');
  for (const row of STYLE_PICK) {
    if (path === 'type' && !readStyle(row.style).typePreset) continue;
    for (const keyword of row.korean) if (matchesKeyword(haystack, keyword, true)) return { id: row.style, source: 'auto', reason: `the request mentions "${keyword}"` };
    for (const keyword of row.latin) if (matchesKeyword(haystack, keyword, false)) return { id: row.style, source: 'auto', reason: `the request mentions "${keyword}"` };
  }
  const byGenre = GENRE_STYLE[genre];
  if (byGenre && (path !== 'type' || readStyle(byGenre).typePreset)) {
    return { id: byGenre, source: 'genre', reason: `no style is named and no keyword picks one, and a ${genre} film takes ${byGenre}` };
  }
  return { id: DEFAULT_STYLE, source: 'default', reason: `no style is named and no keyword picks one, so the default ${DEFAULT_STYLE}` };
}

/** A layout's zones in pixels for a format: { type: {x, y, w, h} | null, subject: {...} }. */
export function zonesPx(format) {
  const [frameWidth, frameHeight] = FRAME[format];
  const px = (rect) => (rect ? { x: Math.round(rect[0] * frameWidth), y: Math.round(rect[1] * frameHeight), w: Math.round(rect[2] * frameWidth), h: Math.round(rect[3] * frameHeight) } : null);
  return Object.fromEntries(Object.entries(LAYOUTS[format]).map(([id, zones]) => [id, { type: px(zones.type), subject: px(zones.subject) }]));
}

/** The type step a rendered size sits on, or null when it is off the style's scale. */
export function scaleStep(style, format, sizePx) {
  for (const role of TYPE_ROLES) {
    const step = style.scale[format][role];
    if (Math.abs(sizePx - step) <= step * SIZE_TOLERANCE) return role;
  }
  return null;
}

/** /lit/style.js: window.LitStyle (tokens and pixel zones) and window.LitTimeline (the treatment's shots). */
export function styleScript(style, format, treatment) {
  const timeline = {
    format, fps: treatment.fps ?? 60, duration: treatment.durationSec,
    beats: (treatment.beats ?? []).map((beat, index) => ({ index, t0: beat.t0, t1: beat.t1, layout: beat.layout ?? null, transition: beat.transition ?? null })),
  };
  const data = {
    id: style.id, name: style.name, format, palette: style.palette, textRoles: style.textRoles,
    faces: style.faces, hangul: style.hangul ?? null, scale: style.scale[format], leading: style.leading ?? {},
    motion: style.motion, transitions: style.transitions, ground: style.ground, zones: zonesPx(format),
  };
  return `window.LitStyle = Object.freeze(${JSON.stringify(data)});\nwindow.LitTimeline = Object.freeze(${JSON.stringify(timeline)});\n`;
}

const familyStack = (style, role) => {
  const face = style.faces[role];
  const hangul = style.hangul?.family ?? 'Pretendard';
  return [face.family, hangul, 'Pretendard'].filter((family, index, all) => all.indexOf(family) === index).map((family) => `"${family}"`).join(', ');
};

/** /lit/style.css for one style and format: custom properties, type-role classes, colour classes. */
export function styleCss(style, format) {
  const steps = style.scale[format];
  const vars = [
    ...Object.entries(style.palette).map(([key, value]) => `  --lit-${key}: ${value};`),
    ...TYPE_ROLES.map((role) => `  --lit-size-${role}: ${steps[role]}px;`),
  ];
  const roles = TYPE_ROLES.map((role) => {
    const face = style.faces[role];
    return `.lit-${role} { font-family: ${familyStack(style, role)}; font-size: ${steps[role]}px; font-weight: ${face.weight}; line-height: ${style.leading?.[role] ?? 1.3}; letter-spacing: 0; margin: 0; }`;
  });
  const colours = style.textRoles.map((role) => `.lit-${role === 'ground' ? 'knockout' : role} { color: var(--lit-${role}); }`);
  return [
    `/* lit-typographic-motion style: ${style.id} (${format}) */`,
    `:root {\n${vars.join('\n')}\n}`,
    // Korean breaks between eojeol, never inside a word (type-craft.md).
    `html, body { margin: 0; overflow: hidden; background: var(--lit-ground); color: var(--lit-ink); font-family: ${familyStack(style, 'body')}; word-break: keep-all; overflow-wrap: break-word; }`,
    ...roles,
    ...colours,
    '.lit-zone { position: absolute; box-sizing: border-box; }',
    '',
  ].join('\n');
}
