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
