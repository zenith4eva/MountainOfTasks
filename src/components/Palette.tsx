import { useMemo, useState } from 'react'
import type { State } from '../lib/model'
import { Icon } from './ui'

export interface Command { id: string; label: string; hint?: string; run: () => void }

export function Palette({ state, commands, onBoard, onCard, onClose }: {
  state: State; commands: Command[]
  onBoard: (id: string) => void; onCard: (id: string) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)

  const items = useMemo(() => {
    const t = q.trim().toLowerCase()
    const hit = (s: string) => !t || s.toLowerCase().includes(t)
    const cmds = commands.filter((c) => hit(c.label)).map((c) => ({ key: c.id, label: c.label, hint: c.hint ?? 'Command', run: c.run }))
    const boards = Object.values(state.boards).filter((b) => !b.deleted && hit(b.name))
      .map((b) => ({ key: b.id, label: b.name, hint: 'Board', run: () => onBoard(b.id) }))
    const cards = t ? Object.values(state.cards).filter((c) => !c.deleted && !state.boards[c.boardId]?.deleted && (hit(c.title) || hit(c.description)))
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30)
      .map((c) => ({
        key: c.id, label: c.title,
        hint: `${state.boards[c.boardId]?.name} · ${state.boards[c.boardId]?.columns[c.columnId]?.name ?? ''}`,
        run: () => { onBoard(c.boardId); onCard(c.id) },
      })) : []
    return [...cards, ...boards, ...cmds]
  }, [q, state, commands, onBoard, onCard])

  const go = (i: number) => { const it = items[i]; if (it) { onClose(); it.run() } }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Command palette" className="w-full max-w-xl overflow-hidden rounded-[12px] bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Icon name="search" className="text-muted" />
          <input autoFocus value={q} placeholder="Search cards, boards, commands" aria-label="Search"
            className="h-12 flex-1 bg-transparent text-[15px] outline-none"
            onChange={(e) => { setQ(e.target.value); setSel(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
              if (e.key === 'Enter') go(sel)
              if (e.key === 'Escape') onClose()
            }} />
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1" role="listbox">
          {items.map((it, i) => (
            <li key={it.key + i} role="option" aria-selected={i === sel}>
              <button onMouseEnter={() => setSel(i)} onClick={() => go(i)}
                className={`flex w-full items-baseline gap-3 rounded-[6px] px-3 py-2 text-left ${i === sel ? 'bg-raised' : ''}`}>
                <span className="flex-1 truncate">{it.label}</span>
                <span className="shrink-0 text-xs text-muted">{it.hint}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="px-3 py-6 text-center text-muted">Nothing found.</li>}
        </ul>
      </div>
    </div>
  )
}
