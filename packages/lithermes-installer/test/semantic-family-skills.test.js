const { readDocumentation } = require("./documentation-reader");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { test } = require("node:test");

const packageRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(packageRoot, "assets", "lithermes-plugin");
const skillsRoot = path.join(pluginRoot, "skills");
const remoteShellDirective = /\bssh(?:\s|$)/i;
const indefiniteLogFollower = /\btail\b[^\r\n]*(?:\s--follow(?:=[^\s]+)?|\s-[A-Za-z]*[fF][A-Za-z]*)(?:\s|$)/i;

const families = {
  autoresearch: {
    modes: ["core", "debug", "fix", "learn", "plan", "predict", "reason", "scenario", "security", "ship"],
    provenance: "58a65afc174cd8c2fa162bb0d1953b0a88e5d419",
    source: "owner-source:060_autoresearch-skill",
    tree: "9102dfeba13a738d23971b69b6b6ad7bf425c923",
    anonymousRetrieval: "not claimed",
  },
  autoconference: {
    modes: ["core", "analyze", "debate", "plan", "resume", "ship", "survey"],
    provenance: "58a65afc174cd8c2fa162bb0d1953b0a88e5d419",
    source: "owner-source:064_autoconference-skill",
    tree: "8e73d89cefd9ca136f9c45a918517cc5e809fd57",
    anonymousRetrieval: "not claimed",
  },
  wikify: {
    modes: ["init", "ingest", "query", "save", "lint"],
    provenance: "dfe8f8bc372c3bc153dd57697f4a36f366a63e74",
    source: "owner-source:llm-wikify",
    tree: "ca02699317261cf36f9f89e96186728013778da6",
    anonymousRetrieval: "claimed via public pinned URL",
    publicPinnedUrl: "https://github.com/wjgoarxiv/llm-wikify/tree/dfe8f8bc372c3bc153dd57697f4a36f366a63e74",
  },
};

const licenseHashes = {
  autoresearch: "8b63387196e2fa43a40bfc4c7b8a367ed72ea9b421954a9f4e5050e43b91026e",
  autoconference: "8b63387196e2fa43a40bfc4c7b8a367ed72ea9b421954a9f4e5050e43b91026e",
  wikify: "34e4320b3853af090b81a43149cbca280384b074ca722e2929334efdd78f5e38",
};

const exactInventory = {
  autoresearch: [
    "LICENSE", "ORIGIN.json", "SKILL.md",
    "assets/report_template.md", "assets/research_template.md", "assets/results_template.tsv",
    "modes/core/SKILL.md", "modes/core/evaluator-contract.md", "modes/core/stuck-detection.md",
    "modes/debug/SKILL.md", "modes/debug/investigation-techniques.md", "modes/fix/SKILL.md",
    "modes/learn/SKILL.md", "modes/plan/SKILL.md", "modes/predict/SKILL.md",
    "modes/predict/persona-templates.md", "modes/reason/SKILL.md", "modes/scenario/SKILL.md",
    "modes/scenario/dimensions.md", "modes/security/SKILL.md", "modes/security/owasp-checklist.md",
    "modes/security/stride-model.md", "modes/ship/SKILL.md", "modes/ship/type-checklists.md",
    "references/core-principles.md", "references/results-logging.md", "references/visualization-guide.md",
    "scripts/check_progress.sh", "scripts/init_research.py", "scripts/style_presets.py",
  ],
  autoconference: [
    "LICENSE", "ORIGIN.json", "SKILL.md",
    "assets/conference_template.md", "assets/report_template.md", "assets/synthesis_template.md",
    "dependencies/autoresearch.md", "modes/analyze/SKILL.md", "modes/core/SKILL.md",
    "modes/core/convergence-guide.md", "modes/core/crash-recovery.md", "modes/debate/SKILL.md",
    "modes/plan/SKILL.md", "modes/resume/SKILL.md", "modes/ship/SKILL.md", "modes/survey/SKILL.md",
    "references/agent-prompts.md", "references/conference-protocol.md", "references/core-principles.md",
    "references/results-logging.md", "references/visualization-guide.md",
    "scripts/check_conference.sh", "scripts/init_conference.py", "scripts/style_presets.py",
    "templates/code-performance.md", "templates/debate-mode.md", "templates/prompt-optimization.md",
    "templates/quick-conference.md", "templates/research-synthesis.md", "templates/survey-mode.md",
  ],
  wikify: [
    "LICENSE", "ORIGIN.json", "SKILL.md", "assets/home-template.md",
    "assets/maintenance-report-template.md", "assets/paper-source-note-template.md",
    "assets/source-note-template.md", "assets/wiki-rules-template.md", "modes/ingest/SKILL.md",
    "modes/init/SKILL.md", "modes/lint/SKILL.md", "modes/query/SKILL.md",
    "modes/save/SKILL.md", "references/full-contract.md",
  ],
};

