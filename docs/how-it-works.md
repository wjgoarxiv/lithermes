# How it works, step by step

[← Back to the README](../README.md#how-it-works) · [한국어](./how-it-works.ko.md)

The README shows the route as two pictures, a box diagram and a process plant. This page walks through both, box by box and stream by stream.

## The route

LitHermes is a Python plugin. When Hermes loads it, `register(ctx)` adds hooks, commands, skills and work tools; the hooks step in just before and after each model or tool call. The box diagram follows one request from the moment you type it:

1. A prompt that starts with `lit` and a slash command such as `/lit-plan` both arrive at the same place, where the `pre_llm_call` hook or the registered command picks a discipline: `litwork` for a plain `lit`, `lit-plan` for a plan, and so on.
2. The skill works the goal through the `goal_*` tools, and every terminal command it runs is noted and signed by the `post_tool_call` hook. A work review sends five `delegate_task` reviewers that read the change on their own.
3. Before the reply goes out, `pre_verify` and `transform_llm_output` check the gate. With the gate open, "done" stands; with the gate closed, the reply ends with `⛔ LIT: not done` and the reason.
4. Everything on the right side of the picture is a file in your project. The dashed line is why a fresh turn knows where the work stands: the goal record is read back before every model call.

## The plant

The same route works as a small process plant, and the plant shows something the boxes hide: work goes round. The stream table in the drawing says what each numbered line carries and which hook or tool carries it.

- **In.** The request comes in on the left. A plain `lit` runs straight into the work unit, while `lit plan` stops at the plan unit first.
- **Review and gate.** Finished work passes the review column, whose five trays are the five reviewers, and then the gate, which acts as an analyser on a three-way valve.
- **Round again.** A passing reply leaves as done. A failing one goes back to the work unit as `LIT: not done`, and it keeps going round until the gate opens.
- **Records.** Run notes and review receipts drain into the records tank, `.hermes/lithermes/` in your project. The tank sends the goal snapshot back to the router on every turn and the handoff card on to the next session.

## What the model sees

Before the next model call, the context hook reads those records and hands the model the current goal and how far it has got. A plain prompt that starts with `lit` is routed by the plugin, a slash command goes straight to its skill, and text you paste in, from code to copied commands, is read as data and never followed as an instruction. The plugin decides where a request goes while Hermes Agent still runs the model; permissions, sign-in, model access and anything that needs a real screen stay with Hermes.
