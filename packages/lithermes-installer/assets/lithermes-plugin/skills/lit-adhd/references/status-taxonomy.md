# lit-adhd status taxonomy

The collector assigns every session exactly one status. The brief renders it in the user's language
with the words below and never invents a fifth.

| Status | Set when | English | 한국어 |
| --- | --- | --- | --- |
| `waiting-on-user` | The last record is the user asking something (a closing `?`, `확인해 주세요`, `할까요`…), or the session holds a paused bounded-work boundary | waiting on you | 나를 기다림 |
| `active` | A session write within the last 15 minutes and not waiting | active | 진행 중 |
| `ended` | Quiet for longer than 15 minutes | ended | 끝남 |
| `unknown` | The record held no timestamp | unknown | 모름 |

`waitingReason` says why a session waits: `asked the user` or `bounded-work boundary`. Name it in the card's status cell when present: `waiting on you (bounded-work boundary)` / `나를 기다림 (멈춘 bounded-work)`.

Order in the brief: waiting sessions first, then active, ended and unknown; newest first inside each group.

## Sources

Each entry of `sources` is `ok` or `unknown`. An `unknown` source is named once on the brief's last
line and never filled in from memory.

| Key | Source |
| --- | --- |
| `sessions` | Hermes `state.db` sessions |
| `plans` | `plans/*.md` checkbox rows |
| `litgoal` | `.hermes/lithermes/litgoal/*/goals.json` |
| `handoffs` | `HANDOFF*.md` and `.handoff/HANDOFF.md` headings |
| `git` | `git log --since` |
| `workflowStack` | `.hermes/lithermes/adhd/stack.json` |
| `startWork` | start-work runs and bounded-work states |
| `herdr` | `herdr agent list`, only with `HERDR_ENV=1` |

## Next-step kinds

| `next.kind` | Say | English | 한국어 |
| --- | --- | --- | --- |
| `approve-boundary` | answer in chat | bounded work waits on a boundary decision | bounded-work가 경계 결정을 기다림 |
| `continue-work` | continue in chat | keep running <plan> in chat | <plan> 계속 진행 |
| `start-plan` | run the command | start <plan> with `/start-work <plan>` | <plan>을 `/start-work <plan>`으로 시작 |
| `none` | — | no next step on record | 기록된 다음 단계 없음 |