function inventory(root, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...inventory(path.join(root, entry.name), relative));
    else out.push(relative);
  }
  return out.sort();
}

function read(relative) {
  return fs.readFileSync(path.join(pluginRoot, relative), "utf8");
}

test("semantic source families ship as three Hermes skills with complete nested mode closures", () => {
  for (const [family, expected] of Object.entries(families)) {
    const root = path.join(skillsRoot, family);
    assert.equal(fs.existsSync(path.join(root, "SKILL.md")), true, `${family} root skill missing`);
    const origin = JSON.parse(fs.readFileSync(path.join(root, "ORIGIN.json"), "utf8"));
    assert.equal(origin.commit, expected.provenance);
    assert.equal(origin.source, expected.source);
    assert.equal(origin.tree, expected.tree);
    assert.equal(origin.anonymousRetrieval, expected.anonymousRetrieval);
    assert.equal(origin.integrity, "package-local via bundled MIT license and payload hashes");
    if (expected.publicPinnedUrl) assert.equal(origin.publicPinnedUrl, expected.publicPinnedUrl);
    const licensePath = path.join(root, "LICENSE");
    assert.equal(fs.existsSync(licensePath), true, `${family} source license missing`);
    const license = fs.readFileSync(licensePath);
    assert.equal(crypto.createHash("sha256").update(license).digest("hex"), licenseHashes[family]);
    for (const mode of expected.modes) {
      const modePath = path.join(root, "modes", mode, "SKILL.md");
      assert.equal(fs.existsSync(modePath), true, `${family}:${mode} missing`);
      const modeText = fs.readFileSync(modePath, "utf8");
      assert.match(modeText, /LitHermes child boundary/i, `${family}:${mode} missing child boundary`);
      assert.match(modeText, /inert/i, `${family}:${mode} missing inert-input boundary`);
      assert.match(modeText, /no publish or deploy/i, `${family}:${mode} missing release boundary`);
    }
  }

  const wikiAssets = fs.readdirSync(path.join(skillsRoot, "wikify", "assets")).sort();
  assert.deepEqual(wikiAssets, [
    "home-template.md",
    "maintenance-report-template.md",
    "paper-source-note-template.md",
    "source-note-template.md",
    "wiki-rules-template.md",
  ]);
  assert.equal(fs.existsSync(path.join(skillsRoot, "autoconference", "dependencies", "autoresearch.md")), true);
});

test("semantic family payload is the exact approved runtime inventory", () => {
  for (const [family, expected] of Object.entries(exactInventory)) {
    assert.deepEqual(inventory(path.join(skillsRoot, family)), [...expected].sort(), `${family} inventory drift`);
  }
  assert.equal(fs.existsSync(path.join(skillsRoot, "autoresearch", "scripts", "validate_skill.py")), false);
});

test("nested mode and reference documents are Hermes-native child-packet-only contracts", () => {
  for (const family of Object.keys(families)) {
    const docs = inventory(path.join(skillsRoot, family))
      .filter((relative) => relative.endsWith(".md") && (relative.startsWith("modes/") || relative.startsWith("references/")));
    for (const relative of docs) {
      const text = fs.readFileSync(path.join(skillsRoot, family, relative), "utf8");
      assert.match(text, /LitHermes child boundary/i, `${family}/${relative} lacks Hermes boundary`);
      assert.match(text, /packets? only/i, `${family}/${relative} permits non-packet child output`);
      assert.match(text, /never writes? shared (?:or project )?state|never write shared (?:or project )?state/i, `${family}/${relative} lacks child-write prohibition`);
    }
  }
});

