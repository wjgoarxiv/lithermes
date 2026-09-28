# ADR 001: Use Hermes-native child-agent TUI visibility

- Status: Accepted for source-backed capability; live TUI unverified
- Date: 2026-08-25
- Scope: Hermes Agent TUI child-agent activity

## Context

LitHermes delegates work through the Hermes host. The G20 plan left child-agent
TUI visibility as an evidence-gated unknown. LitHermes must not invent a child
renderer or claim that a host surface exists without evidence.

The existing LitHermes model-routing statement says that Hermes has no TUI
route-visibility surface. That statement concerns model-route selection. It does
not answer whether the Hermes TUI can show child-agent activity.

## Decision

Use the Hermes TUI's native child-agent surfaces. Do not add a LitHermes child
renderer, event bridge, or combined-result API.

Users can inspect child-agent activity through `/agents`. Hermes also registers
`/tasks` as an alias for that dashboard. The TUI receives native
`subagent.*` gateway events and reconstructs nested work from `parent_id`.

LitHermes continues to own delegation receipts and durable workflow state. The
Hermes host owns the live child-agent view. LitHermes must describe the host
surface as child activity visibility, not model-route visibility.

## Evidence

The historical upstream source is pinned to commit
`2bd1977d8fad185c9b4be47884f7e87f1add0ce3`, which reports Hermes 0.17.0.
The installed Hermes runtime reports 0.19.0. The corresponding current release
source was also checked at commit
`3ef6bbd201263d354fd83ec55b3c306ded2eb72a`.

1. `ui-tui/README.md` documents `hermes --tui`, the gateway transport, and the
   TTY requirement. The TUI state, delegation, and replay behavior lives in the
   source files listed below.
2. `ui-tui/src/app/slash/commands/ops.ts` registers `/agents` and `/tasks`.
3. `ui-tui/src/gatewayTypes.ts` defines `subagent.spawn_requested`,
   `subagent.start`, `subagent.thinking`, `subagent.tool`,
   `subagent.progress`, and `subagent.complete` payloads.
4. `ui-tui/src/app/createGatewayEventHandler.ts` maps child events into TUI
   state. It also guides users to `/agents` when delegation starts. The source
   notes that `subagent.start` is the first reliable event on the CLI-to-gateway
   path because `subagent.spawn_requested` can be dropped there.
5. `ui-tui/src/lib/subagentTree.ts` nests children under their parent using
   normalized `parentId`. The wire payload field is `parent_id`.
6. `ui-tui/src/components/agentsOverlay.tsx` renders child status, progress,
   tool activity, summaries, timing, files, and output details.
7. `tools/delegate_tool.py` relays child identity, parent identity, depth, and
   child session identifiers to the host event stream.
8. `ui-tui/src/__tests__/subagentTree.test.ts` tests nested child trees.
9. `ui-tui/src/__tests__/createGatewayEventHandler.test.ts` tests child event
   handling, terminal states, `/agents` guidance, and repeated delegation.

Pinned source links:

- https://github.com/NousResearch/hermes-agent/blob/2bd1977d8fad185c9b4be47884f7e87f1add0ce3/ui-tui/README.md
- https://github.com/NousResearch/hermes-agent/blob/2bd1977d8fad185c9b4be47884f7e87f1add0ce3/ui-tui/src/app/slash/commands/ops.ts
- https://github.com/NousResearch/hermes-agent/blob/2bd1977d8fad185c9b4be47884f7e87f1add0ce3/ui-tui/src/gatewayTypes.ts
- https://github.com/NousResearch/hermes-agent/blob/2bd1977d8fad185c9b4be47884f7e87f1add0ce3/ui-tui/src/app/createGatewayEventHandler.ts
- https://github.com/NousResearch/hermes-agent/blob/2bd1977d8fad185c9b4be47884f7e87f1add0ce3/ui-tui/src/lib/subagentTree.ts
- https://github.com/NousResearch/hermes-agent/blob/2bd1977d8fad185c9b4be47884f7e87f1add0ce3/ui-tui/src/components/agentsOverlay.tsx
- https://github.com/NousResearch/hermes-agent/blob/2bd1977d8fad185c9b4be47884f7e87f1add0ce3/tools/delegate_tool.py
- https://github.com/NousResearch/hermes-agent/blob/2bd1977d8fad185c9b4be47884f7e87f1add0ce3/ui-tui/src/__tests__/subagentTree.test.ts
- https://github.com/NousResearch/hermes-agent/blob/2bd1977d8fad185c9b4be47884f7e87f1add0ce3/ui-tui/src/__tests__/createGatewayEventHandler.test.ts

