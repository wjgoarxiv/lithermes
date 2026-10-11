const fs = require("node:fs");
const path = require("node:path");
const { parseDocument } = require("yaml");
const { writeFileAtomic } = require("./files");
const modelConfig = require("./modelConfig");

function configPath(hermesHome) {
  return path.join(hermesHome, "config.yaml");
}

function readConfig(hermesHome) {
  const file = configPath(hermesHome);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function findPluginsBlock(lines) {
  const block = findTopBlock(lines, "plugins");
  return block && { ...block, lines: lines.slice(block.start, block.end) };
}

function configHasLitHermes(text) {
  const block = findPluginsBlock(text.split(/\r?\n/));
  if (!block) return false;
  return block.lines.some((line, index) => {
    if (/^\s*enabled:\s*\[[^\]]*lithermes[^\]]*\]/.test(line)) return true;
    if (!/^\s*enabled:(\s+#.*)?\s*$/.test(line)) return false;
    for (let i = index + 1; i < block.lines.length; i += 1) {
      const child = block.lines[i];
      if (/^\s{2}\S/.test(child) && !/^\s{2,}-/.test(child)) return false;
      if (/^\s*-\s*lithermes\s*$/.test(child)) return true;
    }
    return false;
  });
}

function enableLitHermesConfig(text) {
  if (configHasLitHermes(text)) return text;
  if (!text.trim()) {
    return "plugins:\n  enabled:\n    - lithermes\n";
  }
  const eol = eolOf(text);
  const trailingNewline = text.endsWith("\n");
  const lines = text.split(/\r?\n/);
  if (trailingNewline) lines.pop();
  const block = findPluginsBlock(lines);
  if (block) {
    openBlock(lines, block);
    for (let i = block.start + 1; i < block.end; i += 1) {
      const line = lines[i];
      if (/^\s{2}enabled:\s*\[[^\]]*\]/.test(line)) {
        lines[i] = line.replace(/\[([^\]]*)\]/, (_match, inner) => {
          const values = inner.split(",").map((item) => item.trim()).filter(Boolean);
          values.push("lithermes");
          return `[${values.join(", ")}]`;
        });
        return `${lines.join(eol)}${trailingNewline ? eol : ""}`;
      }
      if (/^\s{2}enabled:(\s+#.*)?\s*$/.test(line)) {
        // Match the list's own indentation; Hermes writes indentless sequences.
        const next = lines.slice(i + 1, block.end).find((item) => item.trim() && !/^\s*#/.test(item));
        const indent = /^(\s*)-(\s|$)/.exec(next || "")?.[1] ?? "    ";
        lines.splice(i + 1, 0, `${indent}- lithermes`);
        return `${lines.join(eol)}${trailingNewline ? eol : ""}`;
      }
    }
    lines.splice(block.start + 1, 0, "  enabled:", "    - lithermes");
    return `${lines.join(eol)}${trailingNewline ? eol : ""}`;
  }
  const suffix = trailingNewline ? "" : eol;
  return `${text}${suffix}${["plugins:", "  enabled:", "    - lithermes", ""].join(eol)}`;
}

function disableLitHermesConfig(text) {
  const eol = eolOf(text);
  const trailingNewline = text.endsWith("\n");
  const lines = text.split(/\r?\n/);
  if (trailingNewline) lines.pop();
  const block = findPluginsBlock(lines);
  if (!block) return text;
  let inEnabled = false;
  for (let i = block.start + 1; i < block.end; i += 1) {
    const line = lines[i];
    // Only plugins.enabled items are removed; a `disabled:` entry belongs to the user.
    if (/^\s+[^\s#-]/.test(line)) inEnabled = /^\s+enabled:(\s+#.*)?\s*$/.test(line);
    if (/^\s{2}enabled:\s*\[[^\]]*lithermes[^\]]*\]/.test(line)) {
      const inner = line.match(/\[([^\]]*)\]/)?.[1] || "";
      const values = inner.split(",").map((item) => item.trim()).filter((item) => item && item !== "lithermes");
      lines[i] = `  enabled: [${values.join(", ")}]`;
    }
    if (inEnabled && /^\s*-\s*lithermes\s*$/.test(line)) {
      lines.splice(i, 1);
      i -= 1;
      block.end -= 1;
    }
  }
  return `${lines.join(eol)}${trailingNewline ? eol : ""}`;
}

