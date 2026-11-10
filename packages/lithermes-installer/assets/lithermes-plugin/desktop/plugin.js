// LitHermes desktop half: a right-hand pane and a status-bar chip that show the
// workspace's newest litgoal, whether its quality gate is open, a six-stage
// timeline (plan, runs, review, gate, handoff, resume) and the signed runs that
// back each criterion as receipts.
//
// Plain ESM, loaded uncompiled by Hermes Desktop: no JSX, no build step. The only
// imports are the host SDK and React. The data comes from the plugin's own
// read-only route (GET /api/plugins/lithermes/goal), polled every five seconds for
// the workspace the app currently has open. Gate, runs and blockers are shown as
// the session reported them; the pane never verifies them.
//
// Motion lives in one injected stylesheet (keyframes only, theme variables only),
// removed again in ctx.onDispose so a reload or disable leaves nothing behind.
// Reduced motion turns every animation off. The pane raises no notification of its
// own: the plugin's post_message hook already sends one for each gate change, and a
// second one here would show as a second toast in Desktop.
import { host, useQuery, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const POLL_MS = 5000
const RING = 2 * Math.PI * 26

const colour = {
  strong: 'var(--ui-text-primary, var(--ui-text-secondary))',
  primary: 'var(--ui-text-secondary)',
  muted: 'var(--ui-text-tertiary)',
  faint: 'var(--ui-text-quaternary)',
  line: 'var(--ui-stroke-secondary)',
  accent: 'var(--ui-accent)',
  lit: 'var(--ui-orange, var(--ui-accent))',
  ok: 'var(--ui-green, var(--ui-accent))',
  warn: 'var(--ui-yellow, var(--ui-accent))',
  danger: 'var(--ui-red, var(--ui-accent))'
}

const CSS = `
.lithermes-pane { --lh-lit: ${colour.lit}; --lh-ok: ${colour.ok}; --lh-warn: ${colour.warn}; --lh-danger: ${colour.danger}; }
.lithermes-pane, .lithermes-chip { font-variant-numeric: tabular-nums; }
.lithermes-card { border: 1px solid var(--ui-stroke-secondary); border-radius: 10px; background: var(--ui-bg-card, transparent); }
.lithermes-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.lithermes-in { animation: lithermes-in 360ms cubic-bezier(.2,.8,.2,1) both; }
.lithermes-pulse { animation: lithermes-pulse 1.8s ease-in-out infinite; }
.lithermes-flip { animation: lithermes-flip 900ms cubic-bezier(.2,.8,.2,1) both; }
.lithermes-ring-arc { transition: stroke-dashoffset 700ms cubic-bezier(.2,.8,.2,1), stroke 400ms ease; }
.lithermes-sweep { animation: lithermes-sweep 3.6s ease-in-out infinite; }
.lithermes-glow { animation: lithermes-glow 2.4s ease-in-out infinite; }
.lithermes-grow { transform-origin: top; animation: lithermes-grow 520ms cubic-bezier(.2,.8,.2,1) both; }
@keyframes lithermes-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes lithermes-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 55%, transparent); }
  50% { box-shadow: 0 0 0 6px color-mix(in srgb, currentColor 0%, transparent); }
}
@keyframes lithermes-flip {
  0% { transform: scale(.86); filter: brightness(1.6); }
  45% { transform: scale(1.08); }
  100% { transform: scale(1); filter: none; }
}
@keyframes lithermes-sweep { 0%, 100% { opacity: .28; } 12% { opacity: 1; } 30% { opacity: .28; } }
@keyframes lithermes-glow {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ui-orange, var(--ui-accent)) 0%, transparent); }
  50% { box-shadow: 0 0 18px 0 color-mix(in srgb, var(--ui-orange, var(--ui-accent)) 28%, transparent); }
}
@keyframes lithermes-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@media (prefers-reduced-motion: reduce) {
  .lithermes-in, .lithermes-pulse, .lithermes-flip, .lithermes-sweep, .lithermes-glow, .lithermes-grow { animation: none; }
  .lithermes-ring-arc { transition: none; }
}
`

function injectStyle(ctx) {
  const style = document.createElement('style')
  style.textContent = CSS
  style.setAttribute('data-lithermes', 'pane')
  document.head.append(style)
  ctx.onDispose(() => style.remove())
}

// A stage's tone (set by the route) picks its colour; a stage without one falls back to its state.
function toneColour(tone) {
  return colour[tone] || null
}

function useGoal(ctx) {
  const cwd = useValue(host.state.cwd)

  return useQuery({
    queryKey: ['lithermes', 'goal', cwd],
    queryFn: () => ctx.rest('/goal?cwd=' + encodeURIComponent(cwd)),
    enabled: Boolean(cwd),
    refetchInterval: POLL_MS
  })
}

function text(content, style, key, className) {
  return jsx('div', { className, style: { color: colour.primary, ...style }, children: content }, key)
}

function span(content, style, key, className) {
  return jsx('span', { className, style, children: content }, key)
}

const STALE_REASON = /evidence (\S+) is stale/
const GUARD_REASON = /^unresolved review blocker/

function progress(data) {
  const criteria = Array.isArray(data.criteria) ? data.criteria : []

  return { passed: criteria.filter(c => c.status === 'pass').length, total: criteria.length }
}

function urgentReasons(gate) {
  return (gate.reasons || []).filter(reason => STALE_REASON.test(reason) || GUARD_REASON.test(reason))
}

function age(at) {
  const stamp = Date.parse(at || '')

  if (!Number.isFinite(stamp)) return ''
  const seconds = Math.max(0, Math.round((Date.now() - stamp) / 1000))

  if (seconds < 45) return 'just now'
  if (seconds < 3600) return Math.round(seconds / 60) + 'm ago'
  if (seconds < 86400) return Math.round(seconds / 3600) + 'h ago'

  return Math.round(seconds / 86400) + 'd ago'
}

function clock(at) {
  const stamp = new Date(at || '')

  if (Number.isNaN(stamp.getTime())) return ''

  return String(stamp.getHours()).padStart(2, '0') + ':' + String(stamp.getMinutes()).padStart(2, '0')
}

function ring(passed, total, open) {
  const share = total ? passed / total : 0
  const tone = open ? colour.ok : passed === total && total ? colour.warn : colour.lit

  return jsxs('div', {
    style: { position: 'relative', width: '64px', height: '64px', flexShrink: 0 },
    children: [
      jsxs('svg', {
        width: 64,
        height: 64,
        viewBox: '0 0 64 64',
        'aria-hidden': 'true',
        children: [
          jsx('circle', { cx: 32, cy: 32, r: 26, fill: 'none', stroke: colour.line, strokeWidth: 6 }),
          jsx('circle', {
            className: 'lithermes-ring-arc',
            cx: 32,
            cy: 32,
            r: 26,
            fill: 'none',
            stroke: tone,
            strokeWidth: 6,
            strokeLinecap: 'round',
            strokeDasharray: RING,
            strokeDashoffset: RING * (1 - share),
            transform: 'rotate(-90 32 32)'
          })
        ]
      }),
      jsxs('div', {
        role: 'img',
        'aria-label': passed + ' of ' + total + ' criteria proven',
        style: {
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1.05
        },
        children: [
          span(passed + '/' + total, { color: colour.strong, fontWeight: 700, fontSize: '0.9375rem' }, 'count'),
          span('proven', { color: colour.muted, fontSize: '0.5625rem', letterSpacing: '0.06em' }, 'label')
        ]
      })
    ]
  })
}

function gatePill(open) {
  const tone = open ? colour.ok : colour.danger

  return jsxs(
    'span',
    {
      className: 'lithermes-flip',
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.375rem',
        padding: '0.125rem 0.5rem',
        borderRadius: '9999px',
        border: '1px solid ' + tone,
        background: 'color-mix(in srgb, ' + tone + ' 14%, transparent)',
        color: tone,
        fontWeight: 700,
        fontSize: '0.6875rem',
        letterSpacing: '0.08em'
      },
      children: [span(open ? '◆' : '■', { fontSize: '0.625rem' }, 'glyph'), span(open ? 'GATE OPEN' : 'GATE CLOSED', null, 'label')]
    },
    open ? 'open' : 'closed'
  )
}