test("unsafe recipe guards cover remote-shell and indefinite-follow command variants", () => {
  for (const command of ["ssh host", "ssh -T user@host", "ssh -i key user@host uptime"]) {
    assert.match(command, remoteShellDirective, `remote-shell guard missed: ${command}`);
  }
  for (const command of ["tail -f app.log", "tail -F app.log", "tail --follow app.log", "tail -n 100 -f app.log"]) {
    assert.match(command, indefiniteLogFollower, `indefinite-follow guard missed: ${command}`);
  }
});

test("every shipped family document rejects foreign execution, release, and child-write directives", () => {
  const forbidden = [
    ["foreign background primitive", /\brun_in_background\b|\bAgent tool\b|^\s*-\s+Agent\s*$/im],
    ["fixed model selection", /\bModel tier:\s*|\b(?:Opus|Haiku|Sonnet)\b/i],
    ["release executor", /\bnpm publish\b|\btwine upload\b|\bgh release create\b|Phase 8\s+[—-]\s+(?:Deploy|Publish)|Execute the deploy or publish command/i],
    ["donor git mutation", /\bgit\s+(?:bisect|checkout|merge|branch|worktree|cherry-pick|reset)\b|\bcherry-pick\b/i],
    ["privileged shell directive", /\bsudo\s+/i],
    ["package installation directive", /\b(?:pip(?:3)?\s+install|npm\s+(?:install|i)\b|pnpm\s+(?:add|install)\b|yarn\s+add\b|uv\s+(?:add|pip\s+install)\b|conda\s+install\b|(?:apt|apt-get|brew)\s+install\b)/i],
    ["direct host profiler or tracer", /\bpy-spy\s+(?:top|record|dump)\b|\b(?:strace|dtrace)\s+(?:-[a-z]+\s*)+/i],
    ["remote shell directive", remoteShellDirective],
    ["indefinite log follower", indefiniteLogFollower],
  ];
  for (const family of Object.keys(families)) {
    const root = path.join(skillsRoot, family);
    for (const relative of inventory(root).filter((entry) => entry.endsWith(".md"))) {
      const text = fs.readFileSync(path.join(root, relative), "utf8");
      for (const [label, pattern] of forbidden) {
        assert.doesNotMatch(text, pattern, `${family}/${relative} contains ${label}`);
      }
      if (!relative.startsWith("modes/") && !relative.startsWith("references/") && !relative.startsWith("dependencies/")) continue;
      for (const line of text.split(/\r?\n/)) {
        if (!/(?:child|researcher)/i.test(line) || !/(?:write|append|edit|commit|save|create)/i.test(line)) continue;
        if (/\bno\b|never|do(?:es)? not|must not|cannot|only the root|root (?:chair )?(?:may|applies|writes|serializes)/i.test(line)) continue;
        assert.fail(`${family}/${relative} gives a child write authority: ${line.trim()}`);
      }
    }
  }
});

test("conference core uses Hermes asynchronous delegate_task packet accounting", () => {
  const core = fs.readFileSync(path.join(skillsRoot, "autoconference", "modes", "core", "SKILL.md"), "utf8");
  assert.match(core, /delegate_task/);
  assert.match(core, /asynchronous/i);
  assert.match(core, /re-enters? as (?:a )?separate message/i);
  assert.match(core, /packet/i);
  assert.doesNotMatch(core, /\bAgent\b|run_in_background|\bwait for all\b|\b(?:Opus|Haiku|Sonnet)\b/i);
});

