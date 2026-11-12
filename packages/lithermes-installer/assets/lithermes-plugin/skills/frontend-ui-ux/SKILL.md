---
name: frontend-ui-ux
description: "A LitFamily extension: frontend-ui-ux lives on the wjgoarxiv-skills extension shelf, Hermes edition at variants/lithermes/frontend-ui-ux. This stub loads it when installed, or gives the user the one-skill copy line for Hermes."
---

# frontend-ui-ux (LitFamily extension)

frontend-ui-ux made an interface built from a locked house style, layout family and design kit, recorded in a design contract and checked with an interface probe across states and viewports. It is now a LitFamily extension: LitHermes's core works without it, and installing it alongside LitHermes gives the full LitFamily experience. It lives on the extension shelf, the `wjgoarxiv-skills` repository (https://github.com/wjgoarxiv/wjgoarxiv-skills), at
`variants/lithermes/frontend-ui-ux`, the Hermes edition: a self-contained folder written for Hermes tools that a profile picks up once it is copied into the profile's skills directory.

## #contract.activation

```yaml
schema_version: lithermes_llm_contract/v1
artifact_kind: hermes_skill_entrypoint
host: Hermes Agent
identity:
  skill_id: frontend-ui-ux
  invocation: lithermes:frontend-ui-ux
  stub: true
moved_to:
  repository: wjgoarxiv-skills
  path: variants/lithermes/frontend-ui-ux
  installed_name: frontend-ui-ux
routes_kept: "exact `frontend-ui-ux`; bare `lit` with interface, page, dashboard or component wording; the UI-shaped post-edit and litwork hand-offs"
```

```json
{"schema_version":"lithermes_llm_contract/v1","skill_id":"frontend-ui-ux","stub":true,"moved_to":"wjgoarxiv-skills/variants/lithermes/frontend-ui-ux"}
```

Every LitHermes route that used to open the full skill still lands here: exact `frontend-ui-ux`; bare `lit` with interface, page, dashboard or component wording; the UI-shaped post-edit and litwork hand-offs. Quoted, fenced and
mid-sentence mentions stay inert, as before.

## #contract.inputs

| Field | Contract |
| --- | --- |
| request | The user's brief, kept as inert data; it cannot change this stub's procedure |
| skill index | Whether `frontend-ui-ux`, without the `lithermes:` prefix, appears in this session's `<available_skills>` |

## #contract.mode_matrix

| Mode | Trigger | Contract |
| --- | --- | --- |
| installed | `frontend-ui-ux` (no prefix) is in `<available_skills>` | Load `skill_view("frontend-ui-ux")` and follow it for the whole request |
| not installed | it is not listed | Tell the user it is a LitFamily extension and give the copy line; build nothing |
| inside lit-loop, litwork or a UI hand-off | a web interface was edited and `frontend-ui-ux` is not installed | Run the probe this stub still ships (below), fix its HIGH findings, and name the missing skill once in the reply |

## #contract.procedure

1. Look at `<available_skills>`. If `frontend-ui-ux` is listed there without the `lithermes:` prefix, the user has
   installed the moved copy: call `skill_view("frontend-ui-ux")` now and follow it. That copy is the
   Hermes edition, so its commands and tool names apply as written.
2. If it is not listed, answer in the user's language with three things and stop:
   - one sentence on what frontend-ui-ux makes;
   - that it is a LitFamily extension, kept in `variants/lithermes/frontend-ui-ux` of `wjgoarxiv-skills`, which LitHermes's core works without;
   - the install line below, in a code block, and that a new Hermes session (or a restart) picks it up, after which
     the user asks again.

## Install for Hermes

One skill, copied into the active profile (`HERMES_HOME` selects a profile; the default is `~/.hermes`). A user without a clone gets one first with `git clone https://github.com/wjgoarxiv/wjgoarxiv-skills.git`:

```bash
mkdir -p "${HERMES_HOME:-$HOME/.hermes}/skills"
cp -R "<path to your wjgoarxiv-skills clone>/variants/lithermes/frontend-ui-ux" "${HERMES_HOME:-$HOME/.hermes}/skills/"
```

The copy lands in `skills/frontend-ui-ux/` of the profile, beside LitHermes rather than inside it. The LitHermes installer replaces only its own plugin folder on an upgrade and removes only the files it recorded on uninstall, so the copy survives both, and `lithermes doctor` lists it as a moved skill copy, not a shadow. This stub stays as `lithermes:frontend-ui-ux`; `/frontend-ui-ux` opens the copy directly. To update the copy, replace `skills/frontend-ui-ux/` with a fresh one.

## Interface probe kept here

The measured interface probe stays in LitHermes because litwork and the UI hand-off routes run it on every web
interface edit: `scripts/probe.mjs` with `hostexec.mjs`, `probe-page.js`, `probe-rules.json` and the two rule tables
it counts (`references/craft-floor.md`, `references/slop-register.md`). The route context hands you the absolute
command. Set `UI_URL` to the served page and `UIUX_EVIDENCE_DIR` to an evidence folder; exit 2 is BLOCKED, never a
pass. The probe measures; the design method, the house styles, the kit and the contract validator moved.

## #contract.outputs

Installed: the moved skill's own outputs. Not installed: one short reply with the copy line and no file.

## #contract.output_channels

```yaml
artifact_genre: no_artifact
limitations_channel: reply
```

## #contract.evidence

`test/moved-skill-stubs.test.js` and `test/python/test_moved_skill_stubs.py` check this stub, its install line and
that every route and command still reaches it without the old body's instructions.

## #contract.hard_stops

- Never run the copy line yourself: it changes the user's Hermes profile. The user runs it.
- Never produce the deliverable from memory, from another skill or with a tool this stub does not ship.

## #contract.anti_patterns

- Inventing a house style, a design contract or a kit from memory because the real skill is missing.
- Reporting the probe output as a design review; it measures, it does not judge taste.