function header(data) {
  const gate = data.gate
  const { passed, total } = progress(data)
  const when = gate.evaluated_at ? 'checked ' + clock(gate.evaluated_at) : 'checked live'
  const source = gate.source === 'session' ? ' · as reported by the session' : ''

  return jsxs('div', {
    className: 'lithermes-card lithermes-in' + (gate.open ? ' lithermes-glow' : ''),
    style: { display: 'flex', gap: '0.75rem', padding: '0.75rem', alignItems: 'center' },
    children: [
      ring(passed, total, gate.open),
      jsxs('div', {
        style: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '0.3125rem' },
        children: [
          text(data.goal.title, { color: colour.strong, fontWeight: 650, fontSize: '0.875rem', overflowWrap: 'anywhere' }, 'title'),
          jsxs('div', {
            style: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
            children: [gatePill(gate.open), span('lit gate: ' + (gate.open ? 'open' : 'closed'), { color: colour.faint, fontSize: '0.6875rem' }, 'state')]
          }, 'gate'),
          text(when + source, { color: colour.faint, fontSize: '0.6875rem' }, 'when')
        ]
      })
    ]
  })
}

function section(title, rows, count) {
  return jsxs('div', {
    style: { display: 'flex', flexDirection: 'column', gap: '0.375rem' },
    children: [
      jsxs('div', {
        style: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
        children: [
          span(title, { color: colour.muted, fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }, 'title'),
          count == null ? null : span(String(count), { color: colour.faint, fontSize: '0.6875rem' }, 'count'),
          jsx('span', { style: { flex: 1, height: '1px', background: colour.line } }, 'rule')
        ]
      }),
      ...rows
    ]
  })
}