test("semantic docs reference only shipped helpers and Hermes-native routes", () => {
  const foreignNames = [`${"Open"}${"Code"}`, `${"Co"}${"dex"}`].join("|");
  const foreignRoute = new RegExp(`(?<![\\w:/.])\\/(?:autoresearch|autoconference|wikify)(?::[a-z-]+)?\\b|(?<![\\w:/.])\\/scientific-visualization\\b|\\.claude\\/commands|Claude Code|Claude App|${foreignNames}`, "g");
  for (const family of Object.keys(families)) {
    const root = path.join(skillsRoot, family);
    for (const relative of inventory(root).filter((entry) => entry.endsWith(".md"))) {
      const text = fs.readFileSync(path.join(root, relative), "utf8");
      assert.doesNotMatch(text, foreignRoute, `${family}/${relative} contains a foreign or nonexistent route`);
      for (const match of text.matchAll(/scripts\/([A-Za-z0-9_.-]+)/g)) {
        assert.equal(fs.existsSync(path.join(root, "scripts", match[1])), true, `${family}/${relative} references missing scripts/${match[1]}`);
      }
    }
  }
});

test("nested conference modes are selected by the root family and never advertised as callable colon skills", () => {
  const root = path.join(skillsRoot, "autoconference");
  const nestedDocs = inventory(root).filter((entry) => entry.endsWith(".md") && entry !== "SKILL.md");
  const nonexistentColonSkill = /\b(?:autoconference|autoresearch|wikify):[a-z][a-z-]*\b/i;
  for (const relative of nestedDocs) {
    const text = fs.readFileSync(path.join(root, relative), "utf8");
    assert.doesNotMatch(text, nonexistentColonSkill, `${relative} advertises a nonexistent callable colon skill`);
  }
  for (const mode of families.autoconference.modes.filter((entry) => entry !== "core")) {
    const text = fs.readFileSync(path.join(root, "modes", mode, "SKILL.md"), "utf8");
    assert.match(text, new RegExp(`selected[^\\n]{0,120}${mode}[^\\n]{0,160}lithermes:autoconference`, "i"), `${mode} lacks root-family selection wording`);
    assert.match(text, /not (?:a )?callable (?:skill|route)/i, `${mode} must deny callable nested routing`);
  }
});

test("approved semantic runtime helpers smoke through the selected interpreter", (t) => {
  const { spawnSync } = require("node:child_process");
  const os = require("node:os");
  const python = process.env.LITHERMES_PYTHON || "python3";
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-family-helpers."));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  for (const [family, init, check] of [
    ["autoresearch", "init_research.py", "check_progress.sh"],
    ["autoconference", "init_conference.py", "check_conference.sh"],
  ]) {
    const scripts = path.join(skillsRoot, family, "scripts");
    const help = spawnSync(python, [path.join(scripts, init), "--help"], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    assert.equal(help.status, 0, help.stdout + help.stderr);
    assert.doesNotMatch(help.stdout + help.stderr, /overnight|daemon|detached|publish/i);
    const progress = spawnSync("bash", [path.join(scripts, check), temp], { encoding: "utf8" });
    assert.equal(progress.status, 0, progress.stdout + progress.stderr);
    assert.doesNotMatch(progress.stdout + progress.stderr, /loop active|daemon|detached/i);
  }
});

