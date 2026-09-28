---
description: Baseline LitHermes working discipline that applies to every repository.
alwaysApply: true
---

# Baseline discipline

- Restate the completion promise before changing files. Vague goals produce vague
  verdicts.
- Preserve unrelated worktree changes. Never revert, stash, or reformat work you
  did not author in this session.
- Never run destructive git commands (`reset --hard`, `clean -fd`, force-push) or
  stage, commit, tag, publish, or bump a version without an explicit request from
  the current user in this turn.
- Tests alone never prove done. Run the real surface once and capture the artifact
  path, then tear down every artifact the run spawned and record a cleanup receipt.
- A gate you did not run is not green. Paste the command and its actual output;
  never describe a red or unrun gate as passing.
- If an instruction and this rule conflict, the current user wins — but say which
  rule you are setting aside and why.