function urgentStrip(gate) {
  const urgent = urgentReasons(gate)

  if (!urgent.length) return null

  return jsx('div', {
    className: 'lithermes-in',
    style: {
      borderLeft: '3px solid ' + colour.warn,
      background: 'color-mix(in srgb, ' + colour.warn + ' 10%, transparent)',
      borderRadius: '6px',
      padding: '0.5rem 0.625rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem'
    },
    children: urgent.map((reason, index) =>
      text((GUARD_REASON.test(reason) ? '⛔ ' : '⚠ ') + reason, { color: GUARD_REASON.test(reason) ? colour.danger : colour.warn, fontSize: '0.75rem' }, index)
    )
  })
}

function stageColour(stage) {
  const tone = toneColour(stage.tone)

  if (tone) return tone
  if (stage.state === 'done') return colour.ok
  if (stage.state === 'active') return colour.lit

  return colour.faint
}

function stageDot(stage) {
  const colourOfStage = stageColour(stage)

  return jsx('span', {
    'data-stage': stage.key,
    className: stage.state === 'active' ? 'lithermes-pulse' : undefined,
    style: {
      width: '0.75rem',
      height: '0.75rem',
      marginTop: '0.1875rem',
      flexShrink: 0,
      borderRadius: '9999px',
      color: colourOfStage,
      border: '2px solid ' + colourOfStage,
      background: stage.state === 'done' ? colourOfStage : 'transparent'
    }
  })
}

function stageLines(stage) {
  const items = Array.isArray(stage.items) ? stage.items : []

  if (!items.length) {
    return [text(stage.detail, { color: toneColour(stage.tone) || colour.muted, fontSize: '0.75rem', overflowWrap: 'anywhere' }, 'detail')]
  }

  return [
    jsx(
      'div',
      {
        style: { display: 'flex', flexWrap: 'wrap', gap: '0.125rem 0.75rem', fontSize: '0.75rem' },
        children: items.map((item, index) =>
          jsx('span', { style: { color: toneColour(item.tone) || colour.muted, overflowWrap: 'anywhere' }, children: item.text }, index)
        )
      },
      'items'
    )
  ]
}

