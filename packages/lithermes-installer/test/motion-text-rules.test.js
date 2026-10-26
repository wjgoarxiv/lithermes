const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..', 'assets', 'lithermes-plugin', 'skills', 'lit-typographic-motion');
const load = (name) => import(pathToFileURL(path.join(root, 'engine', name)).href);

// Guards the studio.md contract: every doc rule name must name a real runtime check.
test('DOC_GATES maps every doc rule name to a real runtime check', async () => {
  const { DOC_GATES, GATE_IDS } = await load('gate.mjs');
  const { QA_ROW_IDS } = await load('stage-qa.mjs');
  assert.deepEqual(Object.keys(DOC_GATES).sort(),
    ['DEAD-AIR', 'FLAT-FRAME', 'RICH-FILL', 'TEXT-ON-STYLE', 'TEXT-OVERLAP', 'TEXT-ZONE']);
  for (const [doc, target] of Object.entries(DOC_GATES)) {
    if (target.kind === 'qa-row') assert.ok(QA_ROW_IDS.includes(target.id), `${doc} names a missing QA row ${target.id}`);
    else if (target.kind === 'gate') assert.ok(GATE_IDS.includes(target.id), `${doc} names a missing gate ${target.id}`);
    else if (target.kind === 'treatment') assert.equal(target.id, 'palette', `${doc} names an unknown treatment field`);
    else assert.fail(`${doc} has an unknown target kind ${target.kind}`);
  }
});

test('RICH-FILL: the palette check refuses colours outside the style', async () => {
  const { validateTreatment } = await load('treatment.mjs');
  const { readStyle } = await load('styles.mjs');
  const style = readStyle('swiss-signal');
  const base = {
    request: 'a rock-pool film for the lobby screen', genre: 'other', path: 'stage',
    pathReason: 'the film shows animals and water, not only words', style: 'swiss-signal',
    register: 'rich', idea: 'a rock pool opens through one hermit crab',
    audience: 'children and guardians', channel: 'lobby screen', format: '16:9',
    formatReason: 'a landscape lobby screen', durationSec: 20,
    beats: [
      { t0: 0, t1: 5, purpose: 'ask', onScreen: 'rocks and pool', motion: 'water falls', sound: 'first pulse', layout: 'title', hero: 'the pool appears', transition: 'cut' },
      { t0: 5, t1: 10, purpose: 'first animal', onScreen: 'the crab picks a shell', motion: 'shell outline draws', sound: 'hit on cut', layout: 'split', hero: 'the outline draws', transition: 'wipe' },
      { t0: 10, t1: 15, purpose: 'second animal', onScreen: 'the anemone closes', motion: 'tentacles morph', sound: 'riser', layout: 'stage', hero: 'tentacles close', transition: 'push' },
      { t0: 15, t1: 20, purpose: 'resolve', onScreen: 'whole pool section', motion: 'camera pulls back', sound: 'final chord', layout: 'hero', hero: 'the whole pool shows', transition: 'end' },
    ],
    story: { expect: 'the pool shows one animal after another', turn: 'the anemone answers the crab', beat: 2, payoff: 'the water keeps the pool' },
    protagonist: {
      name: 'rock-pool crab', kind: 'character', look: 'a small crab in a borrowed shell beside still water',
      acts: [
        { beat: 0, action: 'the crab crosses the rock toward the pool' },
        { beat: 1, action: 'the crab tries a shell and picks one' },
        { beat: 2, action: 'the crab watches the anemone close' },
        { beat: 3, action: 'the crab settles into the whole pool view' },
      ],
    },
    world: {
      layers: ['the rock and the water in front', 'the crab and the shells in the middle', 'the sky behind'],
      labels: ['pool', 'crab', 'shell', 'anemone', 'rock', 'sky'],
      camera: [{ beat: 1, move: 'push-in on the shell' }, { beat: 3, move: 'pull back to the pool' }],
    },
    subject: { name: 'rock pool', source: 'invented', specifics: ['a hermit crab that changes shells', 'an anemone that closes its hand'] },
    visualDevices: [
      { kind: 'illustration', role: 'subject', beats: [0, 1, 2, 3] },
      { kind: 'shape', role: 'support', beats: [1, 2] },
      { kind: 'gradient', role: 'texture', beats: [0, 1, 2, 3] },
    ],
    typePlan: { faces: ['Archivo'], hierarchy: 'one headline, one caption', maxWordsOnScreen: 6 },
    palette: [{ color: style.palette.ink, role: 'ink type' }],
    sound: {
      mode: 'score', plan: 'a house score that drops on the turn',
      events: [
        { t: 2.5, on: 'the pool appears', kind: 'tap' },
        { t: 12.5, on: 'the anemone closes', kind: 'hit' },
      ],
    },
    copy: { source: 'invented', lines: ['still water keeps a small sea', 'the crab changes its house', 'the anemone closes its hand', 'see you when the water returns'] },
    inventions: ['rock pool (invented subject)', 'all four copy lines'],
    ambition: 'Match cuts between shell outlines and a steady pulse should make the pool feel alive.',
  };
  assert.equal(validateTreatment(base).ok, true, 'the base swiss-signal treatment validates');
  const bad = { ...base, palette: [{ color: '#123456', role: 'not a style colour' }] };
  const result = validateTreatment(bad);
  assert.equal(result.ok, false, 'expected the off-style palette to fail');
  assert.match(result.field, /palette/, result.message);
});

