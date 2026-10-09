const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { findDirectNpmPublishCommands } = require("./documentation-commands");
const { readDocumentation: read } = require("./documentation-reader");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

function releaseChecklistSection(text) {
  const marker = text.indexOf("## Release Checklist");
  return marker >= 0 ? text.slice(marker) : text;
}

const localPublishCommand = "npm publish --access public";

function assertCoverImage(text, label, repository) {
  const staticSrc = repository
    ? "./docs/assets/cover.webp"
    : "https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.18/readme-assets/cover.webp";
  const reducedMotionSrc = repository
    ? "./docs/assets/cover-motion-still.webp"
    : "https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.18/readme-assets/cover-motion-still.webp";
  const motionSrc = repository
    ? "./docs/assets/cover-motion.webp"
    : "https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.18/readme-assets/cover-motion.webp";
  assert.ok(
    text.includes('<picture><source media="(prefers-reduced-motion: reduce)" srcset="' + reducedMotionSrc + '" /><img src="' + motionSrc + '" width="100%"'),
    label + " must use the animated cover and its reduced-motion still",
  );
  assert.ok(text.includes('srcset="' + reducedMotionSrc + '"'), label + " needs a reduced-motion still from the motion cover");
  assert.ok(text.includes('src="' + motionSrc + '"'), label + " needs the motion cover as the img fallback");
  const coverAlt = text.includes('alt="LitFamily motion cover:')
    ? "LitFamily motion cover: five armored robots power on one by one, the LitHermes robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up."
    : "LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitHermes 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상";
  assert.ok(text.includes('alt="' + coverAlt + '"'), label + " needs meaningful motion-cover alt text");
  const heroPicture = '<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="' + reducedMotionSrc + '" /><img src="' + motionSrc + '" width="100%" alt="' + coverAlt + '" /></picture></p>';
  assert.ok(text.startsWith(heroPicture + "\n\n"), label + " must open with the motion cover as its only cover picture");
  assert.equal(text.split('src="' + staticSrc + '"').length - 1, 0, label + " must not repeat the static robot cover under the motion cover");
  assert.doesNotMatch(text, /View the static (?:family )?cover<\/a>|정지 (?:패밀리 )?표지 보기<\/a>/, label + " must not keep a hidden static-cover link");
  const h1Index = text.indexOf("\n# ");
  assert.ok(h1Index >= 0, label + " must have a title");
  assert.ok(text.indexOf(heroPicture) < h1Index, label + " cover image must appear before the title");
}

