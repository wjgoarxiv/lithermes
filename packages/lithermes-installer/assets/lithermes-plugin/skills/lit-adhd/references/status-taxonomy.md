# lit-adhd status taxonomy

The collector assigns every session exactly one status. The brief renders it in the user's language
with the words below and never invents a fifth.

| Status | Set when | English | 한국어 |
| --- | --- | --- | --- |
| `waiting-on-user` | The last record is the user asking something (a closing `?`, `확인해 주세요`, `할까요`…), or the session holds a paused bounded-work run (only an older state can still say so: a run whose session ended has no owner) | waiting on you | 나를 기다림 |
| `active` | A session write within the last 15 minutes and not waiting | active | 진행 중 |
| `ended` | Quiet for longer than 15 minutes | ended | 끝남 |
| `unknown` | The record held no timestamp | unknown | 모름 |

`waitingReason` says why a session waits: `asked the user` or `bounded-work boundary`. Name it in the card's status cell when present: `waiting on you (bounded-work boundary)` / `나를 기다림 (멈춘 bounded-work)`.

Order in the brief: waiting sessions first, then active, ended and unknown; newest first inside each group.

## Board buckets

The KPI board never shows the codes above. It maps every record into one of four buckets and
shows only the bucket's icon and words:

| Record | Bucket | English | 한국어 |
| --- | --- | --- | --- |
| ticked plan row, passed criterion, plan with every row ticked | done | ✅ Done | ✅ 끝남 |
| current row of a plan with ticks or a running run, another `active` session, a herdr lane | in progress | 🔄 In progress | 🔄 진행 중 |
| another `waiting-on-user` session, current row of a `paused` run (its session ended) | waiting on you | ⏳ Waiting on you | ⏳ 나를 기다림 |
| every other open row or criterion | left | ⬜ Left | ⬜ 남음 |

`ended` and `unknown` sessions are not counted: they hold no open item. This session, the one
running the brief, is never counted as a lane.

## Start-work statuses

`startWork[].status` describes a run, not a session:

| Status | Set when |
| --- | --- |
| `active` | A start-work run whose plan still has an unticked row, or bounded work in progress |
| `paused` | Bounded work whose Hermes session ended; the user hands it on with `/lit-loop resume … --grant continue-session@<root>`. A call outside the grants never pauses a run: it is parked, the run stays `active`, and the collector reports `parked: N` beside it. A pause at any other boundary was written before parking and reads as `active` with that step parked |
| `done` | A start-work run whose plan has every row ticked |
| `completed` | Bounded work the owner completed |

A `done` or `completed` run inside the window is listed in `finished.runs` and named on the
opener's `Done so far:` line. A session itself never reads `done` on Hermes: a start-work run
record carries no session id, and completed bounded work clears its owner, so no record ties a
finished run to the session that ran it. Sessions keep the four statuses above.

## Sources

Each entry of `sources` is `ok` or `unknown`. An `unknown` source is named once on the brief's last
line and never filled in from memory.

| Key | Source |
| --- | --- |
| `sessions` | Hermes `state.db` sessions |
| `plans` | `plans/*.md` checkbox rows |
| `litgoal` | `.hermes/lithermes/litgoal/*/goals.json` |
| `handoffs` | `HANDOFF*.md` and `.handoff/HANDOFF.md` headings, plus the first `## Next` item of this worktree's own |
| `git` | `git log --since` |
| `workflowStack` | `.hermes/lithermes/adhd/stack.json` |
| `startWork` | start-work runs and bounded-work states |
| `herdr` | `herdr agent list`, only with `HERDR_ENV=1` |

## Next-step kinds

| `next.kind` | Say | English | 한국어 |
| --- | --- | --- | --- |
| `approve-boundary` | `/lit-loop resume … continue-session`, or `lit cancel` | bounded work stopped when its session ended | 세션이 끝나 멈춘 bounded-work |
| `continue-work` | continue in chat | keep running <plan> in chat | <plan> 계속 진행 |
| `start-plan` | run the command | start <plan> with `/start-work <plan>` | <plan>을 `/start-work <plan>`으로 시작 |
| `none` | — | no next step on record | 기록된 다음 단계 없음 |