// A top-level `key:` opens a block even with a trailing comment or an empty
// flow map `{}`; openBlock() drops the `{}` only when a child is being added.
function findTopBlock(lines, key) {
  const re = new RegExp(`^${key}:(\\s*\\{\\s*\\})?(\\s+#.*)?\\s*$`);
  const start = lines.findIndex((line) => re.test(line));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i]) && !/^---\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

const eolOf = (text) => (String(text || "").includes("\r\n") ? "\r\n" : "\n");

// Rejoin in the file's own line ending; trailing blank lines collapse to one ending.
function joinLines(lines, eol, extra = []) {
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return [...lines, ...extra, ""].join(eol);
}

function openBlock(lines, block) {
  lines[block.start] = lines[block.start].replace(/\s*\{\s*\}/, "");
}

function readDisplaySkinConfig(text) {
  const lines = String(text || "").split(/\r?\n/);
  const block = findTopBlock(lines, "display");
  if (!block) return null;
  for (let i = block.start + 1; i < block.end; i += 1) {
    const m = /^\s{2}skin:\s*(\S.*?)\s*$/.exec(lines[i]);
    if (m) return m[1];
  }
  return null;
}

function setDisplaySkinConfig(text, skinName) {
  const value = String(skinName || "").trim();
  if (!value) return text;
  const eol = eolOf(text);
  const lines = String(text || "").split(/\r?\n/);
  const block = findTopBlock(lines, "display");
  if (block) {
    for (let i = block.start + 1; i < block.end; i += 1) {
      if (/^\s{2}skin:\s*/.test(lines[i])) {
        lines[i] = `  skin: ${value}`;
        return joinLines(lines, eol);
      }
    }
    openBlock(lines, block);
    lines.splice(block.start + 1, 0, `  skin: ${value}`);
    return joinLines(lines, eol);
  }
  return joinLines(lines, eol, ["display:", `  skin: ${value}`]);
}

function readTuiAgentsNudgeConfig(text) {
  const lines = String(text || "").split(/\r?\n/);
  const block = findTopBlock(lines, "display");
  if (!block) return null;
  for (let i = block.start + 1; i < block.end; i += 1) {
    const m = /^\s{2}tui_agents_nudge:\s*(\S.*?)\s*$/.exec(lines[i]);
    if (m) return m[1];
  }
  return null;
}

// Managed key for helper-agent visibility (Hermes display.tui_agents_nudge).
// Set only when absent: an explicit user value, true or false, is preserved.
function setTuiAgentsNudgeConfig(text) {
  if (readTuiAgentsNudgeConfig(text) !== null) return text;
  const eol = eolOf(text);
  const lines = String(text || "").split(/\r?\n/);
  const block = findTopBlock(lines, "display");
  if (block) {
    openBlock(lines, block);
    lines.splice(block.start + 1, 0, "  tui_agents_nudge: true");
    return joinLines(lines, eol);
  }
  return joinLines(lines, eol, ["display:", "  tui_agents_nudge: true"]);
}

function clearDisplaySkinConfig(text) {
  const lines = String(text || "").split(/\r?\n/);
  const block = findTopBlock(lines, "display");
  if (!block) return text;
  for (let i = block.start + 1; i < block.end; i += 1) {
    if (/^\s{2}skin:\s*/.test(lines[i])) {
      lines.splice(i, 1);
      break;
    }
  }
  return joinLines(lines, eolOf(text));
}

function readOutputStyleConfig(text) {
  const m = /^outputStyle:\s*(\S.*?)\s*$/m.exec(String(text || ""));
  return m ? m[1] : null;
}

function setOutputStyleConfig(text, styleId) {
  const value = String(styleId || "").trim();
  if (!value) return text;
  const str = String(text || "");
  if (/^outputStyle:\s*\S/m.test(str)) {
    const updated = str.replace(/^outputStyle:\s*(\S.*?)$/m, `outputStyle: ${value}`);
    return `${updated.replace(/\n*$/, "")}\n`;
  }
  const body = str.replace(/\n*$/, "");
  const prefix = body ? `${body}\n` : "";
  return `${prefix}outputStyle: ${value}\n`;
}

