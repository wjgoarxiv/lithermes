function findDirectNpmPublishCommands(text) {
  const commands = [];
  for (const line of text.split(/\r?\n/)) {
    const original = line.trim();
    let command = original;
    if (command.startsWith("$ ")) command = command.slice(2).trimStart();
    if (!command.startsWith("npm ")) continue;

    const tokens = command.split(/\s+/);
    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === "publish") {
        commands.push(original);
        break;
      }
      if (["run", "run-script", "exec", "x"].includes(token)) break;
      if (token === "--prefix") {
        index += 1;
        continue;
      }
      if (token.startsWith("--prefix=") || token.startsWith("-")) continue;
      break;
    }
  }
  return commands;
}

module.exports = { findDirectNpmPublishCommands };
