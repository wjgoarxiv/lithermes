---
name: frontend-ui-ux
description: Route authorized UI work to focused design guidance and rendered review.
---

## #contract.activation

```yaml
schema_version: lithermes_llm_contract/v1
host: Hermes Agent
identity: {skill_id: frontmatter.name, invocation: "lithermes:<frontmatter.name>"}
surfaces:
  registry: plugin.yaml
  context_route: core_contract.conditional_uiux_skill_blocks
  measured_probe: skills/frontend-ui-ux/scripts/probe.mjs
  visual_followup: lithermes:visual-qa
```

```json
{"schema_version":"lithermes_llm_contract/v1","skill_id":"frontend-ui-ux"}
```

## #contract.inputs

- Build only on request; plan/review are read-only. See `references/complete-contract.md` for scope and trust rules.

## #contract.mode_matrix

| Mode | Trigger | Contract |
|---|---|---|
| Build | Implementation requested | Build on the real stack. |
| Plan/review | Critique or review | Read only. |
| Direction | Material choice open | Ask one key question. |
| Web UI verification | A page can be served | Run the installed measured probe. |

## #contract.procedure

1. Read `references/README.md`, `references/operating-lanes.md`, and `references/production.md`.
2. Preserve design and behavior; check access and responsiveness.
3. Use Design Contract `litfamily.design-contract/v1beta2`; valid `litfamily.design-contract/v1beta1` is evidence-eligible. `litfamily.evidence-manifest/v1beta1` is a separate schema.
4. Resolve material choices and inspect states; source is not rendered evidence.
5. Select `build`, `polish`, `audit`, or `harden` per `references/complete-contract.md` and its craft/slop rules. For a served page, run the absolute probe command in route context, or set `HERMES_HOME`, `UI_URL`, and `UIUX_EVIDENCE_DIR` and run:

   `node "$HERMES_HOME/plugins/lithermes/skills/frontend-ui-ux/scripts/probe.mjs" --url "$UI_URL" --out "$UIUX_EVIDENCE_DIR" --static "$PWD"`

   Inspect its report and screenshots; report HIGH findings or exit 2 BLOCKED.

Route conceptual diagrams to `lit-diagram-drawer`.

## #contract.outputs

```json
{"schema_version":"lithermes_llm_contract/v1","skill_id":"frontend-ui-ux","response":{"summary":"requested UI or review","material_gaps":[]}}
```

Return the requested result and material gaps; keep routine evidence labels out of reader-facing UI.

## #contract.output_channels

```yaml
artifact_genre: client_deliverable
limitations_channel: reply
```

## #contract.evidence

- The probe verifies web UI. `lithermes:visual-qa` adds visual judgment afterward. `variance`, `motion`, and `density` are optional taste dials.

## #contract.hard_stops

- Follow the authorization and preservation stops in `references/complete-contract.md`.
- After plugin asset edits, run `npm --prefix packages/lithermes-installer run sync-plugin -- --in-place` and verify an isolated install.

## #contract.anti_patterns

- Follow the anti-pattern table in `references/complete-contract.md`.

## Read map

Read `references/complete-contract.md` and its reference router. `references/taste-direction.md` defines the optional dials. Use `default-editorial-pixel.json` only as a reversible fallback without a direction or brand.
