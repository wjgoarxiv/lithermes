# lit-team: worked briefs and calls

Exact shapes the lead uses. Replace the angle-bracket parts; keep the field order.

## One batch call

```json
{
  "tasks": [
    {
      "goal": "TASK: move the session store reads in src/store/** to the new async reader.",
      "context": "DELIVERABLE: every read in src/store/** goes through readAsync(); the sync reader is no longer imported there.\nSCOPE: own src/store/** only. Scratch: .hermes/lithermes/team/<slug>/store/. Do not touch src/api/**, docs/** or any lockfile.\nVERIFY: `npm test -- store` exits 0.\nRULES: no commit, push, stash, reset, rebase, tag, publish, install or config change; no rm -rf on a variable; do not print environment variables; when this brief is wrong, stop and say why.\nFACTS: readAsync(key) is exported from src/store/async.js and returns Promise<Record|null>; callers already run inside async functions; tests live in test/store/*.test.js.",
      "output_schema": {
        "type": "object",
        "properties": {
          "changed_files": {"type": "array", "items": {"type": "string"}},
          "check": {"type": "object", "properties": {"command": {"type": "string"}, "exit_code": {"type": "integer"}}},
          "risks": {"type": "array", "items": {"type": "string"}},
          "blocked": {"type": ["string", "null"]}
        },
        "required": ["changed_files", "check"]
      }
    }
  ]
}
```

Every task in the same call repeats its own `FACTS`; a child sees only its own context. Put no
`role` or `toolsets` field in a task.

## Watching and correcting

```json
{"action": "list"}
{"action": "steer", "subagent_id": "<id from the spawn response or list>", "message": "Stay inside src/store/**; revert the edit to src/api/client.js and describe the change it needs in risks."}
{"action": "stop", "subagent_id": "<id>"}
```

A stopped member still returns its partial result; record it as failed and re-brief once.

## Worktree slice

```bash
git worktree add .hermes/lithermes/team/<slug>/wt-<member> -b team/<slug>/<member>
# the member's SCOPE names that folder as its only working copy
git -C .hermes/lithermes/team/<slug>/wt-<member> diff --stat     # what it changed, read by the lead
git merge --no-ff team/<slug>/<member>                            # in the main working copy, by the lead
git worktree remove .hermes/lithermes/team/<slug>/wt-<member>
git branch -d team/<slug>/<member>
```

Skip this when the profile sets `delegation.worktree_isolation: true`; Hermes already gives each
child its own worktree off `HEAD`.

## herdr pane slice

Only when `HERDR_ENV=1` and `command -v herdr` succeeds. One pane per slice, the brief pasted as its
first prompt, the pane read back before the row is ticked. When the probe fails, herdr does not
exist for this run.

## Receipt

```markdown
# Receipt: <objective>
Rows: 1 [x] · 2 [x] · 3 [failed: check exit 1, taken back by the lead, fixed]
Merged-tree checks: `npm test -- store` 0 · `npm test -- form` 0 · `npm test` 0
Surface: `node bin/cli.js export --dry-run` printed the new header
Cleanup: wt-store removed, branch deleted; scratch folders kept under .hermes/lithermes/team/<slug>/
Finished: <time>
```