function stageRow(stage, index, all) {
  const last = index === all.length - 1
  const done = stage.state === 'done'

  return jsxs(
    'div',
    {
      className: 'lithermes-in',
      style: { display: 'flex', gap: '0.625rem', animationDelay: index * 55 + 'ms' },
      children: [
        jsxs('div', {
          style: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
          children: [
            stageDot(stage),
            last
              ? null
              : jsx('span', {
                  className: done ? 'lithermes-grow' : undefined,
                  style: { flexGrow: 1, width: '2px', borderRadius: '2px', background: done ? colour.ok : colour.line, marginTop: '0.1875rem' }
                })
          ]
        }),
        jsxs('div', {
          style: { minWidth: 0, flex: 1, paddingBottom: last ? 0 : '0.625rem' },
          children: [
            text(stage.label, { fontWeight: stage.state === 'todo' ? 400 : 650, color: stage.state === 'todo' ? colour.muted : colour.strong }, 'label'),
            ...stageLines(stage)
          ]
        })
      ]
    },
    stage.key
  )
}

function cites(run) {
  return Array.isArray(run.cited_by) && run.cited_by.length > 0
}

// A stale run matters only while the gate names it as stale evidence; any other stale run is history.
function blocking(run, gate) {
  return Boolean(run.stale) && (gate.reasons || []).some(reason => String(reason).includes(' evidence ' + run.id + ' is stale'))
}

function receiptMark(run) {
  const code = run.exit == null ? '' : 'exit ' + run.exit + ' · '
  if (run.blocking) return { glyph: '⚠', label: code + 'stale', tone: colour.warn }
  if (run.stale) return { glyph: '·', label: code + 'superseded', tone: colour.faint }
  if (run.exit === 0) return { glyph: '✓', label: 'exit 0', tone: colour.ok }
  if (run.exit == null) return { glyph: '?', label: 'no exit', tone: colour.muted }

  return { glyph: '✗', label: 'exit ' + run.exit, tone: colour.danger }
}

function receiptRow(run, index) {
  const mark = receiptMark(run)
  const cited = cites(run) ? 'cited by ' + run.cited_by.join(', ') : 'not cited'
  const urgent = run.blocking
  const when = age(run.at)

  return jsxs(
    'div',
    {
      className: 'lithermes-card lithermes-in',
      style: {
        padding: '0.5rem 0.625rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.1875rem',
        borderColor: urgent ? colour.warn : colour.line,
        opacity: run.stale && !urgent ? 0.72 : 1,
        animationDelay: index * 45 + 'ms'
      },
      children: [
        jsxs('div', {
          style: { display: 'flex', alignItems: 'baseline', gap: '0.5rem' },
          children: [
            span(mark.glyph, { color: mark.tone, fontWeight: 700, width: '0.875rem' }, 'glyph'),
            span(run.id, { color: colour.strong, fontWeight: 700 }, 'id', 'lithermes-mono'),
            span(mark.label, { color: mark.tone, fontSize: '0.6875rem' }, 'exit'),
            span('signed', { color: colour.faint, fontSize: '0.625rem', border: '1px solid ' + colour.line, borderRadius: '4px', padding: '0 0.25rem' }, 'signed'),
            jsx('span', { style: { flex: 1 } }, 'gap'),
            span(when, { color: colour.muted, fontSize: '0.6875rem' }, 'age')
          ]
        }, 'top'),
        run.command ? text('$ ' + run.command, { color: colour.muted, fontSize: '0.6875rem', overflowWrap: 'anywhere' }, 'cmd', 'lithermes-mono') : null,
        text(urgent && run.stale_reason ? run.stale_reason + ' (re-run it)' : run.stale ? cited + ' · files changed since' : cited, {
          color: urgent ? colour.warn : colour.faint,
          fontSize: '0.6875rem'
        }, 'why')
      ]
    },
    run.id || index
  )
}

