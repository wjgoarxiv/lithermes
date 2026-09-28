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
  const start = lines.findIndex((line) => /^plugins:\s*$/.test(line));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i]) && !/^---\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end, lines: lines.slice(start, end) };
}

function configHasLitHermes(text) {
  const block = findPluginsBlock(text.split(/\r?\n/));
  if (!block) return false;
  return block.lines.some((line, index) => {
    if (/^\s*enabled:\s*\[[^\]]*lithermes[^\]]*\]/.test(line)) return true;
    if (!/^\s*enabled:\s*$/.test(line)) return false;
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
  const trailingNewline = text.endsWith("\n");
  const lines = text.split(/\r?\n/);
  if (!trailingNewline && lines[lines.length - 1] === "") lines.pop();
  const block = findPluginsBlock(lines);
  if (block) {
    for (let i = block.start + 1; i < block.end; i += 1) {
      const line = lines[i];
      if (/^\s{2}enabled:\s*\[[^\]]*\]/.test(line)) {
        lines[i] = line.replace(/\[([^\]]*)\]/, (_match, inner) => {
          const values = inner.split(",").map((item) => item.trim()).filter(Boolean);
          values.push("lithermes");
          return `[${values.join(", ")}]`;
        });
        return `${lines.join("\n")}${trailingNewline ? "\n" : ""}`;
      }
      if (/^\s{2}enabled:\s*$/.test(line)) {
        lines.splice(i + 1, 0, "    - lithermes");
        return `${lines.join("\n")}${trailingNewline ? "\n" : ""}`;
      }
    }
    lines.splice(block.start + 1, 0, "  enabled:", "    - lithermes");
    return `${lines.join("\n")}${trailingNewline ? "\n" : ""}`;
  }
  const suffix = text.endsWith("\n") ? "" : "\n";
  return `${text}${suffix}plugins:\n  enabled:\n    - lithermes\n`;
}

function disableLitHermesConfig(text) {
  const trailingNewline = text.endsWith("\n");
  const lines = text.split(/\r?\n/);
  const block = findPluginsBlock(lines);
  if (!block) return text;
  for (let i = block.start + 1; i < block.end; i += 1) {
    const line = lines[i];
    if (/^\s{2}enabled:\s*\[[^\]]*lithermes[^\]]*\]/.test(line)) {
      const inner = line.match(/\[([^\]]*)\]/)?.[1] || "";
      const values = inner.split(",").map((item) => item.trim()).filter((item) => item && item !== "lithermes");
      lines[i] = `  enabled: [${values.join(", ")}]`;
    }
    if (/^\s*-\s*lithermes\s*$/.test(line)) {
      lines.splice(i, 1);
      i -= 1;
      block.end -= 1;
    }
  }
  return `${lines.join("\n")}${trailingNewline ? "\n" : ""}`;
}

function findTopBlock(lines, key) {
  const re = new RegExp(`^${key}:\\s*$`);
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
  const trailingNewline = !text || text.endsWith("\n");
  const lines = String(text || "").split(/\r?\n/);
  if (!trailingNewline && lines[lines.length - 1] === "") lines.pop();
  const block = findTopBlock(lines, "display");
  if (block) {
    for (let i = block.start + 1; i < block.end; i += 1) {
      if (/^\s{2}skin:\s*/.test(lines[i])) {
        lines[i] = `  skin: ${value}`;
        return `${lines.join("\n").replace(/\n*$/, "")}\n`;
      }
    }
    lines.splice(block.start + 1, 0, `  skin: ${value}`);
    return `${lines.join("\n").replace(/\n*$/, "")}\n`;
  }
  const body = lines.join("\n").replace(/\n*$/, "");
  const prefix = body ? `${body}\n` : "";
  return `${prefix}display:\n  skin: ${value}\n`;
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
  const trailingNewline = !text || text.endsWith("\n");
  const lines = String(text || "").split(/\r?\n/);
  if (!trailingNewline && lines[lines.length - 1] === "") lines.pop();
  const block = findTopBlock(lines, "display");
  if (block) {
    lines.splice(block.start + 1, 0, "  tui_agents_nudge: true");
    return `${lines.join("\n").replace(/\n*$/, "")}\n`;
  }
  const body = lines.join("\n").replace(/\n*$/, "");
  const prefix = body ? `${body}\n` : "";
  return `${prefix}display:\n  tui_agents_nudge: true\n`;
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
  return `${lines.join("\n").replace(/\n*$/, "")}\n`;
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

function writeConfig(hermesHome, text) {
  fs.mkdirSync(hermesHome, { recursive: true });
  writeFileAtomic(configPath(hermesHome), text, "utf8");
}

module.exports = {
  ...modelConfig,
  clearDisplaySkinConfig,
  clearOutputStyleConfig,
  configHasLitHermes,
  configPath,
  disableLitHermesConfig,
  enableLitHermesConfig,
  readConfig,
  readDisplaySkinConfig,
  readExternalSkillDirsConfig,
  readOutputStyleConfig,
  readTuiAgentsNudgeConfig,
  setDisplaySkinConfig,
  setOutputStyleConfig,
  setTuiAgentsNudgeConfig,
  writeConfig,
};
