# Automatic handoff

[← Back to the README](../README.md) · [한국어](./automatic-handoff.ko.md)

A long session fills the model's context window, and when it is full Hermes compacts the conversation and older detail is lost. Automatic handoff has the model write a handoff before that happens, and brings it back afterwards. It is off by default, and the percent is yours to choose: LitHermes has no built-in value.

Turn it on inside a session with a percent of your own:

```
/lit-handoff auto on 60
```

From then on, once a model call uses more than 60% of the context window, your next message carries a short request to write a handoff with the lit-handoff procedure. The model saves the file and tells you one line: `Handoff saved. Run /compact now.` (On Hermes 0.17 the command is `/compress`.) After you compact, the next message carries a short digest of that handoff, so the work picks up where it stopped.

Hermes lets a plugin watch and ask, and only you or Hermes can compact. These are the four steps and who does each one here:

| Step | Who does it on Hermes |
|---|---|
| Measure how full the context is | Automatic. LitHermes reads the token count of every model call. |
| Ask the model for the handoff | Automatic request, on the first message after the percent is passed. The model still has to follow it. |
| Compact the conversation | You, with `/compact`, or Hermes on its own threshold. A plugin cannot start compaction on Hermes. |
| Load the handoff again | Automatic, on the first message after compaction. It loads only a file that carries this session's id and was written after the request; otherwise LitHermes says it found nothing to load. |

These switches set it up:

- `/lit-handoff auto on <percent>` turns it on at a whole number from 1 to 99. Without a number it reuses the last one you chose, and asks for one if you never chose.
- `/lit-handoff auto off` turns it off and remembers the percent for next time.
- `/lit-handoff auto status` shows whether it is on, the latest reading of this session and how it compares with Hermes' own compaction point.
- `LITHERMES_AUTO_HANDOFF=1` together with `LITHERMES_AUTO_HANDOFF_PERCENT=60` sets the same thing from the environment Hermes runs in, which suits a shell profile. The environment wins over the command. Any other value of the first variable keeps the feature off, and a percent that is not a whole number from 1 to 99 also keeps it off and shows up as a warning in `hermes lithermes doctor`.

Choose a percent below the point where Hermes compacts on its own. On current Hermes that is about half of the window by default, raised to 75% for windows under 512K tokens, and lowered to a fixed token count when your Hermes config sets a cap. If your percent is at or above that point, Hermes compacts first and no handoff is written. `hermes lithermes doctor` and `/lit-handoff auto status` compare the two and warn you.

The request goes out once each time usage crosses your percent, never inside a tool call and never to helper agents. LitHermes saves only your switch and last percent, in the `lithermes` folder of your Hermes home. The handoff itself is the usual `HANDOFF.md` (or `.handoff/HANDOFF.md`) in your project.

## The quiet save before compaction

Separately from the request above, LitHermes keeps a small save of its own, and this one is on unless you turn it off. A plugin cannot act inside Hermes' compaction, so it saves a little earlier: when a turn ends with the context at 40% of the window or more, LitHermes writes `.hermes/lithermes/handoff/auto-<session>.md` in your project from what it already holds (the open start-work plan with its current row, the litgoal card, and your last request and the last reply). No model call is involved, and the file is redacted and bounded. After Hermes compacts, the first message carries a short digest of that file once, so the model knows where the work stood.

- `/lit-handoff auto save off` turns it off, and `/lit-handoff auto save on` turns it back on. `/lit-handoff auto status` shows which.
- `LITHERMES_HANDOFF_SAVE=0` (or `1`) sets the same from the environment and wins over the command.
- Helper agents and cron runs never save. A compaction before any turn reached 40% has nothing to load.