function criterionRow(criterion, index) {
  const passed = criterion.status === 'pass'

  return jsxs(
    'div',
    {
      className: 'lithermes-in',
      style: { display: 'flex', gap: '0.5rem', alignItems: 'baseline', animationDelay: index * 40 + 'ms' },
      children: [
        jsx('span', {
          style: {
            color: passed ? colour.ok : colour.muted,
            minWidth: '4.5rem',
            fontSize: '0.6875rem',
            fontWeight: 650,
            letterSpacing: '0.04em'
          },
          children: passed ? '✓ pass' : '○ ' + (criterion.status || 'pending')
        }),
        jsx('span', { style: { color: colour.primary, overflowWrap: 'anywhere' }, children: criterion.id + '  ' + criterion.text })
      ]
    },
    criterion.id
  )
}

function reportedNote(gate) {
  if (gate.source !== 'session') return []

  return [text('gate, runs and blockers: as reported by the session', { color: colour.faint, fontSize: '0.6875rem', marginTop: '0.25rem' }, 'reported')]
}

const STEPS = [
  ['plan', 'Plan', 'criteria are written before any code'],
  ['runs', 'Runs', 'every test run is signed as it finishes'],
  ['gate', 'Gate', '"done" waits until each criterion has proof'],
  ['handoff', 'Handoff', 'the next session resumes where this one stopped']
]

