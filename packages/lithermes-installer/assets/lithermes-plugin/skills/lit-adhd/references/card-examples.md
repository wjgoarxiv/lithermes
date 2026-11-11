# lit-adhd board and brief examples

## The KPI board (default)

Both boards below are real collector output from one temporary fixture repository: a fully
ticked plan, a plan with two of five rows ticked, a plan nobody touched for eleven days, a
HANDOFF.md with a `## Next` item, uncommitted files, and another Hermes session whose last
word asks the user a question. The reply shows `board.text` exactly like this; only the labels
change with `--lang`.

`node scripts/adhd.mjs --json --here --lang ko --session <id>` → `board.text`:

```text
REWIND <<
## 🎯 지금 할 일
**나를 기다리는 세션에 답하기** — "Choose the gateway port" 세션이 질문했어요
질문: "Should the gateway listen on 8080 or 8443?"
👉 입력: 그 세션 창에서 답하기. 아직 `go`는 치지 않기

## 📊 한눈에 보기
| ✅ 끝남 | 🔄 진행 중 | ⏳ 나를 기다림 | ⬜ 남음 |
|:--:|:--:|:--:|:--:|
| 5 | 1 | 1 | 2 |

전체 진행  ██████░░░░  5/9 (56%)

## 🏁 마일스톤
| 마일스톤 | 상태 | 진행 | 최근 |
|---|---|---|---|
| README refresh | 🔄 진행 중 | ████░░░░░░ 2/5 (40%) | 방금 |
| KPI board for lit-adhd | ✅ 끝남 | ██████████ 3/3 (100%) | 방금 |

## ✅ 최근 끝낸 일
- Rewrite the Korean section
- Rewrite the Where was I section
- Show the board as given in the skill
- Draw the board in the collector
- Write the RED board tests

## ⬜ 남은 일
1. Proofread both READMEs
2. Record a rendered sample
3. Ask for a release review

## 🔔 잊지 말 것
- ⏳ "Choose the gateway port" 세션이 답을 기다려요 → 그 세션 창에서 답하기
- 💾 커밋 안 된 변경 2개 (fixture-repo) → 확인하고 커밋하거나 되돌리기
- 🕰️ 11일째 멈춘 계획: Gateway notes → 이어 할지, 접을지 정하기
- 📌 HANDOFF 다음 할 일: Publish the release notes after review → 이어 할지 정하기
```

The same run with `--lang en`:

```text
REWIND <<
## 🎯 Do this now
**Answer the session that is waiting on you** — "Choose the gateway port" asked you a question
Question: "Should the gateway listen on 8080 or 8443?"
👉 Type: answer it in that session's chat; do not type `go` yet

## 📊 At a glance
| ✅ Done | 🔄 In progress | ⏳ Waiting on you | ⬜ Left |
|:--:|:--:|:--:|:--:|
| 5 | 1 | 1 | 2 |

Overall  ██████░░░░  5/9 (56%)

## 🏁 Milestones
| Milestone | Status | Progress | Last change |
|---|---|---|---|
| README refresh | 🔄 In progress | ████░░░░░░ 2/5 (40%) | just now |
| KPI board for lit-adhd | ✅ Done | ██████████ 3/3 (100%) | just now |

## ✅ Done lately
- Rewrite the Korean section
- Rewrite the Where was I section
- Show the board as given in the skill
- Draw the board in the collector
- Write the RED board tests

## ⬜ Still to do
1. Proofread both READMEs
2. Record a rendered sample
3. Ask for a release review

## 🔔 Don't forget
- ⏳ "Choose the gateway port" is waiting for your answer → answer in that session
- 💾 2 uncommitted changes (fixture-repo) → review, then commit or discard
- 🕰️ Plan untouched for 11 days: Gateway notes → decide whether to resume it or drop it
- 📌 HANDOFF next: Publish the release notes after review → decide whether to pick it up
```

What to notice:

- The waiting session outranks the open plan, exactly as `next` ranks it (`wait-lanes` with a
  session waiting), so Do this now says to answer it and not to type `go` yet.
- The four counts add up to the overall total (5 + 1 + 1 + 2 = 9). The current row of the
  half-ticked plan is the one item in progress; the waiting session is the one item waiting.
- The eleven-day-old plan is a 🕰️ reminder, not a milestone row, and never the next step.
- No session id, commit hash, raw status code or plan file name appears; the HANDOFF item and
  the worktree folder name are the only things quoted from disk.

When the other session is gone, the same repository's board opens with the plan instead. The
command is the one thing the user types, so its path is shown:

```text
REWIND <<
## 🎯 지금 할 일
**"README refresh" 계획 시작하기** — 여기서 열린 계획은 이것 하나예요. 3단계 남음
다음 단계: Proofread both READMEs
👉 입력: `/start-work plans/2026-11-09-readme-refresh.md`
```

With `--session` named and the step recorded for this session, the type line reads
`` 👉 입력: `go` (또는 `/start-work plans/<f>.md`) ``; a paused boundary reads
`👉 입력: 채팅으로 승인 또는 거절이라고 답하기` and never offers `go`.

## Detail view (`lit adhd 자세히`, `lit adhd detail`, `--detail`)

