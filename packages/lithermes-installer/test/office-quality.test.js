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