test("repository covers match the Hermes outlined vector and WebP exports", () => {
  const { createHash } = require("node:crypto");
  const vector = fs.readFileSync(path.join(repoRoot, "docs", "assets", "cover.svg"), "utf8");
  assert.match(vector, /<svg\b[^>]*viewBox="0 0 1920 960"/);
  assert.match(vector, /<title id="title">LITHERMES — Ignition vector cover<\/title>/);
  assert.match(vector, /<path\b/);
  assert.doesNotMatch(vector, /<(?:image|text|script|foreignObject)\b|\b(?:href|on\w+)\s*=|data:|url\(/i);
  for (const color of ["#080D14", "#FF6337", "#D7F75B", "#F2EFDF"]) {
    assert.ok(vector.includes(color), `vector must retain ${color}`);
  }
  assert.equal(createHash("sha256").update(vector).digest("hex"), "96799e157712c9b36a9bc2c6f995a79c0b596eee9e93dcc503a71c9a064f8ee4");
  const cover = fs.readFileSync(path.join(repoRoot, "docs", "assets", "cover.webp"));
  assert.equal(cover.toString("ascii", 0, 4), "RIFF");
  assert.equal(cover.toString("ascii", 8, 12), "WEBP");
  assert.equal(createHash("sha256").update(cover).digest("hex"), "c125a3ff2ebe1a62535bd159b9a8b277f72002a6bb95ea22015a4f8849a4e3ea");
  const motionCover = fs.readFileSync(path.join(repoRoot, "docs", "assets", "cover-motion.webp"));
  assert.ok(motionCover.length <= 2_621_440, "motion cover must stay under 2.5 MiB");
  assert.equal(createHash("sha256").update(motionCover).digest("hex"), "83f0361043b21e5aba1fdbc34737efc55f329eb36f76db6cddc6d40ad87301c7");
  assert.deepEqual(fs.readFileSync(path.join(packageRoot, "readme-assets", "cover-motion.webp")), motionCover);
  const motionStill = fs.readFileSync(path.join(repoRoot, "docs", "assets", "cover-motion-still.webp"));
  assert.equal(createHash("sha256").update(motionStill).digest("hex"), "8f9165e78ae6789242b4f49f47dc741ffaad23195d528260536e04ad14fe981b");
  assert.deepEqual(fs.readFileSync(path.join(packageRoot, "readme-assets", "cover-motion-still.webp")), motionStill);
});

function assertCanonicalHero(text, expectedHero, repository, label) {
  const hero = text.match(/<p align="center"><img src="[^"]*ascii-readme\.svg" width="480" alt="[^"\n]+" \/><\/p>\n\n<details>\n<summary>[^<\n]+<\/summary>\n\n\x60{3}\n([\s\S]*?)\n\x60{3}\n\n<\/details>/);
  assert.equal(hero?.[1], expectedHero, `${label} must preserve Ignition B rows with only trailing canvas padding omitted`);
}

test("bilingual entry pages preserve the canonical banner and use repository artwork and guides", () => {
  const mark = require("../src/lib/litMark");
  const expectedHero = mark.lockup("lithermes", mark.banner).map((row) => row.trimEnd()).join("\n");
  for (const directory of [repoRoot, packageRoot]) {
    for (const name of ["README.md", "README_Ko-KR.md"]) {
      const file = path.join(directory, name);
      const text = fs.readFileSync(file, "utf8");
      // The copyable banner belongs to the GitHub page; the npm card keeps only the mark image.
      if (directory === repoRoot) assertCanonicalHero(text, expectedHero, true, file);
      else assert.doesNotMatch(text, /<details>/, file + " is a short npm card without collapsible sections");
      const markSrc = directory === repoRoot
        ? "./docs/assets/readme/ascii-readme.svg"
        : "https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.18/readme-assets/ascii-readme.svg";
      assert.ok(text.includes('<p align="center"><img src="' + markSrc + '" width="480"'), file + " must load its ASCII mark from its own surface");
      const coverSrc = directory === repoRoot
        ? "./docs/assets/cover-motion.webp"
        : "https://cdn.jsdelivr.net/npm/@litfamily/lithermes@1.0.18/readme-assets/cover-motion.webp";
      assert.ok(text.includes('src="' + coverSrc + '"'), file + " must resolve artwork from its own surface");
      assertCoverImage(text, file, directory === repoRoot);
      if (directory === repoRoot) {
        assert.doesNotMatch(text, /cdn\.jsdelivr/, "GitHub landing keeps repository-relative artwork");
      } else {
        assert.match(text, /cdn\.jsdelivr\.net\/npm\/@litfamily\/lithermes@1\.0\.18\/readme-assets\//, "package landing must load artwork from the published tarball");
        assert.doesNotMatch(text, /raw\.githubusercontent/, "package landing must not depend on GitHub raw URLs");
      }
      assert.match(text, /```text\nlit [^\n]+\n```/, `${file} must show first bare lit use`);
      assert.match(text, /install --yes --no-style/, `${file} must explain the unattended install path`);
      read(file); // Verifies the explicit guide link and that its target exists.
    }
  }
});

test("npm READMEs use current-version package URLs for media and local file links", () => {
  const manifest = require("../package.json");
  const packageUrl = "https://cdn.jsdelivr.net/npm/@litfamily/lithermes@" + manifest.version + "/";
  const packageFiles = manifest.files;
  for (const [name, translated] of [["README.md", "README_Ko-KR.md"], ["README_Ko-KR.md", "README.md"]]) {
    const file = path.join(packageRoot, name);
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /(?:src|srcset|href)=[\"']\.{1,2}\/|\]\(\.{1,2}\//, name + " must not leave relative file URLs for npm to rewrite");
    const media = [...text.matchAll(/(?:src|srcset)=[\"']([^\"']+)[\"']/g)].map((match) => match[1]);
    assert.ok(media.length > 0, name + " should contain packaged media");
    for (const url of media) assert.ok(url.startsWith(packageUrl), name + " media must use the current package CDN URL: " + url);
    assert.ok(text.includes('href="' + packageUrl + "readme-assets/ignition-film.mp4" + '"'), name + " must link to its packaged ignition film");
    assert.ok(text.includes("](" + packageUrl + translated + ")"), name + " language link must resolve from the package");

    const packageUrls = [...text.matchAll(/(?:src|srcset|href)=["'](https:\/\/cdn\.jsdelivr\.net\/npm\/@litfamily\/lithermes@[^"']+)["']|\]\((https:\/\/cdn\.jsdelivr\.net\/npm\/@litfamily\/lithermes@[^)]+)\)/g)]
      .map((match) => match[1] || match[2]);
    for (const url of packageUrls) {
      assert.ok(url.startsWith(packageUrl), name + " package URL must be pinned to " + manifest.version + ": " + url);
      const parsed = new URL(url);
      const pathname = decodeURIComponent(parsed.pathname.slice(new URL(packageUrl).pathname.length));
      assert.ok(fs.statSync(path.join(packageRoot, pathname)).isFile(), name + " package URL target must exist: " + pathname);
      assert.ok(packageFiles.some((entry) => pathname === entry || pathname.startsWith(entry.replace(/\/$/, "") + "/")), name + " package URL target must be allowlisted: " + pathname);
    }
  }
});

test("the collapsible banner guard rejects lost copyability, changed rows and an uncentered mark", () => {
  const mark = require("../src/lib/litMark");
  const expectedHero = mark.lockup("lithermes", mark.banner).map((row) => row.trimEnd()).join("\n");
  const text = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
  for (const damaged of [
    text.replace("<details>", "<div>"),
    text.replace("```\n", "<pre>\n"),
    text.replace(expectedHero, expectedHero.replace("▗", " ")),
    text.replace('<p align="center"><img src="./docs/assets/readme/ascii-readme.svg"', '<p align="left"><img src="./docs/assets/readme/ascii-readme.svg"'),
  ]) {
    assert.throws(() => assertCanonicalHero(damaged, expectedHero, true, "negative control"), assert.AssertionError);
  }
  assert.doesNotThrow(() => assertCanonicalHero(text, expectedHero, false, "package entry"));
});

const GITHUB_SECTIONS = {
  en: ["Why LitHermes", "Install", "Quick start", "Watch it in motion", "Skills", "How it works", "Beyond code", "The Ignition skin", "Commands", "Automatic handoff", "Optional: Jev skill hint", "When something goes wrong", "More docs and contributing"],
  ko: ["왜 LitHermes인가요", "설치", "빠른 시작", "움직이는 모습 보기", "스킬", "작동 방식", "코드 밖의 결과물", "Ignition 스킨", "명령", "자동 핸드오프", "선택 기능: Jev 스킬 힌트", "문제가 생겼을 때", "더 읽을 문서와 기여"],
};
const NPM_SECTIONS = {
  en: ["Install", "Your first task", "Routes you will use most", "Making more than code", "What changes after install", "Automatic handoff", "Optional: Jev skill hint", "Check, remove, stay safe", "Learn more"],
  ko: ["설치", "첫 작업", "자주 쓰는 경로", "코드 밖의 결과물", "설치 후 달라지는 것", "자동 핸드오프", "선택 기능: Jev 스킬 힌트", "확인, 삭제, 안전", "더 알아보기"],
};

test("GitHub and npm READMEs keep their own bilingual skeletons", () => {
  const pages = [
    [path.join(repoRoot, "README.md"), GITHUB_SECTIONS.en],
    [path.join(packageRoot, "README.md"), NPM_SECTIONS.en],
    [path.join(repoRoot, "README_Ko-KR.md"), GITHUB_SECTIONS.ko],
    [path.join(packageRoot, "README_Ko-KR.md"), NPM_SECTIONS.ko],
  ];
  for (const [file, expected] of pages) {
    const text = fs.readFileSync(file, "utf8");
    const sections = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    assert.deepEqual(sections, expected, `${file} must use its section order`);
    assert.match(text, /<picture>[\s\S]*cover-motion-still\.webp[\s\S]*cover-motion\.webp[\s\S]*<\/picture>/);
    assert.equal((text.match(/<img src="[^"]*cover\.webp"/g) || []).length, 0, `${file} must show only the motion cover, not the static robot cover`);
    assert.doesNotMatch(text, /(?:docs|readme-assets)\/ab\//, `${file} must not link retired A\/B assets`);
  }
});

test("no README page or package card shows an A/B comparison, and no A/B capture ships", () => {
  const pages = [
    path.join(repoRoot, "README.md"),
    path.join(repoRoot, "README_Ko-KR.md"),
    path.join(packageRoot, "README.md"),
    path.join(packageRoot, "README_Ko-KR.md"),
  ];
  for (const file of pages) {
    const text = fs.readFileSync(file, "utf8");
    for (const banned of [/A\/B/, /blind judge/i, /final verdict/i, /블라인드/, /최종 판정/, /ab-simple/, /^\| S\d+ · /m]) {
      assert.doesNotMatch(text, banned, `${file} must not mention ${banned}`);
    }
  }
  for (const dir of [path.join(repoRoot, "docs", "ab-simple"), path.join(packageRoot, "readme-assets", "ab-simple")]) {
    assert.equal(fs.existsSync(dir), false, `${dir} must be gone`);
  }
});

test("skill table captures ship as identical repository and package copies", () => {
  const surfaces = [
    ["skills", path.join(repoRoot, "docs", "assets", "skills"), path.join(packageRoot, "readme-assets", "skills")],
  ];
  const files = {};
  for (const [folder, repoDir, packageDir] of surfaces) {
    files[folder] = fs.readdirSync(repoDir).sort();
    assert.deepEqual(fs.readdirSync(packageDir).sort(), files[folder], `${folder} package copy must hold the same files`);
    for (const name of files[folder]) {
      assert.match(name, /^[a-z0-9-]+\.webp$/, `${folder}/${name} must be a WebP capture`);
      assert.deepEqual(fs.readFileSync(path.join(packageDir, name)), fs.readFileSync(path.join(repoDir, name)), `${folder}/${name} package copy must match the repository copy`);
    }
  }
  assert.equal(files.skills.length, 36, "one snapshot per user-facing skill");
  for (const name of ["README.md", "README_Ko-KR.md"]) {
    // The npm card links to the GitHub gallery instead of repeating it.
    const card = fs.readFileSync(path.join(packageRoot, name), "utf8");
    assert.doesNotMatch(card, /\/skills\/[a-z0-9-]+\.webp/, `packages/lithermes-installer/${name} must leave the gallery to GitHub`);
  }
  for (const directory of [repoRoot]) {
    for (const name of ["README.md", "README_Ko-KR.md"]) {
      const file = path.join(directory, name);
      const text = fs.readFileSync(file, "utf8");
      const used = [...new Set([...text.matchAll(/\/skills\/([a-z0-9-]+\.webp)/g)].map((match) => match[1]))].sort();
      assert.deepEqual(used, files.skills, `${file} must show every skills image and no missing one`);
      const skillsAt = text.indexOf(name === "README.md" ? "\n## Skills\n" : "\n## 스킬\n");
      const skillsEnd = text.indexOf("\n## ", skillsAt + 1);
      const rows = [...text.slice(skillsAt, skillsEnd).matchAll(/<td><img src="[^"]*\/skills\/([a-z0-9-]+)\.webp" width="240" alt="[^"]+" \/><\/td>\n<td><code>([a-z0-9-]+)<\/code>/g)];
      assert.equal(rows.length, 36, `${file} skill table must hold 36 illustrated rows`);
      for (const [, image, id] of rows) assert.equal(image, id, `${file}: ${id} row must show its own snapshot`);
    }
  }
});

test("repository README links retain local approved artwork, motion and licensed icons", () => {
  const { createHash } = require("node:crypto");
  const assets = path.join(repoRoot, "docs", "assets", "readme");
  const digests = {
    "ascii-readme.svg": "1d95d4d8fbffa9826e789de56bbd773b01be69db496ae4d72657f21479a1e556",
    "badge-license.svg": "decba749e28b4b87635e62eae766899fdc3e91a8e312208ff152831f620b18d7",
    "lucide-book-open.svg": "3ae327cc4bbff19933a3ed535978ff558985b1bcca950e5484f61aa78764ebd2",
    "lucide-play.svg": "ab6e5f5c9e61ec2d8ddd6b93b5476b976c8a0086f5529142a7981284d85f8b83",
    "lucide-shield-check.svg": "aefbe606a9d7cf919208bbd64dfd453b83364f020585be43f32ba162fda4115c",
    "Lucide-LICENSE.txt": "b495047bd93a9b06913511076f504daba17d5bbeb3e0650f3bb53a4220329c57",
    "JetBrainsMono-OFL.txt": "a76abf002c49097d146e86740a3105a5d00450b1592e820a1109a8c5680cd697",
    "poster.png": "0fac2d0fc78d311710d1658968a45f8d9ff07ff73c6ca6f3ebc60bcb698d318f",
    "ignition-film.mp4": "b1579c89a677ab453765f77ae6361bd9730fabc4291a85071de7f373fc5ebfad",
    "ignition-readme.gif": "0be7badaee33df26a5a200c4f664273a21e9f2513fc066571f579f235220ca81",
  };
  for (const [name, digest] of Object.entries(digests)) {
    assert.equal(createHash("sha256").update(fs.readFileSync(path.join(assets, name))).digest("hex"), digest, name);
  }
  const packageAssets = path.join(packageRoot, "readme-assets");
  for (const name of ["ascii-readme.svg", "lucide-book-open.svg", "lucide-play.svg", "lucide-shield-check.svg", "Lucide-LICENSE.txt", "ignition-film.mp4"]) {
    assert.deepEqual(fs.readFileSync(path.join(packageAssets, name)), fs.readFileSync(path.join(assets, name)), `${name} package copy must match its licensed repository asset`);
  }
  const svg = fs.readFileSync(path.join(assets, "ascii-readme.svg"), "utf8");
  const mark = require("../src/lib/litMark");
  assert.deepEqual([...svg.matchAll(/<g aria-label="([^"]*)">/g)].map((match) => match[1]),
    mark.lockup("lithermes", mark.banner).map((row) => row.trimEnd()).filter(Boolean));
  assert.doesNotMatch(svg, /<(?:image|text|script|foreignObject)\b|\b(?:href|on\w+)\s*=|data:|url\(/i);
  const badge = fs.readFileSync(path.join(assets, "badge-version.svg"), "utf8");
  const version = require("../package.json").version;
  assert.ok(badge.includes(`aria-label="release: ${version}"`));
  assert.ok(badge.includes(`<title>release: ${version}</title>`));
  assert.ok(badge.includes(`fill="#080D14">${version}</text>`));
  assert.match(badge, /fill="#ff6337"/);
  assert.deepEqual(fs.readdirSync(assets).filter((name) => name.startsWith("lucide-")).sort(),
    ["lucide-book-open.svg", "lucide-play.svg", "lucide-shield-check.svg"]);
  for (const [name, guide, install] of [
    ["README.md", "guide.md", "install"],
    ["README_Ko-KR.md", "guide.ko.md", "설치"],
  ]) {
    const text = fs.readFileSync(path.join(repoRoot, name), "utf8");
    for (const [target, icon] of [
      [`./docs/${guide}`, "book-open"],
      ["./docs/assets/readme/ignition-film.mp4", "play"],
      ["./LICENSE", "shield-check"],
    ]) {
      assert.ok(text.includes(`<a href="${target}"><img src="./docs/assets/readme/lucide-${icon}.svg" width="16" alt="" />`), `${name} must use ${icon} in a meaningful link`);
    }
    assert.ok(text.includes(`href="#${install}"`), `${name} must link to its install section`);
    for (const match of text.matchAll(/(?:src|href)="(\.[^"]+)"|\]\((\.[^)]+)\)/g)) {
      const relative = match[1] || match[2];
      assert.ok(fs.statSync(path.resolve(repoRoot, relative)).isFile(), `${name}: ${relative} must resolve to a file`);
    }
    assert.doesNotMatch(text, /<img[^>]+(?:poster\.png|ignition-readme\.gif)/, "README artwork should stay within the shared decoration set");
    assert.doesNotMatch(text, /README visual draft|integrate resources and rerun/i);
  }
});

test("npm READMEs are short install-first cards that send readers to the GitHub README", () => {
  const install = "npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes --no-style";
  for (const [name, githubReadme] of [
    ["README.md", "https://github.com/wjgoarxiv/lithermes#readme"],
    ["README_Ko-KR.md", "https://github.com/wjgoarxiv/lithermes/blob/main/README_Ko-KR.md"],
  ]) {
    const card = fs.readFileSync(path.join(packageRoot, name), "utf8");
    const full = fs.readFileSync(path.join(repoRoot, name), "utf8");
    assert.ok(card.includes("](" + githubReadme + ")"), `${name} npm card must link its GitHub README`);
    const headings = [...card.matchAll(/^## .+$/gm)];
    assert.ok(headings.length >= 2, `${name} npm card needs sections`);
    const installAt = card.indexOf(install);
    assert.ok(installAt > headings[0].index && installAt < headings[1].index, `${name} npm card must put the install command in its first section`);
    for (const [label, measure] of [["bytes", (text) => Buffer.byteLength(text)], ["words", (text) => text.split(/\s+/).filter(Boolean).length]]) {
      const ratio = measure(card) / measure(full);
      assert.ok(ratio >= 0.2 && ratio <= 0.5, `${name} npm card must stay a short card, not a copy of the GitHub page (${label} ratio ${ratio.toFixed(2)})`);
    }
    assert.notEqual(card.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@litfamily\/lithermes@[^/]+\/readme-assets\//g, ""), full, `${name} npm card must differ from the GitHub page`);
    assert.equal(card.match(/^# .+$/m)?.[0], full.match(/^# .+$/m)?.[0], `${name} keeps the same name on both pages`);
    assert.ok(card.includes("**Keep the work lit.**") && full.includes("**Keep the work lit.**"), `${name} keeps the same tagline on both pages`);
  }
});

function localPublishPolicyErrors(text) {
  const errors = [];
  for (const command of findDirectNpmPublishCommands(text)) {
    if (command !== localPublishCommand) {
      errors.push(`unsupported direct publish command: ${command}`);
      continue;
    }
    const commandAt = text.indexOf(command);
    const prerequisites = text.slice(Math.max(0, commandAt - 5000), commandAt);
    const followUp = text.slice(commandAt, commandAt + 2500);
    for (const [pattern, message] of [
      [/HUMAN-ONLY/, "HUMAN-ONLY boundary"],
      [/packages\/lithermes-installer/, "package-root instruction"],
      [/clean main/i, "clean main prerequisite"],
      [/live origin\/main/i, "live origin/main alignment"],
      [/https:\/\/registry\.npmjs\.org\//, "public registry prerequisite"],
      [/npm whoami/, "npm identity prerequisite"],
      [/E404/, "target-version E404 prerequisite"],
      [/npm test/, "full test gate"],
      [/test:python/, "Python gate"],
      [/scan-forbidden-tokens/, "scanner gate"],
      [/qa:real-surface/, "real-surface gate"],
      [/sha-?256/i, "digest receipt"],
      [/explicit(?:ly)?[^\n]*approv/i, "explicit approval"],
      [/prepublishOnly/, "prepublishOnly guard"],
      [/source-only/, "source-only guard boundary"],
      [/not byte-identical/i, "npm repack boundary"],
    ]) {
      if (!pattern.test(prerequisites)) errors.push(`missing nearby ${message}`);
    }
    for (const [pattern, message] of [
      [/nonzero/i, "nonzero-result handling"],
      [/never blind-retry/i, "no blind retry rule"],
      [/npm view @litfamily\/lithermes@1\.0\.18 version/, "exact-version registry query"],
      [/published artifact/i, "published-artifact inspection"],
      [/npm pack @litfamily\/lithermes@1\.0\.18/, "published-artifact download"],
    ]) {
      if (!pattern.test(followUp)) errors.push(`missing nearby ${message}`);
    }
  }
  return errors;
}

test("English README and linked guide cover first use and operational details", () => {
  const text = read(path.join(packageRoot, "README.md"));
  for (const required of [
    "https://github.com/wjgoarxiv/lithermes",
    "https://www.npmjs.com/package/@litfamily/lithermes",
    "What it is",
    "Quick start",
    "First use",
    "Core commands",
    "Verify and uninstall",
    "Telegram gateway",
    "Safety",
    "Deeper docs",
    "npx --package @litfamily/lithermes -- lithermes doctor",
    "npx --package @litfamily/lithermes -- lithermes install --yes",
    "npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes",
    "bunx --package @litfamily/lithermes lithermes doctor",
    "bunx --package @litfamily/lithermes lithermes install --yes",
    "npx --package @litfamily/lithermes -- lithermes install --yes --no-spinner",
    "npx --package @litfamily/lithermes -- lithermes uninstall --yes --rollback-patches",
    "Hermes Goal Tools",
    "PREPARING INSTALL",
    "INSTALL RECEIPT",
  ]) {
    assert.match(text, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `README.md missing ${required}`);
  }
  assertCoverImage(text, "README.md");
  assert.doesNotMatch(text, /\/Users\/|PRIVATE_[A-Za-z0-9_-]+/);
});

test("Korean README and linked guide mirror core usage", () => {
  const text = read(path.join(packageRoot, "README_Ko-KR.md"));
  for (const required of [
    "https://github.com/wjgoarxiv/lithermes",
    "https://www.npmjs.com/package/@litfamily/lithermes",
    "무엇인가요",
    "빠른 시작",
    "첫 사용",
    "핵심 명령",
    "확인 및 삭제",
    "안전 모델",
    "더 읽을 문서",
    "npx --package @litfamily/lithermes -- lithermes doctor",
    "npx --package @litfamily/lithermes -- lithermes install --yes",
    "npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes",
    "bunx --package @litfamily/lithermes lithermes doctor",
    "bunx --package @litfamily/lithermes lithermes install --yes",
    "npx --package @litfamily/lithermes -- lithermes install --yes --no-spinner",
    "npx --package @litfamily/lithermes -- lithermes uninstall --yes --rollback-patches",
    "Hermes Goal Tools",
    "PREPARING INSTALL",
    "INSTALL RECEIPT",
  ]) {
    assert.match(text, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `README_Ko-KR.md missing ${required}`);
  }
  assertCoverImage(text, "README_Ko-KR.md");
  assert.doesNotMatch(text, /\/Users\/|PRIVATE_[A-Za-z0-9_-]+/);
});

test("root README files present polished GitHub landing pages", () => {
  const en = read(path.join(repoRoot, "README.md"));
  const ko = read(path.join(repoRoot, "README_Ko-KR.md"));
  for (const [file, text, packageDoc] of [
    ["README.md", en, "packages/lithermes-installer/README.md"],
    ["README_Ko-KR.md", ko, "packages/lithermes-installer/README_Ko-KR.md"],
  ]) {
    assertCoverImage(text, file, true);
    for (const required of [
      "https://github.com/wjgoarxiv/lithermes",
      "https://www.npmjs.com/package/@litfamily/lithermes",
      "@litfamily/lithermes@1.0.18",
      "Hermes Goal Tools",
      "PREPARING INSTALL",
      "INSTALL RECEIPT",
      "npx --package @litfamily/lithermes -- lithermes doctor",
      "npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes",
      "bunx --package @litfamily/lithermes lithermes doctor",
      "npx --package @litfamily/lithermes -- lithermes install --yes --no-spinner",
      "/lit",
      "/lit-loop",
      "/lit-plan",
      "/lit_loop",
      "/lit_plan",
      "Public retrieval hardening",
      "lit-burnoff-file",
      "lit-humanizer",
      "lit-code",
      "review-work",
      packageDoc,
    ]) {
      assert.match(text, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${file} missing ${required}`);
    }
    assert.doesNotMatch(text, /PRIVATE_[A-Za-z0-9_-]+/);
  }
});

test("English and Korean root/package docs explain the bounded Node update notice", () => {
  const docs = [
    ["README.md", read(path.join(repoRoot, "README.md"))],
    ["README_Ko-KR.md", read(path.join(repoRoot, "README_Ko-KR.md"))],
    ["packages/lithermes-installer/README.md", read(path.join(packageRoot, "README.md"))],
    ["packages/lithermes-installer/README_Ko-KR.md", read(path.join(packageRoot, "README_Ko-KR.md"))],
  ];
  for (const [label, text] of docs) {
    for (const required of [
      "update-check.json",
      "24",
      "install",
      "check",
      "doctor",
      "--offline",
      "--json",
      "--dry-run",
      "NO_UPDATE_NOTIFIER",
      "LITHERMES_NO_UPDATE_CHECK",
      "npx --yes --package @litfamily/lithermes@<version> -- lithermes install --yes --no-hud",
    ]) {
      assert.match(text, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${label} missing update-notice contract ${required}`);
    }
  }
});

test("package metadata points at the renamed GitHub repository", () => {
  const pkg = require(path.join(packageRoot, "package.json"));
  assert.equal(pkg.name, "@litfamily/lithermes");
   assert.equal(pkg.version, "1.0.18");
  assert.equal(pkg.bin.lithermes, "bin/lithermes.js");
  assert.equal(pkg.repository.type, "git");
  assert.equal(pkg.repository.url, "git+https://github.com/wjgoarxiv/lithermes.git");
  assert.equal(pkg.repository.directory, "packages/lithermes-installer");
  assert.equal(pkg.homepage, "https://www.npmjs.com/package/@litfamily/lithermes");
  assert.equal(pkg.bugs.url, "https://github.com/wjgoarxiv/lithermes/issues");
  for (const required of ["bin", "src", "assets", "README.md", "README_Ko-KR.md", "readme-assets"]) {
    assert.ok(pkg.files.includes(required), `package files missing ${required}`);
  }
  assert.ok(!pkg.files.includes("cover.png"), "the source cover must not be enrolled in npm");
});

test("release smoke docs use the published @litfamily\/lithermes npm package name", () => {
  const docs = [
    ["packages/lithermes-installer/README.md", read(path.join(packageRoot, "README.md"))],
    ["packages/lithermes-installer/README_Ko-KR.md", read(path.join(packageRoot, "README_Ko-KR.md"))],
  ];

  for (const [label, text] of docs) {
    const release = releaseChecklistSection(text);
    assert.match(release, /npx --yes --package @litfamily\/lithermes@latest -- lithermes doctor/, `${label} release smoke missing @litfamily\/lithermes doctor command`);
    assert.doesNotMatch(release, /npx\s+(?:--yes\s+)?lithermes@/i, `${label} release smoke must not call unpublished lithermes npm package`);
  }
});

test("direct npm publication detection allows warning prose but rejects executable commands", () => {
  for (const warning of [
    "Never run npm publish directly.",
    "The words `npm publish` may appear in a safety warning.",
  ]) {
    assert.deepEqual(findDirectNpmPublishCommands(warning), [], warning);
  }

  for (const [fixture, expected] of [
    ["```sh\nnpm publish\n```", ["npm publish"]],
    ["```bash\n$ npm publish --access public\n```", ["$ npm publish --access public"]],
    ["npm --prefix . publish", ["npm --prefix . publish"]],
  ]) {
    assert.deepEqual(findDirectNpmPublishCommands(fixture), expected, fixture);
  }

  assert.notDeepEqual(
    localPublishPolicyErrors("## HUMAN-ONLY\n```sh\nnpm publish --access public\n```"),
    [],
    "a bare direct command without nearby prerequisites must remain unsafe",
  );
  const sanctioned = `
## HUMAN-ONLY local path
Run from packages/lithermes-installer only after explicit approval: clean main must equal live origin/main.
Use https://registry.npmjs.org/, npm whoami, and require target E404. Run npm test, test:python,
scan-forbidden-tokens, qa:real-surface, and retain the SHA-256 receipt. The prepublishOnly source-only
guard protects this path, but its inspected preflight archive is not byte-identical because npm repacks.
\`\`\`sh
npm publish --access public
\`\`\`
After any nonzero result, npm view @litfamily\/lithermes@1.0.18 version and never blind-retry. After success,
download the published artifact with npm pack @litfamily\/lithermes@1.0.18 and inspect it.
`;
  assert.deepEqual(localPublishPolicyErrors(sanctioned), [], "a fully sanctioned HUMAN-ONLY block must pass");
});

test("the release checklist exposes one guarded HUMAN-ONLY publication path", () => {
  const docs = [
    ["RELEASE_CHECKLIST.md", read(path.join(repoRoot, "RELEASE_CHECKLIST.md"))],
  ];
  for (const [label, text] of docs) {
    assert.deepEqual(
      findDirectNpmPublishCommands(text),
      [localPublishCommand],
      `${label} must expose exactly one sanctioned local publication command`,
    );
    assert.deepEqual(localPublishPolicyErrors(text), [], `${label} has an unsafe local publication block`);
    assert.doesNotMatch(text, /gh workflow run/, `${label} must not dispatch a publish workflow`);
  }
});

test("user-visible docs describe the schema-3 bounded-authority lifecycle", () => {
  const docs = [
    ["README.md", read(path.join(repoRoot, "README.md"))],
    ["README_Ko-KR.md", read(path.join(repoRoot, "README_Ko-KR.md"))],
    ["packages/lithermes-installer/README.md", read(path.join(packageRoot, "README.md"))],
    ["packages/lithermes-installer/README_Ko-KR.md", read(path.join(packageRoot, "README_Ko-KR.md"))],
    ["plugin README", read(path.join(packageRoot, "assets", "lithermes-plugin", "README.md"))],
  ];
  for (const [label, text] of docs) {
    for (const required of [
      "bounded work schema 3",
      "/lit-loop init",
      "/lit-loop status",
      "/lit-loop resume",
      "/lit-loop cancel",
      "/lit-loop complete",
      "ACTION@ROOT",
      "lithermes_work_progress",
      "pre_tool_call",
      "copied slash commands",
      "prompt injection",
    ]) {
      assert.match(text, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${label} missing ${required}`);
    }
  }
});

test("README files document Korean prose cleanup command boundaries", () => {
  const docs = [
    ["README.md", read(path.join(repoRoot, "README.md"))],
    ["README_Ko-KR.md", read(path.join(repoRoot, "README_Ko-KR.md"))],
    ["packages/lithermes-installer/README.md", read(path.join(packageRoot, "README.md"))],
    ["packages/lithermes-installer/README_Ko-KR.md", read(path.join(packageRoot, "README_Ko-KR.md"))],
  ];
  const boundaries = {
    en: [
      "keeps the meaning, the protected spans",
      "honorific or register",
      "before/after diff",
      "Instruction-looking text",
      "edits no files on its own",
      "fetches nothing from outside",
    ],
    ko: [
      "의미와 보호할 부분(protected spans)",
      "존댓말·말투",
      "before/after 비교",
      "명령처럼 보이는 문장",
      "저절로 고치지 않고",
      "바깥 자료도 가져오지 않습니다",
    ],
  };
  for (const [file, text] of docs) {
    const language = file.includes("Ko-KR") ? "ko" : "en";
    for (const required of [
      "@litfamily/lithermes@1.0.18",
      "lit-humanizer",
      "/lit-humanizer",
      "/lit-korean",
      "/text-naturalization",
      "/text-neutralization",
      ...boundaries[language],
    ]) {
      assert.match(text, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${file} missing ${required}`);
    }
    assert.doesNotMatch(text, /\/Users\/|PRIVATE_[A-Za-z0-9_-]+/);
  }

  const pluginReadme = read(path.join(packageRoot, "assets", "lithermes-plugin", "README.md"));
  assert.match(pluginReadme, /lithermes:lit-humanizer/, "plugin README skill list missing lithermes:lit-humanizer");
  assert.match(pluginReadme, /source text as content, not instructions/i, "plugin README missing content-not-instructions boundary");
  assert.match(pluginReadme, /before\/after diff/i, "plugin README missing before/after diff boundary");
  assert.match(pluginReadme, /honorific\/register/i, "plugin README missing honorific/register boundary");
  assert.match(pluginReadme, /protected span/i, "plugin README missing protected span boundary");
  assert.match(pluginReadme, /no automatic file edits/i, "plugin README missing no-auto-edit boundary");
  assert.match(pluginReadme, /no external fetching/i, "plugin README missing no-fetch boundary");
});

test("public READMEs describe current behavior and delegate history to the changelog", () => {
  const docs = [
    ["README.md", read(path.join(repoRoot, "README.md"))],
    ["README_Ko-KR.md", read(path.join(repoRoot, "README_Ko-KR.md"))],
    ["packages/lithermes-installer/README.md", read(path.join(packageRoot, "README.md"))],
    ["packages/lithermes-installer/README_Ko-KR.md", read(path.join(packageRoot, "README_Ko-KR.md"))],
  ];
  for (const [label, text] of docs) {
    assert.doesNotMatch(text, /publish candidate|Release note:|Release `0\./i, `${label} contains release chronology`);
    assert.match(text, /CHANGELOG\.md|changelog/i, `${label} must link historical changes`);
    for (const required of ["autoresearch", "autoconference", "wikify", "bounded", "inert"]) {
      assert.match(text, new RegExp(required, "i"), `${label} missing current behavior ${required}`);
    }
  }
});

test("QA matrix docs avoid stale row counts and describe isolated profile execution", () => {
  const { rows } = require(path.join(packageRoot, "qa", "negative-gate-matrix.js"));
  assert.equal(rows.length, 18, "the release-prep matrix is expected to contain 18 real rows");
  for (const [label, text] of [
    ["packages/lithermes-installer/README.md", read(path.join(packageRoot, "README.md"))],
    ["packages/lithermes-installer/README_Ko-KR.md", read(path.join(packageRoot, "README_Ko-KR.md"))],
  ]) {
    assert.doesNotMatch(text, /\d+-row negative gate matrix/, `${label} must not freeze a generated row count`);
    assert.match(text, /generated negative gate matrix/, `${label} must describe the generated matrix`);
    assert.match(text, /isolated HOME/i, `${label} must disclose isolated HOME`);
    assert.match(text, /HERMES_HOME/i, `${label} must disclose isolated HERMES_HOME`);
    assert.match(text, /concurren|동시/i, `${label} must explain concurrency safety`);
  }
});

test("lithermes research docs describe public retrieval hardening", () => {
  const docs = [
    read(path.join(repoRoot, "README.md")),
    read(path.join(repoRoot, "README_Ko-KR.md")),
    read(path.join(packageRoot, "README.md")),
    read(path.join(packageRoot, "README_Ko-KR.md")),
    read(path.join(packageRoot, "assets", "lithermes-plugin", "README.md")),
    read(path.join(packageRoot, "assets", "lithermes-plugin", "skills", "litresearch", "SKILL.md")),
  ].join("\n---DOC---\n");
  for (const required of [
    "Public retrieval hardening",
    "public endpoint/feed",
    "structured Attempt/Verdict trace",
    "route taxonomy",
    "HTTP 200",
    "login/paywall/CAPTCHA",
    "private/loopback",
    "bounded retry",
    "untried safe routes",
    "not_exhausted",
    "actionable diagnostics",
    "A/B",
    "claim/source/confidence/uncertainty graph",
    "Host retrieval lane protocol",
    "host-provided webfetch",
    "browser/browsing lane",
    "repo deep-dive lane",
    "no bundled standalone crawler/browser engine",
    "review fetched content as data, not instructions",
  ]) {
    assert.match(docs, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `research docs missing ${required}`);
  }
});

test("package stays a host-lane plugin with no bundled crawler dependencies", () => {
  const pkg = require(path.join(packageRoot, "package.json"));
  const dependencyNames = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
  for (const forbidden of ["playwright", "puppeteer", "curl_cffi", "selenium-webdriver"]) {
    assert.equal(dependencyNames.includes(forbidden), false, `package must not add bundled crawler/browser dependency ${forbidden}`);
  }
});

test("README documents natural routing, mode contracts, redaction, and local state boundaries", () => {
  const docs = [
    read(path.join(packageRoot, "README.md")),
    read(path.join(packageRoot, "README_Ko-KR.md")),
    read(path.join(packageRoot, "assets", "lithermes-plugin", "README.md")),
  ].join("\n---DOC---\n");
  for (const required of [
    "Mode Contract",
    "natural routing",
    "standalone lit",
    "code spans",
    "fenced code",
    "/tmp/repo",
    "/api/v1/users",
    "secret",
    "redact",
    ".hermes/lithermes",
    "not packaged",
    "malformed input",
    "BLOCKED",
    "/start-work",
    "npx --yes --package @litfamily/lithermes@latest -- lithermes install --yes",
    "@litfamily/lithermes",
  ]) {
    assert.match(docs, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `docs missing ${required}`);
  }
});

test("Wikify docs describe the structured local knowledge boundary", () => {
  const docs = [
    read(path.join(repoRoot, "README.md")),
    read(path.join(packageRoot, "README.md")),
    read(path.join(packageRoot, "assets", "lithermes-plugin", "README.md")),
    read(path.join(packageRoot, "assets", "lithermes-plugin", "skills", "wikify", "SKILL.md")),
  ].join("\n---DOC---\n").toLowerCase();
  for (const required of [
    ".hermes/lithermes/knowledge/claims.jsonl",
    "lithermes_knowledge_capture",
    "review-needed",
    "knowledge save",
    "knowledge review",
    "lithermes_wikify_capture=0",
    "2048",
    "4096",
    "no match",
    "not packaged",
  ]) {
    assert.ok(docs.includes(required), `Wikify docs missing ${required}`);
  }
});

test("Wikify docs separate public authority from default-on local capture and state platform limits", () => {
  const docs = [
    ["root README.md", read(path.join(repoRoot, "README.md"))],
    ["root README_Ko-KR.md", read(path.join(repoRoot, "README_Ko-KR.md"))],
    ["package README.md", read(path.join(packageRoot, "README.md"))],
    ["package README_Ko-KR.md", read(path.join(packageRoot, "README_Ko-KR.md"))],
    ["plugin README", read(path.join(packageRoot, "assets", "lithermes-plugin", "README.md"))],
    ["wikify skill", read(path.join(packageRoot, "assets", "lithermes-plugin", "skills", "wikify", "SKILL.md"))],
  ];
  for (const [label, text] of docs) {
    assert.match(text, /narrow product-local review-needed exception|좁은 product-local review-needed 예외/i, `${label} must state the narrow capture exception`);
    assert.match(text, /does not write wiki pages or public sources|wiki page와 public source를 쓰지 않/i, `${label} must keep public authority wording bounded`);
    assert.match(text, /descriptor-pinned POSIX|POSIX descriptor-pinned|Windows[\s\S]{0,180}unsupported-platform-pinned-write/i, `${label} must document platform compatibility`);
  }
});

test("plugin README documents the LLM contract schema without turning marketing docs into prompt dumps", () => {
  const pluginReadme = read(path.join(packageRoot, "assets", "lithermes-plugin", "README.md"));
  for (const required of [
    "LLM Contract Schema",
    "lithermes_llm_contract/v1",
    "#contract.activation",
    "#contract.inputs",
    "#contract.mode_matrix",
    "#contract.procedure",
    "#contract.outputs",
    "#contract.evidence",
    "#contract.hard_stops",
    "#contract.anti_patterns",
    "plugin.yaml",
    "pre_llm_call",
    "subagent_stop",
    "goal_*",
    "payload hash refresh",
  ]) {
    assert.match(pluginReadme, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `plugin README missing ${required}`);
  }
});

test("public and package docs describe native goals as user-managed and unobserved", () => {
  const docs = [
    ["README.md", read(path.join(repoRoot, "README.md"))],
    ["README_Ko-KR.md", read(path.join(repoRoot, "README_Ko-KR.md"))],
    ["packages/lithermes-installer/README.md", read(path.join(packageRoot, "README.md"))],
    ["packages/lithermes-installer/README_Ko-KR.md", read(path.join(packageRoot, "README_Ko-KR.md"))],
    ["assets/lithermes-plugin/README.md", read(path.join(packageRoot, "assets", "lithermes-plugin", "README.md"))],
  ];

  for (const [label, text] of docs) {
    for (const required of ["user-managed", "unobserved", "authoritative", "no automatic update, clear, or resume"]) {
      assert.match(text, new RegExp(required, "i"), `${label} missing ${required}`);
    }
    assert.doesNotMatch(text, /LitHermes binds the native standing|bind native \/goal \+|plan \+ native \/goal bind/i);
  }
});

test("Jev screenshots ship on the GitHub pages only, in both themes, with alt text taken from what the plugin prints", () => {
  const dir = path.join(repoRoot, "docs", "assets", "jev");
  const stems = ["jev-first-reply", "jev-first-reply-note", "jev-status-before", "jev-status-on"];
  const expected = stems.flatMap((stem) => [`${stem}-dark.webp`, `${stem}-light.webp`]).sort();
  assert.deepEqual(fs.readdirSync(dir).sort(), expected, "docs/assets/jev must hold exactly the four pictures in dark and light");
  for (const name of expected) {
    const bytes = fs.readFileSync(path.join(dir, name));
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF", `${name} must be a WebP`);
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP", `${name} must be a WebP`);
    assert.ok(bytes.length <= 100_000, `${name} must stay small (${bytes.length} bytes)`);
  }
  // The strings in the pictures come from the plugin source, so a rewording there fails here.
  const source = fs.readFileSync(path.join(packageRoot, "assets", "lithermes-plugin", "jev_hint.py"), "utf8");
  for (const printed of ["✦ Jev skill hint ON", "on — no hint yet", "flag on but TYPESAFE_API_KEY missing", "LitHermes skill hint unavailable (", "continuing normally.", "Jev skill hint: "]) {
    assert.ok(source.includes(printed), `jev_hint.py no longer prints: ${printed}`);
  }
  for (const [name, lang] of [["README.md", "en"], ["README_Ko-KR.md", "ko"]]) {
    const text = fs.readFileSync(path.join(repoRoot, name), "utf8");
    const jevAt = text.indexOf(lang === "en" ? "\n## Optional: Jev skill hint\n" : "\n## 선택 기능: Jev 스킬 힌트\n");
    const jevEnd = text.indexOf("\n## ", jevAt + 1);
    const section = text.slice(jevAt, jevEnd);
    assert.ok(section.includes(lang === "en" ? "### What you will see" : "### 화면에서 보이는 것"), `${name} needs its what-you-will-see subsection inside the Jev section`);
    const pictures = [...section.matchAll(/<picture><source media="\(prefers-color-scheme: dark\)" srcset="\.\/docs\/assets\/jev\/([a-z-]+)-dark\.webp" \/><img src="\.\/docs\/assets\/jev\/([a-z-]+)-light\.webp" width="690" alt="([^"]+)" \/><\/picture>/g)];
    assert.deepEqual(pictures.map((match) => match[1]), stems, `${name} must show the four pictures in order`);
    for (const [, dark, light, alt] of pictures) {
      assert.equal(dark, light, `${name}: dark and light must be the same picture`);
      assert.ok(alt.length > 60, `${name}: ${dark} alt text must state the exact text shown`);
    }
    assert.ok(pictures[0][3].includes("✦ Jev skill hint ON"), `${name}: the first-reply alt must quote the banner`);
    assert.ok(pictures[3][3].includes("last hint lit-humanizer (0.42s)"), `${name}: the status alt must quote the status line`);
    // Every caption says whether a picture is a capture or sample output.
    const captions = [...section.matchAll(/^\*([^*\n]+)\*$/gm)].map((match) => match[1]);
    assert.equal(captions.length, 4, `${name} needs one caption per picture`);
    for (const caption of captions) assert.match(caption, lang === "en" ? /^(Sample output|Captured)/ : /(예시 출력|얻은 출력)/, `${name}: caption must label the picture honestly`);
  }
  // The npm card and the package stay free of the pictures.
  const manifest = require("../package.json");
  assert.ok(!manifest.files.some((entry) => entry.startsWith("docs")), "docs must not be enrolled in the package");
  assert.ok(!fs.existsSync(path.join(packageRoot, "readme-assets", "jev")), "the package must not carry copies of the Jev pictures");
  for (const name of ["README.md", "README_Ko-KR.md"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(packageRoot, name), "utf8"), /assets\/jev|jev-[a-z-]+\.webp/, `${name} npm card must not embed the pictures`);
  }
});

test("every README page explains the automatic handoff honestly: off by default, the user's own percent, who does each step", () => {
  const source = fs.readFileSync(path.join(packageRoot, "assets", "lithermes-plugin", "auto_handoff.py"), "utf8");
  // The wording the pages quote comes from the plugin source, so a rewording there fails here.
  for (const printed of ["Handoff saved. Run", "LITHERMES_AUTO_HANDOFF", "LITHERMES_AUTO_HANDOFF_PERCENT", "/lit-handoff auto", "a whole number from 1 to 99", "auto-handoff.json", "Automatic handoff: "]) {
    assert.ok(source.includes(printed), `auto_handoff.py no longer carries: ${printed}`);
  }
  const pages = [
    ["README.md", repoRoot, "## Automatic handoff\n"],
    ["README_Ko-KR.md", repoRoot, "## 자동 핸드오프\n"],
    ["README.md", packageRoot, "## Automatic handoff\n"],
    ["README_Ko-KR.md", packageRoot, "## 자동 핸드오프\n"],
  ];
  for (const [name, directory, heading] of pages) {
    const file = path.join(directory, name);
    const text = fs.readFileSync(file, "utf8");
    const start = text.indexOf(`\n${heading}`);
    assert.ok(start > 0, `${file} needs its automatic handoff section`);
    const section = text.slice(start, text.indexOf("\n## ", start + 1));
    for (const required of ["/lit-handoff auto on", "/lit-handoff auto off", "/lit-handoff auto status", "LITHERMES_AUTO_HANDOFF=1", "LITHERMES_AUTO_HANDOFF_PERCENT", "/compact"]) {
      if (directory === packageRoot && required.startsWith("/lit-handoff auto o") && required !== "/lit-handoff auto on") continue;
      assert.ok(section.includes(required), `${file} automatic handoff section must mention ${required}`);
    }
    assert.match(section, /1[^0-9]+99/, `${file} must state the 1 to 99 range`);
    assert.doesNotMatch(section, /기본 ?퍼센트는 \d|default (percent|value) (is|of) \d/i, `${file} must not promise a built-in percent`);
    if (directory === repoRoot) {
      assert.match(section, /\| Step \| |\| 단계 \| /, `${file} must label each step in a table`);
      for (const who of name === "README.md" ? ["Automatic", "You, with `/compact`"] : ["자동입니다", "사용자가 `/compact`"]) {
        assert.ok(section.includes(who), `${file} must say who does each step (${who})`);
      }
    }
  }
});

test("the motion promo ships on the GitHub pages only, inside its size caps, and the pages label it honestly", () => {
  const { createHash } = require("node:crypto");
  const dir = path.join(repoRoot, "docs", "assets", "promo");
  assert.deepEqual(fs.readdirSync(dir).sort(), ["promo-ko.mp4", "promo-poster-ko.webp", "promo-poster.webp", "promo-preview-ko.webp", "promo-preview.webp", "promo-reduced-motion-ko.webp", "promo-reduced-motion.webp", "promo.mp4", "source"], "docs/assets/promo must hold each film, its preview, its poster and its reduced-motion still, and the film source");
  assert.deepEqual(fs.readdirSync(path.join(dir, "source")).sort(), ["Pretendard-OFL.txt", "stage-en.html", "stage-ko.html", "treatment-en.json", "treatment-ko.json"], "the film source must keep the Pretendard license beside the pages");
  const digest = (name) => createHash("sha256").update(fs.readFileSync(path.join(dir, name))).digest("hex");
  const pins = {
    "promo.mp4": "5ac75c6feffcc503d8bd90d19986a39d3081cd3316ca46e73481726e29914cc6",
    "promo-preview.webp": "21906d2054266bc908951b1ef681540a7adf7a2aa77681517c585490e817fe5e",
    "promo-poster.webp": "9a56203c046d35535c1c682b91d2f5b819695a2b26663a5146c918650d341d14",
    "promo-reduced-motion.webp": "fd59c5313a815a16cb8cfb3822400e0abe0bf5e27cfe4ee4b2a93680869c46b1",
    "promo-ko.mp4": "640061beb6b3c9e09f1ca6ca278d7bfb1cb0d893c54d2a5a3c8c1fa821239b9f",
    "promo-preview-ko.webp": "7ca7310c7a70114fdf5d7d28cae25e9b1327f4923ab4245c7b66c2106ef250f3",
    "promo-poster-ko.webp": "65470f5e8258561869ecfd5bf2785e6edb18d45d788bff9dd16c3e4497d0d056",
    "promo-reduced-motion-ko.webp": "fd59c5313a815a16cb8cfb3822400e0abe0bf5e27cfe4ee4b2a93680869c46b1",
  };
  for (const [name, sha] of Object.entries(pins)) assert.equal(digest(name), sha, `${name} changed; update the pin together with the README embedding`);
  for (const name of ["promo.mp4", "promo-ko.mp4"]) {
    const film = fs.readFileSync(path.join(dir, name));
    assert.equal(film.toString("ascii", 4, 8), "ftyp", `${name} must be an MP4`);
    assert.ok(film.length <= 8 * 1024 * 1024, `${name} must stay under 8 MiB (${film.length} bytes)`);
  }
  for (const name of Object.keys(pins).filter((file) => file.endsWith(".webp"))) {
    const bytes = fs.readFileSync(path.join(dir, name));
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF", `${name} must be a WebP`);
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP", `${name} must be a WebP`);
    if (name.startsWith("promo-preview")) assert.ok(bytes.length <= 2_621_440, `${name} must stay under 2.5 MiB (${bytes.length} bytes)`);
  }
  // The film is set in Pretendard and the drawn terminal in the monospace face; no other family is asked for.
  for (const stage of ["stage-en.html", "stage-ko.html"]) {
    const page = fs.readFileSync(path.join(dir, "source", stage), "utf8");
    const families = new Set([...page.matchAll(/font-family:\s*"([^"]+)"/g)].map((match) => match[1]));
    assert.deepEqual([...families].sort(), ["MesloLGS NF", "Pretendard"], `${stage} must use Pretendard and MesloLGS NF only`);
    assert.doesNotMatch(page, /font-weight:\s*(?!400|700)\d+/, `${stage} must ask for weights 400 and 700 only`);
    assert.doesNotMatch(page, /letter-spacing|font-stretch/, `${stage} must not animate tracking or width`);
  }
  assert.match(fs.readFileSync(path.join(dir, "source", "Pretendard-OFL.txt"), "utf8"), /SIL Open Font License, Version 1\.1/);
  for (const [name, lang] of [["README.md", "en"], ["README_Ko-KR.md", "ko"]]) {
    const suffix = lang === "en" ? "" : "-ko";
    const text = fs.readFileSync(path.join(repoRoot, name), "utf8");
    const start = text.indexOf(lang === "en" ? "\n## Watch it in motion\n" : "\n## 움직이는 모습 보기\n");
    const section = text.slice(start, text.indexOf("\n## ", start + 1));
    assert.ok(start > text.indexOf(lang === "en" ? "\n## Quick start\n" : "\n## 빠른 시작\n"), `${name}: the film belongs after the quick start`);
    const picture = section.match(new RegExp(`<p align="center"><a href="\\./docs/assets/promo/promo${suffix}\\.mp4"><picture><source media="\\(prefers-reduced-motion: reduce\\)" srcset="\\./docs/assets/promo/promo-reduced-motion${suffix}\\.webp" /><img src="\\./docs/assets/promo/promo-preview${suffix}\\.webp" width="100%" alt="([^"]+)" /></picture></a></p>`));
    assert.ok(picture, `${name}: the film needs the reduced-motion source first, the preview as the img and the MP4 as its link`);
    assert.ok(picture[1].length > 200 && picture[1].includes("Keep the work lit."), `${name}: the alt text must describe the film`);
    assert.ok(section.includes(`](./docs/assets/promo/promo${suffix}.mp4)`), `${name}: the MP4 needs its own text link`);
    assert.match(section, lang === "en" ? /^\*The request and the sample replies in the film are examples\./m : /^\*영상 속 요청과 응답은 예시입니다\./m, `${name}: the caption must say what is an example`);
    assert.ok(text.indexOf(section) > text.indexOf("cover-motion.webp") && text.startsWith('<p align="center"><picture>'), `${name}: the first-screen cover stays where it was`);
  }
  // Every string the film shows as product output comes from the plugin or the skin.
  const plugin = path.join(packageRoot, "assets", "lithermes-plugin");
  const mark = fs.readFileSync(path.join(plugin, "lit_mark.py"), "utf8");
  assert.ok(mark.includes("LIT IGNITED"), "lit_mark.py must still print LIT IGNITED");
  const skin = fs.readFileSync(path.join(packageRoot, "src", "lib", "skins.js"), "utf8");
  for (const shown of ["LIT ready", "stay lit", "#FF6337", "#D7F75B", "#F2EFDF", "#080D14"]) {
    assert.ok(skin.includes(shown), `the installer no longer ships the skin string the film shows: ${shown}`);
  }
  // The film stays out of the package.
  const manifest = require("../package.json");
  assert.ok(!manifest.files.some((entry) => entry.startsWith("docs")), "docs must not be enrolled in the package");
  assert.ok(!fs.readdirSync(path.join(packageRoot, "readme-assets")).some((name) => /promo/.test(name)), "the package must not carry the promo");
  for (const name of ["README.md", "README_Ko-KR.md"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(packageRoot, name), "utf8"), /promo/, `${name} npm card must not embed the promo`);
  }
});

test("terminal screens ship on the GitHub pages only, in both themes, with captions that say capture or illustration", () => {
  const dir = path.join(repoRoot, "docs", "assets", "screens");
  const stems = ["install", "doctor", "welcome", "lit-ack", "update-notice"];
  const expected = stems.flatMap((stem) => [`${stem}-dark.webp`, `${stem}-light.webp`]).sort();
  assert.deepEqual(fs.readdirSync(dir).sort(), expected, "docs/assets/screens must hold exactly the five pictures in dark and light");
  for (const name of expected) {
    const bytes = fs.readFileSync(path.join(dir, name));
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF", `${name} must be a WebP`);
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP", `${name} must be a WebP`);
    assert.ok(bytes.length <= 61_440, `${name} must stay near 60 KiB (${bytes.length} bytes)`);
  }
  // Every string the pictures show comes from the installer or the plugin, so a rewording there fails here.
  const lib = (name) => fs.readFileSync(path.join(packageRoot, "src", "lib", name), "utf8");
  const plugin = (name) => fs.readFileSync(path.join(packageRoot, "assets", "lithermes-plugin", name), "utf8");
  for (const [source, printed] of [
    [fs.readFileSync(path.join(packageRoot, "src", "cli.js"), "utf8"), "Motion runtime: pre-warm skipped (--offline)"],
    [lib("install.js"), "Installed LitHermes"],
    [lib("check.js"), "LitHermes check PASS"],
    [lib("check.js"), "installed skill payload"],
    [lib("check.js"), "PASS (native PluginContext.inject_message)"],
    [lib("updateNotifier.js"), "LitHermes update available:"],
    [lib("updateNotifier.js"), "Then restart the Hermes CLI and any Hermes gateways."],
    [lib("skins.js"), "LIT ready"],
    [lib("skins.js"), "stay lit"],
    [plugin("lit_mark.py"), "LIT IGNITED · "],
  ]) assert.ok(source.includes(printed), `the product no longer prints: ${printed}`);
  const labels = { en: /^(Captured|Illustration)/, ko: /(얻은 출력|예시 그림)/ };
  for (const [name, lang] of [["README.md", "en"], ["README_Ko-KR.md", "ko"]]) {
    const text = fs.readFileSync(path.join(repoRoot, name), "utf8");
    const start = text.indexOf(lang === "en" ? "\n### What you will see on your first run\n" : "\n### 처음 실행하면 보이는 것\n");
    const section = text.slice(start, text.indexOf("\n## ", start + 1));
    assert.ok(start > text.indexOf(lang === "en" ? "\n## Quick start\n" : "\n## 빠른 시작\n"), `${name}: the screens belong inside the quick start`);
    const pictures = [...section.matchAll(/<picture><source media="\(prefers-color-scheme: dark\)" srcset="\.\/docs\/assets\/screens\/([a-z-]+)-dark\.webp" \/><img src="\.\/docs\/assets\/screens\/([a-z-]+)-light\.webp" width="690" alt="([^"]+)" \/><\/picture>/g)];
    assert.deepEqual(pictures.map((match) => match[1]), stems, `${name} must show the five pictures in order`);
    for (const [, dark, light, alt] of pictures) {
      assert.equal(dark, light, `${name}: dark and light must be the same picture`);
      assert.ok(alt.length > 150, `${name}: ${dark} alt text must state the exact text shown`);
    }
    const { version } = require("../package.json");
    assert.ok(pictures[0][3].includes(`Installed LitHermes ${version}`), `${name}: the install alt must quote the first line`);
    assert.ok(pictures[3][3].includes("🔥 LIT IGNITED · litwork 🔥"), `${name}: the acknowledgement alt must quote the line`);
    assert.ok(pictures[4][3].includes(`LitHermes update available: ${version} → 1.0.19`), `${name}: the notice alt must quote the notice`);
    const captions = [...section.matchAll(/^\*([^*\n]+)\*$/gm)].map((match) => match[1]);
    assert.equal(captions.length, 5, `${name} needs one caption per picture`);
    for (const caption of captions) assert.match(caption, labels[lang], `${name}: caption must label the picture honestly`);
    assert.equal(captions.filter((caption) => (lang === "en" ? /^Illustration/ : /예시 그림/).test(caption)).length, 1, `${name}: exactly the acknowledgement picture is an illustration`);
    assert.ok(section.includes(lang === "en" ? "(#optional-jev-skill-hint)" : "(#선택-기능-jev-스킬-힌트)"), `${name}: link to the Jev pictures instead of repeating them`);
  }
  const manifest = require("../package.json");
  assert.ok(!manifest.files.some((entry) => entry.startsWith("docs")), "docs must not be enrolled in the package");
  assert.ok(!fs.existsSync(path.join(packageRoot, "readme-assets", "screens")), "the package must not carry copies of the screens");
  for (const name of ["README.md", "README_Ko-KR.md"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(packageRoot, name), "utf8"), /assets\/screens|(?:install|doctor|welcome|lit-ack|update-notice)-(?:dark|light)\.webp/, `${name} npm card must not embed the pictures`);
  }
});