test('TEXT-ON-STYLE: typePlan faces must belong to the style', async () => {
  const { validateTreatment } = await load('treatment.mjs');
  const ok = {
    request: 'a terminal film', genre: 'type-led', path: 'stage',
    pathReason: 'phosphor type carries the film', style: 'terminalcore',
    register: 'rich', idea: 'a login prompt becomes a monologue',
    audience: 'developers', channel: 'lobby screen', format: '16:9',
    formatReason: 'a landscape screen', durationSec: 20,
    beats: [
      { t0: 0, t1: 5, purpose: 'ask', onScreen: 'a cursor blinks', motion: 'characters type on', sound: 'key clicks', layout: 'title', hero: 'the prompt types itself', transition: 'cut' },
      { t0: 5, t1: 10, purpose: 'turn', onScreen: 'the command runs', motion: 'output scrolls', sound: 'drive hum', layout: 'split', hero: 'the output scrolls', transition: 'cut' },
      { t0: 10, t1: 15, purpose: 'turn', onScreen: 'the error lands', motion: 'one line holds', sound: 'a single beep', layout: 'stage', hero: 'the error holds', transition: 'wipe' },
      { t0: 15, t1: 20, purpose: 'resolve', onScreen: 'the fix ships', motion: 'the prompt returns', sound: ' soft chime', layout: 'hero', hero: 'the prompt returns', transition: 'end' },
    ],
    story: { expect: 'the prompt waits for input', turn: 'the machine answers before the operator finishes', beat: 2, payoff: 'the prompt returns to idle' },
    protagonist: {
      name: 'login prompt', kind: 'object', look: 'one phosphor line on a dark terminal, cursor blinking at its end',
      acts: [
        { beat: 0, action: 'the cursor blinks on the empty prompt' },
        { beat: 1, action: 'typed characters fill the prompt line' },
        { beat: 2, action: 'the error holds on the line' },
        { beat: 3, action: 'the fixed prompt returns to idle' },
      ],
    },
    world: {
      layers: ['the prompt line in front', 'the scrolling output in the middle', 'the dark terminal behind'],
      labels: ['prompt', 'cursor', 'output', 'error', 'drive', 'chime'],
      camera: [{ beat: 1, move: 'push-in on the typed line' }, { beat: 3, move: 'pull back to the whole screen' }],
    },
    subject: { name: 'login prompt', source: 'invented', specifics: ['a blinking cursor', 'it asks who you are in lowercase'] },
    visualDevices: [
      { kind: 'illustration', role: 'subject', beats: [0, 1, 2, 3] },
      { kind: 'path', role: 'support', beats: [1, 2] },
    ],
    typePlan: { faces: ['VT323'], hierarchy: 'one prompt line', maxWordsOnScreen: 6 },
    palette: [{ color: '#39FF6A', role: 'phosphor type' }],
    sound: {
      mode: 'score', plan: 'a tech-house score under the key clicks',
      events: [
        { t: 2.5, on: 'the cursor blinks', kind: 'tap' },
        { t: 12.5, on: 'the error holds', kind: 'hit' },
      ],
    },
    copy: { source: 'invented', lines: ['who are you', 'the machine asks once', 'answer in lowercase', 'welcome back operator'] },
    inventions: ['login prompt (invented subject)', 'all four copy lines'],
    ambition: 'Typed phosphor and key clicks should make a login feel like a monologue.',
  };
  assert.equal(validateTreatment(ok).ok, true, 'the base terminalcore treatment validates');
  const bad = { ...ok, request: 'a phosphor film', style: 'swiss-signal', typePlan: { ...ok.typePlan } };
  bad.palette = [{ color: '#E9EBE4', role: 'bone type' }];
  const result = validateTreatment(bad);
  assert.equal(result.ok, false, 'expected VT323 on swiss-signal to fail');
  assert.match(result.field, /typePlan\.faces/, result.message);
});

test('TEXT-OVERLAP: settled copy boxes that intersect fail', async () => {
  const { copyOverlaps } = await load('stage-qa.mjs');
  assert.deepEqual(copyOverlaps([[0, 0, 10, 10]]), [], 'a lone box has no pair');
  assert.deepEqual(copyOverlaps([[0, 0, 10, 10], [10, 0, 20, 10]]), [], 'touching edges share no area');
  const hits = copyOverlaps([[0, 0, 10, 10], [5, 5, 15, 15], [20, 20, 30, 30]]);
  assert.deepEqual(hits, [[0, 1]]);
});

test('TEXT-OVERLAP: the text-overlap QA row exists', async () => {
  const { QA_ROW_IDS } = await load('stage-qa.mjs');
  assert.ok(QA_ROW_IDS.includes('text-overlap'));
});