Current-release source links:

- https://github.com/NousResearch/hermes-agent/blob/3ef6bbd201263d354fd83ec55b3c306ded2eb72a/ui-tui/src/app/slash/commands/ops.ts
- https://github.com/NousResearch/hermes-agent/blob/3ef6bbd201263d354fd83ec55b3c306ded2eb72a/ui-tui/src/gatewayTypes.ts
- https://github.com/NousResearch/hermes-agent/blob/3ef6bbd201263d354fd83ec55b3c306ded2eb72a/ui-tui/src/app/createGatewayEventHandler.ts
- https://github.com/NousResearch/hermes-agent/blob/3ef6bbd201263d354fd83ec55b3c306ded2eb72a/ui-tui/src/lib/subagentTree.ts
- https://github.com/NousResearch/hermes-agent/blob/3ef6bbd201263d354fd83ec55b3c306ded2eb72a/ui-tui/src/components/agentsOverlay.tsx

Local source inspection found the same child-agent surfaces in the current
Hermes checkout. The local executable reports Hermes Agent `v0.19.0 (2026.7.20)`.

## Capability verdict

| Capability | Verdict | Evidence |
|---|---|---|
| Native child-agent event stream | Available | `gatewayTypes.ts`, `delegate_tool.py` |
| Nested child dashboard | Available | `/agents`, `subagentTree.ts`, `agentsOverlay.tsx` |
| Child progress and completion details | Available | `createGatewayEventHandler.ts`, `agentsOverlay.tsx` |
| Live local TUI run in this checkout | Unverified | `ui-tui/dist/entry.js` exists, but the bundle lacks `dist/components/agentsOverlay.js` and `node_modules` contains only type packages |
| Model-route selection visibility | Unavailable in LitHermes | Existing LitHermes routing contract |

## Boundaries

- Do not claim that child text appears in the parent transcript. The native
  surface exposes child activity through its dashboard. Gateway watch handling
  can relay child text separately.
- Do not treat `subagent.spawn_requested` as a required live signal. Use
  `subagent.start` as the first reliable CLI-to-gateway lifecycle event.
- Do not confuse the wire field `parent_id` with the normalized TUI field
  `parentId`.
- The TUI may display an effective child model. That display does not prove
  that LitHermes configured the route or that the host applied it.
- Do not claim a live TUI pass from `hermes --tui --help`. That command proves
  the entry point only.
- The TUI exits when standard input is not a TTY. A non-interactive probe cannot
  prove the rendered dashboard.
- If the deployed Hermes version lacks the cited native events or dashboard,
  stop with `BLOCKED_HERMES_TUI_CHILD_VISIBILITY` and include the version and
  missing source or runtime evidence. Do not substitute a LitHermes renderer.

## Consequences

LitHermes maintainer documentation can point users to `/agents` and `/tasks`
for live child-agent visibility. This ADR is outside the npm package and does
not claim that packaged users discover these commands. Package documentation
changes belong to the later organic-enrollment slice. The package does not need
a new UI payload or a second event protocol. A future host upgrade must rerun
the source and real-TTY checks before changing this decision.

## Verification notes

- `hermes --version` reported `Hermes Agent v0.19.0 (2026.7.20)`.
- `hermes --tui --help` exposed the native `--tui` entry point.
- The checkout contains `ui-tui/dist/entry.js` and only `@types` and
  `undici-types` under `ui-tui/node_modules`.
- The checkout does not contain `ui-tui/dist/components/agentsOverlay.js`.
- No build, dependency install, TUI process, or host configuration write was
  performed during this research.
- The live dashboard remains unverified because the installed bundle and
  dependency set are incomplete for this child dashboard.
