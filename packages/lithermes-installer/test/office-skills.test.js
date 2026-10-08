const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { requiredSkills } = require('../src/lib/skillPayload');

const pkg = path.resolve(__dirname, '..');
const plugin = path.join(pkg, 'assets', 'lithermes-plugin');
const skill = name => path.join(plugin, 'skills', name);
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const absolute = path.join(dir, entry.name);
  return entry.isDirectory() ? files(absolute) : [absolute];
});

test('Office skills are bundled, routed, diagnosed, and documented', () => {
  for (const name of ['lit-pptx', 'lit-docx']) {
    assert.ok(requiredSkills.includes(name));
    assert.ok(fs.existsSync(path.join(skill(name), 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(skill(name), 'NOTICE')));
    for (const readme of ['README.md', 'README_Ko-KR.md']) {
      assert.match(fs.readFileSync(path.join(pkg, readme), 'utf8'), new RegExp(`lithermes:${name}`));
    }
  }
  assert.ok(fs.existsSync(path.join(skill('lit-pptx'), 'scripts', 'compile-deck.js')));
  assert.ok(fs.existsSync(path.join(skill('lit-pptx'), 'scripts', 'inventory.py')));
  assert.ok(fs.existsSync(path.join(skill('lit-pptx'), 'scripts', 'integrity.py')));
  assert.ok(fs.existsSync(path.join(skill('lit-docx'), 'scripts', 'convert_md_to_docx.py')));
  assert.ok(fs.existsSync(path.join(skill('lit-pptx'), 'runtime', 'package-lock.json')));
  assert.ok(fs.existsSync(path.join(skill('lit-pptx'), 'runtime', 'requirements.lock')));
  assert.match(fs.readFileSync(path.join(plugin, '__init__.py'), 'utf8'), /ctx\.register_command\([\s\S]*for name in \("lit-pptx", "lit-docx"\)/);
  assert.match(fs.readFileSync(path.join(plugin, 'diagnostics.py'), 'utf8'), /office-runtime|Office runtime/);
});

test('package excludes the restricted source bytes by digest', () => {
  const restricted = new Set([
    '79f6d8f5b427252fa3b1c11ecdbdb6bf610b944f7530b4de78f770f38741cfaa',
    '2d03c07a51c1793be8774664ff6594dcb6ecd3791cf718cd214c296c073fbb39',
    '5da81aba1bfbfd522b52db3156d68d483676ec6d3020a9f5fed684ba8af13335',
    '09868e9f1786765421ecf3f0f49c77006738efda82a76df43ed87f7a9bfe2467',
    '6fe762f45aff8c63fd95b9fcb1337b28921d6fa454e18a0e8158d4c8708d6d00',
    '0bd17f76a1a4c388aba42c6d1d39015fa84e405c3e0692397fe12762bd632b58',
    '1ec252de8b14b07d16966c48906ccb1c45c68bcd23557ad31d8c50a27f5f8c0f',
    'adead8fe6270e520c397cec9fbee4d606ab10bb80f749e018b42ec894c60d2e5',
    'c21fd950b6ada7bd2f029885d3e56bc66b7ff061cc8404c492eb301664aa9e5d',
    '8a590747551be847a904e3296fb2f35aa4e7feeb4970a61596c2375306462820',
    'c04ac37916f398ba621b2d9e1e4c1a69225eaad6d7fb0ad116c237ddeb1b2b68',
  ]);
  for (const file of files(pkg)) {
    if (file.includes(`${path.sep}node_modules${path.sep}`)) continue;
    const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(restricted.has(digest), false, `restricted source bytes in ${path.relative(pkg, file)}`);
  }
});

test('Office skills choose a named direction and ship its packs, references and gates', () => {
  const pptx = skill('lit-pptx');
  const docx = skill('lit-docx');
  const tonalities = ['ledger', 'signal', 'atlas', 'chalk', 'paper', 'gazette', 'studio', 'night'];
  const documents = ['report', 'brief', 'manual', 'proposal', 'memo', 'journal'];
  for (const name of tonalities) {
    assert.ok(fs.existsSync(path.join(pptx, 'templates', 'tonalities', name, 'pack.yaml')), `${name} pack`);
    assert.ok(fs.existsSync(path.join(pptx, 'references', 'tonalities', `${name}.md`)), `${name} sheet`);
  }
  for (const name of documents) {
    assert.ok(fs.existsSync(path.join(docx, 'templates', 'tonalities', `${name}.yaml`)), `${name} document pack`);
    assert.ok(fs.existsSync(path.join(docx, 'references', 'tonalities', `${name}.md`)), `${name} document sheet`);
  }
  for (const file of ['direction-step.md', 'title-treatments.md', 'layout-families.md', 'density-and-fill.md']) {
    assert.ok(fs.existsSync(path.join(pptx, 'references', file)), file);
  }
  for (const file of ['direction-step.md', 'components.md', 'page-composition.md']) {
    assert.ok(fs.existsSync(path.join(docx, 'references', file)), file);
  }
  assert.ok(fs.readdirSync(path.join(pptx, 'references', 'examples')).filter((f) => f.endsWith('.md')).length >= 12);
  assert.ok(fs.readdirSync(path.join(docx, 'references', 'examples')).filter((f) => f.endsWith('.md')).length >= 8);
  for (const script of ['grid-resolver.js', 'render-pack.js']) assert.ok(fs.existsSync(path.join(pptx, 'scripts', 'lib', script)), script);
  assert.ok(fs.existsSync(path.join(pptx, 'scripts', 'deck_output.py')));
  for (const script of ['docx_design.py', 'docx_layout.py', 'docx_gate.py']) assert.ok(fs.existsSync(path.join(docx, 'scripts', script)), script);
  assert.match(fs.readFileSync(path.join(pptx, 'bin', 'office.mjs'), 'utf8'), /gate: \[python, join\(plugin, 'skills', 'lit-docx', 'scripts', 'docx_gate\.py'\)\]/);

  const deckContract = fs.readFileSync(path.join(pptx, 'SKILL.md'), 'utf8');
  const docContract = fs.readFileSync(path.join(docx, 'SKILL.md'), 'utf8');
  for (const contract of [deckContract, docContract]) {
    assert.match(contract, /## Direction card/);
    assert.match(contract, /two alternatives/);
    assert.match(contract, /noun-phrase/);
    assert.doesNotMatch(contract, /Default to `AZURE-PRO`|default to the `korean-generic` publisher profile/);
  }
  for (const name of tonalities) assert.match(deckContract, new RegExp('`' + name + '`'));
  for (const name of ['Report', 'Brief', 'Manual', 'Proposal', 'Memo', 'Journal']) assert.match(docContract, new RegExp(`\\| ${name} \\|`));
  assert.match(deckContract, /OF-110[\s\S]*OF-114[\s\S]*OF-115[\s\S]*OF-117[\s\S]*--sibling[\s\S]*OF-116/);
  assert.match(docContract, /`memo\.fit`/);
  assert.match(deckContract, /OF-118[\s\S]*OF-119/);
  for (const check of ['notice.dash', 'page.spill', 'list.split', 'heading.apart']) assert.match(docContract, new RegExp('`' + check.replace('.', '\\.') + '`'));
  assert.match(docContract, /office\.mjs gate|`office\.mjs gate`/);
  const contexts = fs.readFileSync(path.join(plugin, 'core_contexts.py'), 'utf8');
  assert.match(contexts, /eight tonalities[\s\S]*two alternatives/);
  assert.match(contexts, /six tonalities[\s\S]*two alternatives/);
  assert.doesNotMatch(contexts, /Default to AZURE-PRO/);
});

test('Pretendard is the official release pair, shared with the motion skill', () => {
  const dir = path.join(skill('lit-pptx'), 'pretendard-font', 'public', 'static');
  const pins = {
    'Pretendard-Regular.otf': '3ffbacde6ab8411f1d2db54bb9b1f0b3ee2a738932033722cf0388c06aed1c93',
    'Pretendard-Bold.otf': '2e91915fab54df71cc9598ebf608b2bdb54c6fe3c066ac61dff0bc44fca71cc7',
  };
  assert.deepEqual(fs.readdirSync(dir).sort(), Object.keys(pins).sort());
  for (const [file, sha] of Object.entries(pins)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex'), sha, file);
  }
  const motion = fs.readFileSync(path.join(skill('lit-typographic-motion'), 'bin', 'runtime.mjs'), 'utf8');
  for (const [file, sha] of Object.entries(pins)) assert.match(motion, new RegExp(`file: '${file}', sha256: '${sha}'`));
});

test('a line the deck engine sets never breaks inside a short parenthetical such as (▲ +3.9%)', () => {
  const G = require(path.join(skill('lit-pptx'), 'scripts', 'lib', 'grid-resolver.js'));
  for (let w = 6; w <= 16; w += 0.5) {
    for (const set of [G.keepLines('정비 1,184건으로 계획보다 44건(▲ +3.9%) 많았다', w, 12), G.keepLines('Repairs beat the plan by 44 (▲ +3.9 %) this quarter', w, 12), G.balanceLines('재정비 110건(▲ +10.0%)', 2, w)]) {
      for (const line of set.split('\n')) assert.ok(!/\([^)]*$/u.test(line), `a break inside a short parenthetical: ${JSON.stringify(set)}`);
    }
  }
});
