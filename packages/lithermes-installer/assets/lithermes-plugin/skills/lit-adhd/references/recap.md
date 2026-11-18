# lit-adhd recap view

`lit adhd recap` (also `lit-adhd recap`, `/lit-adhd recap`) is the single-session view of
lit-adhd: what this conversation and its durable LitHermes records say was done, is in progress,
is blocked, and comes next. It used to be its own skill, lit-recap. The old words still work:
`lit recap`, `recap`, `litrecap`, `리캡` and `/lit-recap` open this same view, and the route then
asks for one line, said once: `lit-recap moved into lit-adhd: next time type \`lit adhd recap\`.`

The default `lit adhd` answer is the verdict card across sessions; this view is for "what happened
in this session". `lit adhd recap <session-id>` recaps another session: read it with the read-only
`session_search` tool first, and when it cannot be read, say so and recap nothing for it.

## Read-only contract

The recap view must not change state.

- Do not create run state.
- Do not bind or change the native Hermes `/goal`.
- Do not call mutating litgoal tools: `goal_set`, `goal_add_criterion`, `goal_evidence`,
  `goal_criterion_status`, `goal_steer`, `goal_checkpoint`, `goal_complete`.
- Do not edit files, write ledgers, dispatch `delegate_task` children or create artifacts.
- Read durable state only where it already exists.

## Where the facts come from

The route already rendered a digest of these records, escaped, above this text. Read whichever
exist and reconcile them with the current session:

- `.hermes/lithermes/litgoal/goals.json`, `ledger.jsonl`, `evidence/`
- `.hermes/lithermes/runs/<run-id>/state.json`, `ledger.jsonl`, `evidence/`

A durable record says what was true when it was written, not what is true now. When a ledger entry
and the current session or repository disagree, **the current session and repository take
precedence**: say so, mark the durable entry stale, and name the conflict instead of presenting the
old entry as current. The digest lists durable `pass` criteria under completed work already, so
staying silent about a conflict reads as confirming it.

No durable state at all: recap from the session alone and say the durable ledger was absent.
Never invent progress.

## Output

Korean by default; English for `--en`, `--english`, `english`, `영어` or an English request. Keep
technical tokens verbatim: paths, commands, package names, versions, commit hashes, tool names and
test references.

Full recap:

```markdown
# 작업 리캡 (lit adhd recap)
## ✅ 완료된 작업
## 🔄 진행 중
## ⛔ 블로커
## 📁 증거 경로
## ➡️ 다음 단계
```

Brief (`--brief` or `짧게`), at most five lines under:

```markdown
## ⚡ 요약
```

Every entry is factual and backed by a record or by this session. Mark an unknown or unverified
item as unverified instead of calling it done.