test("optional semantic scientific style helpers run only when matplotlib and numpy actually import", (t) => {
  const { spawnSync } = require("node:child_process");
  const os = require("node:os");
  const python = process.env.LITHERMES_PYTHON || "python3";
  const importProbe = spawnSync(
    python,
    ["-c", 'import importlib; importlib.import_module("matplotlib"); importlib.import_module("numpy")'],
    { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
  );
  if (importProbe.status !== 0) {
    t.skip("optional matplotlib/numpy execution unavailable under the ambient interpreter");
    return;
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-family-styles."));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  for (const family of ["autoresearch", "autoconference"]) {
    const script = path.join(skillsRoot, family, "scripts", "style_presets.py");
    const style = spawnSync(
      python,
      ["-c", `import runpy; ns=runpy.run_path(${JSON.stringify(script)}); assert callable(ns["rcparams"])`],
      { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", MPLCONFIGDIR: temp } },
    );
    assert.equal(style.status, 0, style.stdout + style.stderr);
  }
});

test("family scaffolders refuse clobbering and reject invalid budgets", (t) => {
  const { spawnSync } = require("node:child_process");
  const os = require("node:os");
  const python = process.env.LITHERMES_PYTHON || "python3";
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-family-scaffolders."));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };

  const researchScript = path.join(skillsRoot, "autoresearch", "scripts", "init_research.py");
  const researchOutput = path.join(temp, "research");
  fs.mkdirSync(researchOutput);
  const researchSentinel = path.join(researchOutput, "research.md");
  fs.writeFileSync(researchSentinel, "sentinel research\n");
  const researchBase = [researchScript, "--goal", "bounded goal", "--metric", "score", "--direction", "maximize", "--output", researchOutput];
  const researchNoForce = spawnSync(python, researchBase, { encoding: "utf8", env });
  assert.notEqual(researchNoForce.status, 0, "research scaffolder must fail closed without --force");
  assert.equal(fs.readFileSync(researchSentinel, "utf8"), "sentinel research\n");
  const researchForce = spawnSync(python, [...researchBase, "--force"], { encoding: "utf8", env });
  assert.equal(researchForce.status, 0, researchForce.stdout + researchForce.stderr);
  assert.notEqual(fs.readFileSync(researchSentinel, "utf8"), "sentinel research\n");
  for (const args of [
    ["--max-iterations", "0"], ["--noise-runs", "0"], ["--min-delta", "-0.1"], ["--min-delta", "nan"],
  ]) {
    const result = spawnSync(python, [...researchBase, "--force", ...args], { encoding: "utf8", env });
    assert.notEqual(result.status, 0, `research invalid budget accepted: ${args.join(" ")}`);
  }

  const conferenceScript = path.join(skillsRoot, "autoconference", "scripts", "init_conference.py");
  const conferenceOutput = path.join(temp, "conference");
  fs.mkdirSync(conferenceOutput);
  const conferenceSentinel = path.join(conferenceOutput, "conference.md");
  fs.writeFileSync(conferenceSentinel, "sentinel conference\n");
  const conferenceBase = [conferenceScript, "--goal", "bounded goal", "--metric", "score", "--direction", "maximize", "--target", "1", "--output", conferenceOutput];
  const conferenceNoForce = spawnSync(python, conferenceBase, { encoding: "utf8", env });
  assert.notEqual(conferenceNoForce.status, 0);
  assert.equal(fs.readFileSync(conferenceSentinel, "utf8"), "sentinel conference\n");
  const conferenceForce = spawnSync(python, [...conferenceBase, "--force"], { encoding: "utf8", env });
  assert.equal(conferenceForce.status, 0, conferenceForce.stdout + conferenceForce.stderr);
  const ownerNotes = path.join(conferenceOutput, "owner-notes.md");
  const similarlyNamed = path.join(conferenceOutput, "researcher_B_notes.md");
  fs.writeFileSync(ownerNotes, "preserve me\n");
  fs.writeFileSync(similarlyNamed, "preserve me too\n");
  const reduced = spawnSync(python, [...conferenceBase, "--force", "--researchers", "1"], { encoding: "utf8", env });
  assert.equal(reduced.status, 0, reduced.stdout + reduced.stderr);
  for (const rid of ["B", "C"]) {
    assert.equal(fs.existsSync(path.join(conferenceOutput, `researcher_${rid}_log.md`)), false, `${rid} log survived participant reduction`);
    assert.equal(fs.existsSync(path.join(conferenceOutput, `researcher_${rid}_results.tsv`)), false, `${rid} results survived participant reduction`);
  }
  assert.equal(fs.readFileSync(ownerNotes, "utf8"), "preserve me\n");
  assert.equal(fs.readFileSync(similarlyNamed, "utf8"), "preserve me too\n");
  for (const args of [
    ["--researchers", "0"], ["--iterations-per-round", "0"], ["--max-rounds", "0"],
    ["--noise-runs", "0"], ["--min-delta", "-0.1"], ["--min-delta", "nan"],
  ]) {
    const result = spawnSync(python, [...conferenceBase, "--force", ...args], { encoding: "utf8", env });
    assert.notEqual(result.status, 0, `conference invalid budget accepted: ${args.join(" ")}`);
  }
});

test("family scaffolders declare UTF-8 for every Path.write_text call", () => {
  const { spawnSync } = require("node:child_process");
  const python = process.env.LITHERMES_PYTHON || "python3";
  const scripts = [
    path.join(skillsRoot, "autoresearch", "scripts", "init_research.py"),
    path.join(skillsRoot, "autoconference", "scripts", "init_conference.py"),
  ];
  const audit = spawnSync(python, ["-c", [
    "import ast, sys",
    "missing = []",
    "for filename in sys.argv[1:]:",
    "    tree = ast.parse(open(filename, encoding='utf-8').read(), filename)",
    "    for node in ast.walk(tree):",
    "        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'write_text':",
    "            values = [kw.value for kw in node.keywords if kw.arg == 'encoding']",
    "            if len(values) != 1 or not isinstance(values[0], ast.Constant) or values[0].value != 'utf-8':",
    "                missing.append(f'{filename}:{node.lineno}')",
    "assert not missing, 'write_text without encoding=utf-8: ' + ', '.join(missing)",
  ].join("\n"), ...scripts], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.equal(audit.status, 0, audit.stdout + audit.stderr);
});

test("semantic family entrypoints expose Hermes contracts and required safety boundaries", () => {
  const autoresearch = fs.readFileSync(path.join(skillsRoot, "autoresearch", "SKILL.md"), "utf8");
  const autoconference = fs.readFileSync(path.join(skillsRoot, "autoconference", "SKILL.md"), "utf8");
  const wikify = fs.readFileSync(path.join(skillsRoot, "wikify", "SKILL.md"), "utf8");
  for (const [name, text] of Object.entries({ autoresearch, autoconference, wikify })) {
    for (const heading of ["#contract.activation", "#contract.inputs", "#contract.mode_matrix", "#contract.procedure", "#contract.outputs", "#contract.evidence", "#contract.hard_stops", "#contract.anti_patterns"]) {
      assert.match(text, new RegExp(heading.replace(".", "\\.")), `${name} missing ${heading}`);
    }
    assert.match(text, /Hermes/i);
    assert.match(text, /inert/i);
    assert.match(text, /no publish|must not publish/i);
  }
  assert.match(autoresearch, /explicit budget/i);
  assert.match(autoresearch, /bounded work schema 3/i);
  assert.match(autoresearch, /Karpathy's autoresearch/);
  assert.doesNotMatch(autoresearch, /overnight persistence|zero dependencies/i);
  assert.match(autoconference, /BLOCKED_MULTI_AGENT_UNAVAILABLE/);
  assert.match(autoconference, /root-only/i);
  assert.match(autoconference, /child packet-only outputs/i);
  assert.match(autoconference, /Karpathy's autoresearch/);
  assert.match(wikify, /local review states/i);
  assert.match(wikify, /raw.*inert|inert.*raw/is);
});

test("semantic skills are enrolled in registration, contexts, diagnostics, and payload", () => {
  const init = read("__init__.py");
  const routing = read("core_routing.py");
  const contexts = read("core_contexts.py");
  const payload = JSON.parse(read("payload-version.json"));
  const payloadPaths = new Set(payload.files.map((entry) => entry.path));
  for (const family of Object.keys(families)) {
    assert.match(init, new RegExp(`\\("${family}"|"${family}",`));
    assert.match(routing, new RegExp(`"${family}"`));
    assert.match(contexts, new RegExp(`"${family}"`));
    assert.ok(payloadPaths.has(`skills/${family}/SKILL.md`), `payload missing ${family}`);
  }
});

test("root and package readmes are current-state docs and link release history to the changelog", () => {
  const readmes = [
    path.join(packageRoot, "..", "..", "README.md"),
    path.join(packageRoot, "..", "..", "README_Ko-KR.md"),
    path.join(packageRoot, "README.md"),
    path.join(packageRoot, "README_Ko-KR.md"),
  ];
  for (const file of readmes) {
    const text = readDocumentation(file);
    assert.doesNotMatch(text, /publish candidate|Release note:|Release `0\.|18-row|25 lithermes|262\/262|463 Python/i, path.relative(packageRoot, file));
    assert.match(text, /CHANGELOG\.md|changelog/i, `${path.relative(packageRoot, file)} must link history`);
    for (const family of Object.keys(families)) assert.ok(text.includes(`\`${family}\``));
  }
});
