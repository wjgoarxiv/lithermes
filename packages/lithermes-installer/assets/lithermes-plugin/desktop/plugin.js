// LitHermes desktop half: a right-hand pane and a status-bar chip that show the
// workspace's newest litgoal, whether its quality gate is open, and a six-stage
// timeline (plan, runs, review, gate, handoff, resume).
//
// Plain ESM, loaded uncompiled by Hermes Desktop: no JSX, no build step. The only
// imports are the host SDK, React's JSX runtime, and nothing else. The data comes
// from the plugin's own read-only route (GET /api/plugins/lithermes/goal), polled
// every five seconds for the workspace the app currently has open. Gate, runs and
// blockers are shown as the session reported them; the pane never verifies them.
import { host, useQuery, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const POLL_MS = 5000

const colour = {
  primary: 'var(--ui-text-secondary)',
  muted: 'var(--ui-text-tertiary)',
  faint: 'var(--ui-text-quaternary)',
  line: 'var(--ui-stroke-secondary)',
  accent: 'var(--ui-accent)',
  ok: 'var(--ui-green, var(--ui-accent))',
  warn: 'var(--ui-yellow, var(--ui-accent))',
  danger: 'var(--ui-red, var(--ui-accent))'
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

function text(content, style, key) {
  return jsx('div', { style: { color: colour.primary, ...style }, children: content }, key)
}

function evidenceMark(item) {
  if (item.stale === true) return { label: 'stale', color: colour.warn }
  if (item.verified === true) return { label: 'verified', color: colour.accent }
  if (item.verified === false) return { label: 'claimed', color: colour.muted }
  return { label: 'recorded', color: colour.muted }
}

function section(title, rows) {
  return jsxs('div', {
    style: { borderTop: '1px solid ' + colour.line, paddingTop: '0.5rem' },
    children: [text(title, { color: colour.muted, fontSize: '0.6875rem', marginBottom: '0.25rem' }), ...rows]
  })
}

function criterionRow(criterion) {
  const passed = criterion.status === 'pass'

  return jsxs('div', {
    key: criterion.id,
    style: { display: 'flex', gap: '0.5rem' },
    children: [
      jsx('span', {
        style: { color: passed ? colour.accent : colour.muted, minWidth: '3.5rem' },
        children: passed ? 'pass' : 'pending'
      }),
      jsx('span', { style: { color: colour.primary }, children: criterion.id + '  ' + criterion.text })
    ]
  })
}

function evidenceRow(item, index) {
  const mark = evidenceMark(item)

  return jsxs('div', {
    key: index,
    style: { display: 'flex', gap: '0.5rem' },
    children: [
      jsx('span', { style: { color: mark.color, minWidth: '3.5rem' }, children: mark.label }),
      jsx('span', { style: { color: colour.primary }, children: item.criterion + ' ' + item.kind + '  ' + item.ref })
    ]
  })
}

function stageColour(stage) {
  const tone = toneColour(stage.tone)

  if (tone) return tone
  if (stage.state === 'done') return colour.accent
  if (stage.state === 'active') return colour.primary

  return colour.faint
}

function stageDot(stage) {
  const colourOfStage = stageColour(stage)

  return jsx('span', {
    style: {
      width: '0.625rem',
      height: '0.625rem',
      marginTop: '0.25rem',
      flexShrink: 0,
      borderRadius: '9999px',
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

  return jsxs(
    'div',
    {
      style: { display: 'flex', gap: '0.5rem' },
      children: [
        jsxs('div', {
          style: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
          children: [
            stageDot(stage),
            last ? null : jsx('span', { style: { flexGrow: 1, width: '1px', background: colour.line, marginTop: '0.125rem' } })
          ]
        }),
        jsxs('div', {
          style: { minWidth: 0, flex: 1, paddingBottom: last ? 0 : '0.625rem' },
          children: [
            text(stage.label, { fontWeight: stage.state === 'todo' ? 400 : 600, color: stage.state === 'todo' ? colour.muted : colour.primary }, 'label'),
            ...stageLines(stage)
          ]
        })
      ]
    },
    stage.key
  )
}

function reportedNote(gate) {
  if (gate.source !== 'session') return []

  return [text('gate, runs and blockers: as reported by the session', { color: colour.faint, fontSize: '0.6875rem', marginTop: '0.5rem' }, 'reported')]
}

function GoalPane({ ctx }) {
  const { data } = useGoal(ctx)
  const shell = {
    padding: '0.75rem',
    fontSize: '0.8125rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    overflowY: 'auto'
  }

  if (!data || !data.goal) {
    return jsx('div', { className: 'flex h-full flex-col', style: shell, children: text('No active lit goal', { color: colour.muted }) })
  }

  const gate = data.gate
  const stages = Array.isArray(data.stages) ? data.stages : []
  const blocks = [
    jsxs('div', {
      children: [
        text(data.goal.title, { fontWeight: 600 }),
        text('lit gate: ' + (gate.open ? 'open' : 'closed'), { color: gate.open ? colour.primary : colour.accent })
      ]
    }),
    ...(stages.length ? [section('Timeline', [...stages.map(stageRow), ...reportedNote(gate)])] : []),
    section('Criteria', data.criteria.map(criterionRow))
  ]

  if (data.evidence.length) blocks.push(section('Evidence', data.evidence.map(evidenceRow)))
  if (gate.reasons.length) {
    blocks.push(section('Why the gate is closed', gate.reasons.map((reason, index) => text(reason, { color: colour.muted }, index))))
  }

  return jsx('div', { className: 'flex h-full flex-col', style: shell, children: blocks })
}

function GateChip({ ctx }) {
  const { data } = useGoal(ctx)

  if (!data || !data.goal) return null

  return jsx('span', {
    className: 'px-1.5 text-[0.6875rem]',
    style: { color: data.gate.open ? colour.muted : colour.accent },
    children: 'lit gate: ' + (data.gate.open ? 'open' : 'closed')
  })
}

export default {
  id: 'lithermes',
  name: 'LitHermes',
  register(ctx) {
    ctx.register({
      id: 'goal-pane',
      area: 'panes',
      title: 'lit goal',
      data: { placement: 'right', width: '320px' },
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