The per-session brief below is what `board.detailText` holds; it is shown under the board only
when the user asks for detail. Both examples render the same collector JSON. Gauges, ids, titles and names are copied from it
verbatim; only the connecting words change with the language. The JSON excerpt comes first.

```json
{
  "summary": { "sessions": 3, "waitingOnUser": 1, "active": 1 },
  "sessions": [
    { "id8": "655f39d3", "title": "ADHD lane", "asked": ["build the collector"], "done": { "tools": { "edit_file": 2 }, "commits": [{ "hash": "bdea372", "subject": "feat(adhd): collect cross-session records" }] }, "status": "waiting-on-user", "waitingReason": "asked the user", "progress": { "gauge": "[▉▉▉▉░░░░░░] 10/19", "remaining": ["11. Skill lit-adhd", "12. go continues"] } },
    { "id8": "f06fb727", "title": "pptx lane", "asked": ["fix the deck QA"], "done": { "tools": {}, "commits": [] }, "status": "active", "progress": { "gauge": "[…] running", "remaining": ["unknown"] } },
    { "id8": "2fad84a7", "title": "schematic lane", "asked": ["render the figure"], "done": { "tools": { "bash": 4 }, "commits": [] }, "status": "ended", "progress": { "gauge": "[▉▉▉] 3/3", "remaining": [] } }
  ],
  "roadmap": { "progress": { "gauge": "[▉▉▉▉░░░░░░] 10/20" }, "plans": [{ "plan": "plans/lit-adhd.md", "local": true, "current": "11. Skill lit-adhd", "progress": { "gauge": "[▉▉▉▉░░░░░░] 10/19" } }], "plansOmitted": 0 },
  "finished": { "runs": [], "plans": [] },
  "commits": [{ "hash": "bdea372", "at": "2026-10-25T09:12:00Z", "subject": "feat(adhd): collect cross-session records" }],
  "startWork": [{ "id8": "f06fb727", "workId": "work-abc", "status": "paused", "pendingBoundary": { "boundary": "b-1" } }],
  "next": { "kind": "approve-boundary", "target": { "workId": "work-abc" }, "say": null },
  "sources": { "herdr": "unknown" }
}
```

## English

> Done so far: feat(adhd): collect cross-session records
> Doing now: pptx lane
> Next: approve boundary: work-abc. Answer in chat.
>
> lit-adhd: 3 session(s) · 1 waiting on you · next: approve boundary
>
> == ● waiting on you · 655f39d3 · ADHD lane
> asked: build the collector
> [▉▉▉▉░░░░░░] 10/19 · left: 11. Skill lit-adhd, 12. go continues
> did: edit_file ×2 · bdea372 feat(adhd): collect cross-session records
> next: answer its question
>
> == ▶ active · f06fb727 · pptx lane
> asked: fix the deck QA
> […] running
> next: answer in chat to approve or deny the boundary
>
> -- ended · 1 --
> | id | where | goal | ago | done |
> |---|---|---|---|---|
> | 2fad84a7 | unknown | schematic lane | · | used bash ×4 |
>
> -- roadmap --
> ▶ plans/lit-adhd.md [▉▉▉▉░░░░░░] 10/19 now: 11. Skill lit-adhd
>   ○ later: 12. go continues
> ✓ bdea372 2026-10-25 feat(adhd): collect cross-session records
>
> -- next --
> > approve boundary: work-abc. Answer in chat.
>
> unknown: herdr

## 한국어

> 지금까지: feat(adhd): collect cross-session records
> 지금: pptx lane
> 다음: approve boundary: work-abc. 채팅으로 답하세요.
>
> lit-adhd: 세션 3개 · 나를 기다리는 것 1 · 다음: approve boundary
>
> == ● 나를 기다림 · 655f39d3 · ADHD lane
> 요청: build the collector
> [▉▉▉▉░░░░░░] 10/19 · 남은 것: 11. Skill lit-adhd, 12. go continues
> 한 일: edit_file ×2 · bdea372 feat(adhd): collect cross-session records
> 다음: 질문에 답하기
>
> == ▶ 진행 중 · f06fb727 · pptx lane
> 요청: fix the deck QA
> […] running
> 다음: 채팅으로 경계를 승인하거나 거부하기
>
> -- 끝남 · 1 --
> | id | where | goal | ago | done |
> |---|---|---|---|---|
> | 2fad84a7 | unknown | schematic lane | · | used bash ×4 |
>
> -- roadmap --
> ▶ plans/lit-adhd.md [▉▉▉▉░░░░░░] 10/19, 지금: 11. Skill lit-adhd
>   ○ 나중에: 12. go continues
> ✓ bdea372 2026-10-25 feat(adhd): collect cross-session records
>
> -- next --
> > approve boundary: work-abc. 채팅으로 답하세요.
>
> 모름: herdr

## What the examples do not do

- They do not estimate the pptx lane's progress: with no count it reads `[…] running`, copied as is.
- They do not describe work the records do not show: the pptx lane's "did" line names tools and commits only.
- They offer one next step only, and do not start it; the opener's `Next:` line and the box name the same step.
- Their `Done so far:` line holds only records: commits, finished start-work runs and fully ticked plans. With none, it reads "nothing finished in this window".
- They never show `?`, `?/?`, `[???]` or `k/?`: an unknown total is the pulse line, and the examples carry none of the four.