function Onboarding({ cwd }) {
  const folder = String(cwd || '').split('/').filter(Boolean).pop() || 'this folder'

  return jsxs('div', {
    className: 'lithermes-pane flex h-full flex-col',
    style: { padding: '0.875rem', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: '0.875rem', overflowY: 'auto' },
    children: [
      jsxs('div', {
        className: 'lithermes-card lithermes-in lithermes-glow',
        style: { padding: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
        children: [
          jsxs('div', {
            style: { display: 'flex', alignItems: 'baseline', gap: '0.5rem' },
            children: [
              span('lit', { color: colour.lit, fontWeight: 800, fontSize: '1.75rem', letterSpacing: '-0.03em', lineHeight: 1 }, 'word'),
              span('No active lit goal', { color: colour.muted, fontSize: '0.75rem' }, 'state')
            ]
          }),
          text('Add one word to a request. The agent plans, works, and shows proof before it says done.', {
            color: colour.strong,
            fontSize: '0.875rem',
            lineHeight: 1.35
          }, 'lede'),
          text('Type this in the chat', { color: colour.faint, fontSize: '0.6875rem', marginTop: '0.25rem' }, 'hint'),
          jsxs('div', {
            className: 'lithermes-mono',
            style: {
              border: '1px solid ' + colour.line,
              borderRadius: '8px',
              padding: '0.5rem 0.625rem',
              background: 'color-mix(in srgb, ' + colour.lit + ' 8%, transparent)'
            },
            children: [span('lit ', { color: colour.lit, fontWeight: 700 }, 'kw'), span('fix the failing export test', { color: colour.primary }, 'task')]
          }, 'example')
        ]
      }),
      section(
        'What you will see here',
        [
          jsx('div', {
            style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' },
            children: STEPS.map(([key, label, line], index) =>
              jsxs(
                'div',
                {
                  className: 'lithermes-card lithermes-in',
                  style: { padding: '0.5rem 0.625rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', animationDelay: 80 + index * 70 + 'ms' },
                  children: [
                    jsxs('div', {
                      style: { display: 'flex', alignItems: 'center', gap: '0.375rem' },
                      children: [
                        span('◆', { color: index < 2 ? colour.lit : colour.ok, fontSize: '0.625rem' }, 'dot'),
                        span(String(index + 1) + ' ' + label, { color: colour.strong, fontWeight: 650 }, 'label')
                      ]
                    }),
                    text(line, { color: colour.muted, fontSize: '0.6875rem', lineHeight: 1.3 }, 'line')
                  ]
                },
                key
              )
            )
          }, 'tiles')
        ]
      ),
      section('The timeline you will get', [
        jsx('div', {
          style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.25rem 0.25rem 0' },
          children: ['Plan', 'Runs', 'Review', 'Gate', 'Handoff', 'Resume'].map((label, index) =>
            jsxs(
              'div',
              {
                style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3125rem' },
                children: [
                  jsx('span', {
                    className: 'lithermes-sweep',
                    style: {
                      width: '0.75rem',
                      height: '0.75rem',
                      borderRadius: '9999px',
                      border: '2px solid ' + (index < 3 ? colour.lit : colour.ok),
                      background: index < 3 ? colour.lit : colour.ok,
                      animationDelay: index * 0.45 + 's'
                    }
                  }),
                  span(label, { color: colour.faint, fontSize: '0.625rem' }, 'label')
                ]
              },
              label
            )
          )
        }, 'ghost')
      ]),
      text('This pane fills in as soon as a session in ' + folder + ' sets a lit goal. A closed gate keeps "done" from going out without proof.', {
        color: colour.faint,
        fontSize: '0.6875rem',
        lineHeight: 1.35
      }, 'foot')
    ]
  })
}

function GoalPane({ ctx }) {
  const cwd = useValue(host.state.cwd)
  const { data } = useGoal(ctx)

  if (!data || !data.goal) return jsx(Onboarding, { cwd })

  const gate = data.gate
  const stages = Array.isArray(data.stages) ? data.stages : []
  const receipts = Array.isArray(data.receipts) ? data.receipts : []
  const criteria = Array.isArray(data.criteria) ? data.criteria : []
  const urgent = urgentReasons(gate)
  const others = (gate.reasons || []).filter(reason => !urgent.includes(reason))
  const blocks = [header(data), urgentStrip(gate)]

  if (stages.length) blocks.push(section('Timeline', [...stages.map(stageRow), ...reportedNote(gate)]))
  if (receipts.length) blocks.push(section('Receipts', receipts.map((run, index) => receiptRow({ ...run, blocking: blocking(run, gate) }, index)), receipts.length))
  blocks.push(section('Criteria', criteria.map(criterionRow), progress(data).passed + '/' + criteria.length))
  if (others.length) {
    blocks.push(section('Why the gate is closed', others.map((reason, index) => text(reason, { color: colour.muted, fontSize: '0.75rem' }, index))))
  }

  return jsx('div', {
    className: 'lithermes-pane flex h-full flex-col',
    style: { padding: '0.75rem', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: '0.875rem', overflowY: 'auto' },
    children: blocks
  })
}

function GateChip({ ctx }) {
  const { data } = useGoal(ctx)

  if (!data || !data.goal) return null
  const open = data.gate.open
  const { passed, total } = progress(data)

  return jsxs(
    'span',
    {
      className: 'lithermes-chip lithermes-flip px-1.5 text-[0.6875rem]',
      style: { display: 'inline-flex', alignItems: 'center', gap: '0.3125rem', color: open ? colour.muted : colour.danger },
      title: passed + ' of ' + total + ' criteria proven',
      children: [
        jsx('span', { style: { width: '0.4375rem', height: '0.4375rem', borderRadius: '9999px', background: open ? colour.ok : colour.danger } }),
        span('lit gate: ' + (open ? 'open' : 'closed'), null, 'label'),
        span(passed + '/' + total, { color: colour.faint }, 'count')
      ]
    },
    open ? 'open' : 'closed'
  )
}

export default {
  id: 'lithermes',
  name: 'LitHermes',
  register(ctx) {
    injectStyle(ctx)
    ctx.register({
      id: 'goal-pane',
      area: 'panes',
      title: 'lit goal',
      data: { placement: 'right', width: '340px' },
      render: () => jsx(GoalPane, { ctx })
    })
    ctx.register({
      id: 'gate-chip',
      area: 'statusBar.right',
      order: 120,
      render: () => jsx(GateChip, { ctx })
    })
  }
}