function clearOutputStyleConfig(text) {
  const str = String(text || "");
  const updated = str.split(/\r?\n/).filter((line) => !/^outputStyle:\s*/.test(line)).join("\n");
  return `${updated.replace(/\n*$/, "")}\n`;
}

// Hermes `skills.external_dirs` (config.yaml key, default []): bare-name skill
// resolution searches these directories, so a same-named directory there can shadow
// a LitHermes plugin skill (which is only reachable unambiguously as `lithermes:<name>`).
// Malformed YAML fails closed to an empty list rather than throwing during doctor.
function readExternalSkillDirsConfig(text) {
  const str = String(text || "");
  if (!str.trim()) return [];
  try {
    const document = parseDocument(str, { strict: true, uniqueKeys: true });
    if (document.errors.length) return [];
    const node = document.getIn(["skills", "external_dirs"], true);
    const value = node && typeof node.toJS === "function" ? node.toJS(document) : node;
    if (!Array.isArray(value)) return [];
    return value
      .filter((entry) => typeof entry === "string" && entry.trim())
      .map((entry) => entry.trim());
  } catch {
    return [];
  }
}

// Hermes `display.status_bar.fields` only chooses which built-in segments show
// (the order is fixed). Empty means the host default, which leaves out the
// opt-in git branch. Doctor suggests this set and never writes it.
const RECOMMENDED_STATUS_BAR_FIELDS = Object.freeze([
  "model", "context_pct", "goal", "bg_subagents", "git_branch", "prompt_elapsed", "yolo",
]);

// The configured field list ([] when unset); null when config.yaml does not parse.
function readStatusBarFields(text) {
  const str = String(text || "");
  if (!str.trim()) return [];
  try {
    const document = parseDocument(str, { strict: true, uniqueKeys: true });
    if (document.errors.length) return null;
    const fields = document.toJS()?.display?.status_bar?.fields;
    return Array.isArray(fields) ? fields : [];
  } catch {
    return null;
  }
}

// null = the user already chose fields, or the YAML is malformed (no guessing).
function suggestStatusBarFields(text) {
  const fields = readStatusBarFields(text);
  return fields && fields.length === 0 ? RECOMMENDED_STATUS_BAR_FIELDS : null;
}

function yamlError(text) {
  if (!String(text || "").trim()) return null;
  const document = parseDocument(text, { strict: true, uniqueKeys: true });
  return document.errors.length ? document.errors[0].message.split("\n")[0].replace(/:$/, "") : null;
}

// Fail closed when an edit would break a config that parses under the installer's
// strict check; an already-malformed file keeps the append-only fallback.
function assertConfigEdit(hermesHome, before, after, hint = "Edit config.yaml by hand.") {
  const error = yamlError(after);
  if (!error || yamlError(before)) return;
  throw new Error(`${configPath(hermesHome)} left unchanged: the LitHermes edit would not parse as YAML (${error}). ${hint}`);
}

function writeConfig(hermesHome, text) {
  assertConfigEdit(hermesHome, readConfig(hermesHome), text);
  fs.mkdirSync(hermesHome, { recursive: true });
  writeFileAtomic(configPath(hermesHome), text, "utf8");
}

module.exports = {
  ...modelConfig,
  assertConfigEdit,
  clearDisplaySkinConfig,
  clearOutputStyleConfig,
  configHasLitHermes,
  configPath,
  disableLitHermesConfig,
  enableLitHermesConfig,
  readConfig,
  readDisplaySkinConfig,
  readExternalSkillDirsConfig,
  readStatusBarFields,
  RECOMMENDED_STATUS_BAR_FIELDS,
  suggestStatusBarFields,
  readOutputStyleConfig,
  readTuiAgentsNudgeConfig,
  setDisplaySkinConfig,
  setOutputStyleConfig,
  setTuiAgentsNudgeConfig,
  writeConfig,
};
