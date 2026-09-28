const {
  assert, fs, os, packageRoot, path, readJson, requireFile, sha256, spawnSync, test,
} = require("./runtime-helpers");

test("integration.installed-nested-assets", (t) => {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "lithermes-uiux-install."));
  t.after(() => fs.rmSync(hermesHome, { recursive: true, force: true }));
  const install = spawnSync(
    process.execPath,
    [
      path.join(packageRoot, "bin", "lithermes.js"),
      "install",
      "--yes",
      "--offline",
      "--no-hud",
      "--no-auto-update",
      "--no-patch-installed-hermes",
      "--hermes-home",
      hermesHome,
    ],
    {
      cwd: packageRoot,
      encoding: "utf8",
      env: { ...process.env, CI: "1", NO_UPDATE_NOTIFIER: "1" },
      timeout: 30000,
    },
  );
  assert.equal(install.status, 0, install.stdout + install.stderr);

  const installedPlugin = path.join(hermesHome, "plugins", "lithermes");
  const installedManifest = readJson(path.join(hermesHome, "lithermes", "install-manifest.json"));
  // Every bundled reference must install and hash-match too: a reference that ships but
  // never lands is a router row pointing at nothing.
  const bundledReferences = ["frontend-ui-ux", "visual-qa"].flatMap((skill) => {
    const directory = path.join(packageRoot, "assets", "lithermes-plugin", "skills", skill, "references");
    return fs
      .readdirSync(directory)
      .filter((entry) => entry.endsWith(".md"))
      .map((entry) => `skills/${skill}/references/${entry}`);
  });
  assert.equal(
    bundledReferences.filter((entry) =>
      entry.startsWith("skills/frontend-ui-ux/") &&
      !entry.endsWith("/complete-contract.md") &&
      !entry.endsWith("/README.md")
    ).length,
    20,
    "the frontend reference router preserves the two added craft references alongside the original 18",
  );
  assert.ok(
    bundledReferences.includes("skills/frontend-ui-ux/references/complete-contract.md") &&
      bundledReferences.includes("skills/visual-qa/references/complete-contract.md"),
    "both concise entrypoints must install their preserved detailed contract",
  );
  assert.ok(
    bundledReferences.includes("skills/frontend-ui-ux/references/motion-guide.md"),
    "frontend-ui-ux must install its focused motion guide",
  );
  assert.ok(
    bundledReferences.includes("skills/visual-qa/references/capture-playbook.md"),
    "visual-qa must ship the capture playbook",
  );

  const required = [
    "skills/readme-studio/SKILL.md",
    "skills/readme-studio/references/decoration-patterns.md",
    "skills/readme-studio/templates/cover-section.md",
    "skills/readme-studio/scripts/check_facts.py",
    "skills/readme-studio/templates/typography/outline.mjs",
    "skills/readme-studio/templates/remotion/src/index.tsx",
    "skills/readme-studio/templates/hyperframes/index.html",
    "skills/frontend-ui-ux/resources/design-intelligence.json",
    "skills/frontend-ui-ux/references/default-editorial-pixel.json",
    "skills/frontend-ui-ux/resources/LICENSE",
    "skills/frontend-ui-ux/resources/PROVENANCE.json",
    "skills/frontend-ui-ux/resources/THIRD-PARTY-NOTICE.txt",
    "skills/frontend-ui-ux/scripts/design_intelligence.py",
    "skills/frontend-ui-ux/schemas/design-contract-v1alpha1.schema.json",
    "skills/frontend-ui-ux/schemas/design-contract-v1beta1.schema.json",
    "skills/visual-qa/scripts/visual_qa.py",
    "skills/visual-qa/schemas/evidence-manifest-v1alpha1.schema.json",
    "skills/visual-qa/schemas/evidence-manifest-v1beta1.schema.json",
    "skills/visual-qa/schemas/review-receipt-v1alpha1.schema.json",
    ...bundledReferences,
  ];
  for (const relative of required) {
    const installedFile = path.join(installedPlugin, ...relative.split("/"));
    requireFile(installedFile, "isolated install missing nested asset");
    const entry = installedManifest.files.find((candidate) => candidate.path === relative);
    assert.ok(entry, `install manifest missing ${relative}`);
    assert.equal(sha256(installedFile), entry.sha256, `installed nested asset hash mismatch: ${relative}`);
  }
  const { inspectSkillPayload } = require("../../src/lib/skillPayload");
  const manifest = readJson(path.join(installedPlugin, "payload-version.json"));
  assert.equal(inspectSkillPayload(installedPlugin, manifest, true).ok, true);
  const helper = path.join(installedPlugin, "skills/readme-studio/scripts/check_facts.py");
  fs.appendFileSync(helper, "\n# stale installed helper\n");
  const stale = inspectSkillPayload(installedPlugin, manifest, true);
  assert.equal(stale.ok, false);
  assert.ok(stale.failures.some((entry) => entry.id === "readme-studio" && entry.reason === "hash mismatch"));
  fs.unlinkSync(helper);
  assert.ok(inspectSkillPayload(installedPlugin, manifest, true).failures.some(
    (entry) => entry.id === "readme-studio" && entry.reason === "missing",
  ));
});
