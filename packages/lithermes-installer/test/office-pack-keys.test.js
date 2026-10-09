const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const YAML = require('yaml');

// A tonality key that no engine code reads promises a look the deck or document never gets. Every key a
// pack sets must be read by the engine, or stand in the allowlist below with the reason it is there.
const skills = path.resolve(__dirname, '../assets/lithermes-plugin/skills');
const read = (...parts) => fs.readFileSync(path.join(skills, ...parts), 'utf8');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Keys the engine is not meant to read.
const PPTX_ALLOWED = {
  // Notes for whoever writes the deck; references/tonalities/<id>.md carries the same list under "Avoid".
  avoid: 'authoring notes, not a rendering setting',
};
const DOCX_ALLOWED = {
  schema_version: 'the pack format version, for readers of the file',
  tonality: 'the display name; the engine finds a pack by its file name',
  summary: 'a one-line description for readers of the file',
};

// Maps keyed by role or locale: the engine reads them by a computed key, so only the map itself is checked.
const PPTX_ROLE_MAPS = new Set(['faces', 'faces-pretendard-only', 'faces-a2z', 'palette', 'role-defaults', 'structure']);
// Setting groups and the name the engine reads each through (bound in render-pack.js or used in place).
const PPTX_GROUPS = {
  'type-voice': { holder: 'voice', binding: /const voice = pack\["type-voice"\]/ },
  table: { holder: 't', binding: /const t = S\.pack\.table\b/ },
  chart: { holder: 'chart', binding: /const chart = S\.pack\.chart\b/ },
  image: { holder: 'S\\.pack\\.image', binding: /S\.pack\.image\b/ },
  display: { holder: 'display', binding: /S\.pack\.display\b/ },
};

function pptxEngine() {
  const lib = (name) => read('lit-pptx', 'scripts', 'lib', name);
  // The schema check reads every key to validate it; that is not the engine drawing anything from it.
  const registry = lib('template-registry.js').replace(/\nfunction validatePack\([\s\S]*?\n}\n/, '\n');
  assert.doesNotMatch(registry, /function validatePack/, 'the schema check must be cut out before the scan');
  return [registry, lib('render-pack.js'), lib('layout-resolver.js'), lib('grid-resolver.js'), read('lit-pptx', 'scripts', 'compile-deck.js')].join('\n');
}

function docxEngine() {
  const source = ['docx_design.py', 'convert_md_to_docx.py', 'docx_layout.py', 'docx_gate.py']
    .map((name) => read('lit-docx', 'scripts', name)).join('\n');
  // The allowed-key sets name every key; that is a schema, not a read.
  const cut = source.replace(/^PACK_KEYS = \{[^}]*\}\n/m, '').replace(/^DESIGN_KEYS = \{[^}]*\}\n/m, '');
  assert.notEqual(cut, source, 'the allowed-key sets must be cut out before the scan');
  return cut;
}

function pptxPacks() {
  const dir = path.join(skills, 'lit-pptx', 'templates', 'tonalities');
  return fs.readdirSync(dir).sort().filter((id) => fs.existsSync(path.join(dir, id, 'pack.yaml')))
    .map((id) => [id, YAML.parse(fs.readFileSync(path.join(dir, id, 'pack.yaml'), 'utf8'))]);
}

function docxPacks() {
  const dir = path.join(skills, 'lit-docx', 'templates', 'tonalities');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort()
    .map((file) => [file, YAML.parse(fs.readFileSync(path.join(dir, file), 'utf8'))]);
}

function pptxUnread(packs) {
  const engine = pptxEngine();
  const keyRead = (key) => new RegExp(`(?:\\.${escape(key)}\\b(?!-)|\\[["']${escape(key)}["']\\])`).test(engine);
  const unread = new Set();
  for (const [id, pack] of packs) {
    for (const [key, value] of Object.entries(pack)) {
      if (PPTX_ALLOWED[key]) continue;
      if (!keyRead(key)) unread.add(`${id}: ${key}`);
      const group = PPTX_GROUPS[key];
      if (group) {
        assert.match(engine, group.binding, `the engine reads ${key} through ${group.holder}`);
        for (const sub of Object.keys(value || {})) {
          const access = new RegExp(`\\b${group.holder}\\b(?:\\s*\\|\\|\\s*\\{\\}\\))?(?:\\.${escape(sub)}\\b(?!-)|\\[["']${escape(sub)}["']\\])`);
          if (!access.test(engine)) unread.add(`${id}: ${key}.${sub}`);
        }
      } else if (value && typeof value === 'object' && !Array.isArray(value) && !PPTX_ROLE_MAPS.has(key)) {
        unread.add(`${id}: ${key} is a map the scan does not know; add it to the groups or the role maps`);
      }
    }
  }
  return [...unread];
}

function docxUnread(packs) {
  const engine = docxEngine();
  // A key is read by name: `.get("key")`, `["key"]`, or a quoted name on a line that looks one up (a conditional key).
  const lookups = engine.split('\n').filter((line) => /\.get\(|\[["']/.test(line));
  const keyRead = (key) => lookups.some((line) => new RegExp(`["']${escape(key)}["']`).test(line));
  const unread = new Set();
  // Numbering may name a scheme per locale ({ko: ..., en: ...}); the engine picks the value by the document's locale.
  const keyedByLocale = new Set(['design.numbering']);
  const walk = (name, node, where) => {
    for (const [key, value] of Object.entries(node)) {
      const at = where ? `${where}.${key}` : key;
      if (!where && DOCX_ALLOWED[key]) continue;
      if (!keyRead(key)) unread.add(`${name}: ${at}`);
      if (value && typeof value === 'object' && !Array.isArray(value) && !keyedByLocale.has(at)) walk(name, value, at);
    }
  };
  for (const [file, pack] of packs) walk(file, pack, '');
  return [...unread];
}

test('every key a deck tonality pack sets is read by the engine or allowed with a reason', () => {
  assert.deepEqual(pptxUnread(pptxPacks()), []);
});

test('every key a document tonality sets is read by the engine or allowed with a reason', () => {
  assert.deepEqual(docxUnread(docxPacks()), []);
});

test('the key scan reports a key that nothing reads', () => {
  const added = (before, after) => after.filter((entry) => !before.includes(entry));
  const [[id, pack]] = pptxPacks();
  const planted = { ...pack, chart: { ...pack.chart, 'made-up': 'on' }, 'made-up-key': true };
  assert.deepEqual(added(pptxUnread([[id, pack]]), pptxUnread([[id, planted]])), [`${id}: chart.made-up`, `${id}: made-up-key`]);
  const [[file, doc]] = docxPacks();
  const plantedDoc = { ...doc, design: { ...doc.design, made_up: { made_up_target: 0.5 } } };
  assert.deepEqual(added(docxUnread([[file, doc]]), docxUnread([[file, plantedDoc]])),
    [`${file}: design.made_up`, `${file}: design.made_up.made_up_target`]);
});
