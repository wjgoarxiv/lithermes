const { PINS } = require("./iconFont");
const { PROVIDER_IDS, managedRequest } = require("./modelRoutePolicy");

// The text of `install --agent`. The install prompts in docs/install.md and docs/install.ko.md carry the
// same commands, flags and files; test/agent-guide.test.js holds the three and the parser together.
const RUN = "npx --yes --package @litfamily/lithermes@latest -- lithermes";
const COMMANDS = Object.freeze({
  preview: `${RUN} install --dry-run --round`,
  install: `${RUN} install --yes --round`,
  doctor: `${RUN} doctor --offline`,
});
const POINTER = "Agent? See npx --yes @litfamily/lithermes@latest install --agent.";
const HELP_LINE = `Are you an agent? Run \`${RUN} install --agent\` and follow what it prints.`;

const route = managedRequest();
// What a person is asked at a terminal, in order. `later` is for a question without a flag.
const QUESTIONS = Object.freeze([
  { title: "Agent provider", flags: ["provider"], text: `the provider Hermes has now, else ${route.provider}; another: --provider ID (${PROVIDER_IDS.join(", ")})` },
  { title: "Lead model", flags: ["model", "effort"], text: `the model Hermes has now, else ${route.model} at ${route.effort}; another: --model ID --effort LEVEL` },
  { title: "Helper provider", flags: ["child-provider"], text: "the lead's provider; another: --child-provider ID" },
  { title: "Helper model", flags: ["child-model", "child-effort"], text: `the model Hermes has now, else ${route.childModel} at ${route.childEffort}; another: --child-model ID --child-effort LEVEL` },
  { title: "Model route", flags: [], later: "hermes model", text: "go on with the route above; your user can choose it later with `hermes model`" },
  { title: "HUD accent", flags: ["hud"], text: "the skin stays as it is; another: --hud <accent> (cyan, rose, ignition and more; `lithermes hud` lists them)" },
  { title: "Output style", flags: ["style"], text: "the reply style stays as it is; another: --style ID (asd-ste100, asd-ste100-ko, eli5, eli5-ko)" },
  { title: "Finish bell", flags: ["bell"], text: "no bell when a turn finishes; on: --bell" },
]);

function agentGuide() {
  return `LitHermes install guide for coding agents

If you are a coding agent and your user asked you to install LitHermes, follow these steps. They are written for your user to read too.

1. Preview. This changes nothing:
   ${COMMANDS.preview}
   Show your user what it would change.

2. Ask your user. The first answer to offer is: keep every default. Each line is a question, its default and the flag for another answer.
${QUESTIONS.map(({ title, text }) => `   - ${title}: ${text}.`).join("\n")}
   When Hermes already has a model route, another route also needs --reconfigure-model.
   Icon font: --round adds ${PINS.files[0].name} and its licence to ~/Library/Fonts on macOS or \${XDG_DATA_HOME:-~/.local/share}/fonts on Linux, only when no icon font is here. Windows gets no font.
   Visible surface: the goal card in \`hermes --tui\` and the HUD card of the classic CLI. Both are on by default; your user can put the goal card away with \`lithermes hud card off\`.

3. Wait for your user's yes. Use only this package; add no other source, and do not approve hooks, trust or sign-in for your user.

4. Install. Put the flags for your user's other answers at the end:
   ${COMMANDS.install}

5. Update later with the same line. It keeps the saved choices.

6. Check:
   ${COMMANDS.doctor}
   It passes with "plugin discovery: PASS", "installed payload: PASS" and "enabled config: PASS". Offline, "loaded plugin: PARTIAL" is expected, and model routes may show as unavailable.
   The install must print a line that starts with ROUND_ENDS:. If a step fails, show your user the lines and stop.

7. Rounded ends. Show your user this and ask if both ends are round:  LIT 
   Both ends are round: rerun the install line with --glyphs round.
   Boxes: rerun it with --glyphs square. To get round ends later, your user sets the terminal's own font to a full Nerd Font, or adds ${PINS.family} as its fallback font (iTerm2: Non-ASCII Font; VS Code: fontFamily; kitty: symbol_map). Terminal.app has no fallback setting, so it needs a full Nerd Font as its font.
   Over SSH or from a phone: leave it as it is.
   To undo a choice: rerun it with --glyphs auto.

8. Only your user can:
   - quit and start the Hermes CLI again, and restart any running Hermes gateway (\`hermes gateway restart\`), so that the plugin loads;
   - sign in to a model provider (\`hermes model\`) and approve anything Hermes asks for;
   - then start a task with lit in front.`;
}

module.exports = { COMMANDS, HELP_LINE, POINTER, QUESTIONS, agentGuide };
