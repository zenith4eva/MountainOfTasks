import { useMemo, useState } from 'react'
import type { StoredEv } from '../lib/db'
import { DATA_REPO } from '../lib/github'
import { replay, type State } from '../lib/model'
import { describeRows } from '../lib/describe'
import { Icon, fmtTime } from './ui'

const TYPES: Record<string, string> = {
  card: 'Cards', comment: 'Comments', column: 'Columns', board: 'Boards', label: 'Labels', attachment: 'Attachments',
}

export function Journal({ state, events, onPreview, onOpen }: {
  state: State; events: StoredEv[]; onPreview: (title: string, s: State, boardId?: string) => void; onOpen: (cardId: string) => void
}) {
  const [board, setBoard] = useState('')
  const [label, setLabel] = useState('')
  const [type, setType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [text, setText] = useState('')
  const [limit, setLimit] = useState(200)

  const all = useMemo(() => describeRows(events, state).reverse(), [events, state])
  const rows = useMemo(() => {
    const q = text.toLowerCase()
    const f0 = from ? new Date(from + 'T00:00').getTime() : -Infinity
    const t0 = to ? new Date(to + 'T23:59:59').getTime() : Infinity
    return all.filter(({ ev: e, text: t }) => {
      const p = e.payload
      if (board && p.boardId !== board) return false
      if (type && !e.type.startsWith(type + '.')) return false
      if (label && !(state.cards[p.cardId]?.labels.includes(label) || p.labelId === label)) return false
      if (e.ts < f0 || e.ts > t0) return false
      if (q && !t.toLowerCase().includes(q)) return false
      return true
    })
  }, [all, state, board, label, type, from, to, text])

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
      <h1 className="pb-4 pt-2 text-[24px] font-semibold">Journal</h1>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-6">
        <input className="field col-span-2" placeholder="Search events" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search events" />
        <select className="field" value={board} onChange={(e) => setBoard(e.target.value)} aria-label="Board">
          <option value="">All boards</option>
          {Object.values(state.boards).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="field" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="field" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Label">
          <option value="">All labels</option>
          {Object.values(state.labels).filter((l) => !l.deleted).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <div className="col-span-2 flex gap-1 sm:col-span-1">
          <input type="date" className="field px-1 text-xs" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" className="field px-1 text-xs" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </div>
      </div>
      <p className="mb-2 text-xs text-muted">{rows.length} events</p>
      <ol className="overflow-hidden rounded-[8px] bg-surface">
        {rows.slice(0, limit).map(({ ev: e, text: t }) => (
          <li key={e.id} className="group flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-2.5 last:border-0">
            <time className="w-32 shrink-0 text-xs text-muted">{fmtTime(e.ts)}</time>
            <button className="min-w-0 flex-1 text-left hover:underline disabled:no-underline" disabled={!state.cards[e.payload.cardId]}
              onClick={() => onOpen(e.payload.cardId)}>{t}</button>
            <span className="text-xs text-muted">{e.device}{!e.synced && ' · not synced'}</span>
            <span className="flex gap-2 text-xs sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
              <button className="text-data hover:underline" onClick={() => onPreview(`As of ${fmtTime(e.ts)}`, replay(events, e.ts), e.payload.boardId)}>View at this point</button>
              <a className="inline-flex items-center gap-0.5 text-muted hover:text-ink" target="_blank" rel="noreferrer"
                href={`https://github.com/${DATA_REPO}/commits/main?until=${new Date(e.ts + 86400000).toISOString().slice(0, 10)}`}>
                repo <Icon name="right" size={10} />
              </a>
            </span>
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-8 text-center text-muted">No events match.</li>}
      </ol>
      {rows.length > limit && <button className="btn btn-quiet mt-3" onClick={() => setLimit((l) => l + 200)}>Show more</button>}
    </div>
  )
}
