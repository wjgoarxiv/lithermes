const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const skill = path.resolve(__dirname, '../assets/lithermes-plugin/skills/lit-pptx');
const { buildBlocks } = require(path.join(skill, 'scripts/lib/slide-ast'));
const { validate } = require(path.join(skill, 'scripts/lib/spec-validator'));
const { render: renderHtml } = require(path.join(skill, 'scripts/lib/render-adapter-html'));

test('packaged slide skill has no excluded template or unused source media', () => {
  assert.equal(fs.existsSync(path.join(skill, 'templates/enrolled/TEMPLATE-EXAMPLE-1')), false);
  assert.equal(fs.existsSync(path.join(skill, 'assets/media')), false);
});

test('decoration labels use template text or neutral defaults', () => {
  const base = { deck: { title: 'Example' }, slides: [{ regions: {}, decorations: [
    { type: 'confidential_mark', x: 0, y: 0, w: 1, h: 0.3 },
    { type: 'disclaimer', x: 0, y: 1, w: 5, h: 0.3 },
  ] }] };
  const defaults = renderHtml(base, null);
  assert.match(defaults, /대외비<\/div>/);
  assert.match(defaults, /※ 본 문서는 대외비입니다\.<\/div>/);
  base.slides[0].decorations[0].text = '<Example>';
  base.slides[0].decorations[1].text = 'For internal use';
  const supplied = renderHtml(base, null);
  assert.match(supplied, /&lt;Example&gt;<\/div>/);
  assert.match(supplied, /For internal use<\/div>/);
});

test('numeric series is a validated editable chart block', () => {
  const blocks = buildBlocks('content', '# Demand trend\n\n::: chart kind=bar\n| Quarter | Product A | Product B |\n|---|---:|---:|\n| Q1 | 12 | 15 |\n| Q2 | 17 | 19 |\n:::');
  const chart = blocks.find((block) => block.type === 'chart');
  assert.ok(chart);
  assert.equal(chart.kind, 'bar');
  assert.deepEqual(chart.labels, ['Q1', 'Q2']);
  assert.deepEqual(chart.series[0].values, [12, 17]);
  assert.doesNotThrow(() => validate({ astVersion: 'slide-ast-v2', version: '2.0.0', deck: { template: 'AZURE-PRO', title: 'Demand trend' }, slides: [{ index: 1, layout: 'content', blocks }] }));
  assert.throws(() => buildBlocks('content', '# Demand trend\n\n::: chart kind=bar\n| Quarter | Revenue |\n|---|---:|\n| Q1 | [missing] |\n:::'), /numeric/i);
});

test('Office contracts require complete labelled examples under bare lit', () => {
  for (const name of ['lit-pptx', 'lit-docx']) {
    const contract = fs.readFileSync(path.resolve(skill, '..', name, 'SKILL.md'), 'utf8');
    assert.match(contract, /realistic example/i);
    assert.match(contract, /assumption/i);
    assert.match(contract, /no `?\[placeholder\]/i);
  }
});

test('the deck compiler lists the eight tonalities and the legacy templates', () => {
  const { spawnSync } = require('node:child_process');
  const run = spawnSync(process.execPath, [path.join(skill, 'scripts/compile-deck.js'), '--list-tonalities'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  for (const name of ['atlas', 'chalk', 'gazette', 'ledger', 'night', 'paper', 'signal', 'studio']) assert.match(run.stdout, new RegExp(`^${name} — `, 'm'));
  assert.match(run.stdout, /AZURE-PRO \(legacy template\)/);
  const layouts = spawnSync(process.execPath, [path.join(skill, 'scripts/compile-deck.js'), '--list-layouts', 'gazette'], { encoding: 'utf8' });
  assert.equal(layouts.status, 0, layouts.stderr);
  assert.match(layouts.stdout, /treatments: band/);
  const bad = spawnSync(process.execPath, [path.join(skill, 'scripts/compile-deck.js'), '--list-layouts', 'glossy'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Tonalities: .*ledger/);
});

test('the older native chart dialect still compiles next to the pack chart', () => {
  const blocks = buildBlocks('content', '# Demand trend\n\n::: chart type=column unit="units"\n| Quarter | Product A |\n|---|---|\n| Q1 | 12 |\n| Q2 | 17 |\n:::');
  const table = blocks.find((block) => block.type === 'kpi-table');
  assert.ok(table && table.chart && table.chart.type === 'column' && table.chart.unit === 'units');
});
