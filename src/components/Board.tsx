import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, closestCorners,
  useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { keyAt, sortByPos } from '../lib/frac'
import type { Attachment, Card, Column, Priority, State } from '../lib/model'
import { addCard, addColumn, moveCard, updateColumn } from '../lib/actions'
import { Icon, LabelPill, MenuItem, Popover, fmtDay, fmtMonth, fmtMonthShort, priorityName, today, useAttachmentUrl } from './ui'
import { t } from '../i18n'

export interface Filter { labels: string[]; due: 'any' | 'overdue' | 'week' | 'none'; priority: 'any' | Priority }
export const noFilter: Filter = { labels: [], due: 'any', priority: 'any' }

export function matches(c: Card, f: Filter) {
  if (f.labels.length && !f.labels.some((l) => c.labels.includes(l))) return false
  if (f.priority !== 'any' && c.priority !== f.priority) return false
  const t = today()
  if (f.due === 'none' && c.due) return false
  if (f.due === 'overdue' && !(c.due && c.due < t && !c.completedAt)) return false
  if (f.due === 'week') {
    const wk = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
    if (!(c.due && c.due <= wk && !c.completedAt)) return false
  }
  return true
}

type Ym = { y: number; m: number }
const nowYm = (): Ym => ({ y: new Date().getFullYear(), m: new Date().getMonth() })
const ymOf = (ts: number): Ym => ({ y: new Date(ts).getFullYear(), m: new Date(ts).getMonth() })
const sameYm = (a: Ym, b: Ym) => a.y === b.y && a.m === b.m

interface Props {
  state: State
  boardId: string
  readOnly?: boolean
  filter?: Filter
  onOpen?: (cardId: string) => void
}

export function BoardView({ state, boardId, readOnly, filter = noFilter, onOpen }: Props) {
  const board = state.boards[boardId]
  const [months, setMonths] = useState<Record<string, Ym>>({})
  const [drag, setDrag] = useState<{ cardId: string; columnId: string; pos: string } | null>(null)
  const [activeCol, setActiveCol] = useState<string | null>(null)
  const [newCol, setNewCol] = useState<string | null>(null)

  const columns = useMemo(() => sortByPos(Object.values(board?.columns ?? {}).filter((c) => !c.archived)), [board])
  const boardCards = useMemo(() => Object.values(state.cards).filter((c) => c.boardId === boardId && !c.deleted), [state, boardId])

  const placed = (c: Card) => (drag?.cardId === c.id ? { ...c, columnId: drag.columnId, pos: drag.pos } : c)

  const cardsOf = (col: Column): Card[] => {
    const ym = months[col.id] ?? nowYm()
    return sortByPos(boardCards.map(placed).filter((c) => {
      if (c.columnId !== col.id) return false
      if (c.id === drag?.cardId) return true
      if (col.countsAsDone && !sameYm(ymOf(c.completedAt ?? Date.now()), ym)) return false
      return matches(c, filter)
    }))
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const collision: CollisionDetection = (args) => {
    const isCol = String(args.active.id).startsWith('col:')
    const containers = args.droppableContainers.filter((d) => String(d.id).startsWith('col:') === isCol)
    return (isCol ? closestCenter : closestCorners)({ ...args, droppableContainers: containers })
  }

  const colOfOver = (id: string): string | undefined => {
    if (id.startsWith('drop:')) return id.slice(5)
    const c = state.cards[id]
    return c ? placed(c).columnId : undefined
  }

  function onStart(e: DragStartEvent) {
    const id = String(e.active.id)
    if (id.startsWith('col:')) return setActiveCol(id.slice(4))
    const c = state.cards[id]
    setDrag({ cardId: id, columnId: c.columnId, pos: c.pos })
  }

  function onOver(e: DragOverEvent) {
    if (!drag || !e.over) return
    const target = colOfOver(String(e.over.id))
    if (!target || target === drag.columnId) return
    const col = board.columns[target]
    const list = cardsOf(col).filter((c) => c.id !== drag.cardId)
    const overIdx = list.findIndex((c) => c.id === e.over!.id)
    setDrag({ ...drag, columnId: target, pos: keyAt(list, overIdx < 0 ? list.length : overIdx) })
  }

  function onEnd(e: DragEndEvent) {
    const id = String(e.active.id)
    const overId = e.over ? String(e.over.id) : null
    if (id.startsWith('col:')) {
      setActiveCol(null)
      if (!overId || overId === id) return
      const ids = columns.map((c) => `col:${c.id}`)
      const moved = arrayMove(columns, ids.indexOf(id), ids.indexOf(overId))
      const i = moved.findIndex((c) => c.id === id.slice(4))
      updateColumn(boardId, id.slice(4), { pos: keyAt(moved.filter((_, j) => j !== i), i) })
      return
    }
    const d = drag
    setDrag(null)
    if (!d || !overId) return
    const card = state.cards[id]
    const col = board.columns[d.columnId]
    const list = cardsOf(col)
    const from = list.findIndex((c) => c.id === id)
    const overIdx = list.findIndex((c) => c.id === overId)
    const arr = arrayMove(list, from, overIdx < 0 ? from : overIdx)
    const i = arr.findIndex((c) => c.id === id)
    const rest = arr.filter((c) => c.id !== id)
    if (card.columnId === d.columnId && i === from && d.pos === card.pos) return
    moveCard(card, d.columnId, keyAt(rest, i))
    if (col.countsAsDone && !board.columns[card.columnId]?.countsAsDone) setMonths((m) => ({ ...m, [col.id]: nowYm() }))
  }

  if (!board) return null
  const dragCard = drag ? state.cards[drag.cardId] : null

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onStart} onDragOver={onOver} onDragEnd={onEnd}
      onDragCancel={() => { setDrag(null); setActiveCol(null) }}>
      <div className="scroll-x flex h-full items-start gap-3 px-4 pb-6 pt-1 sm:px-6">
        <SortableContext items={columns.map((c) => `col:${c.id}`)} strategy={horizontalListSortingStrategy}>
          {columns.map((col) => (
            <ColumnView key={col.id} state={state} boardId={boardId} col={col} cards={cardsOf(col)} readOnly={readOnly}
              ym={months[col.id] ?? nowYm()} setYm={(ym) => setMonths((m) => ({ ...m, [col.id]: ym }))}
              allCards={boardCards} onOpen={onOpen} dimmed={activeCol === col.id} />
          ))}
        </SortableContext>
        {!readOnly && (
          <div className="w-[284px] shrink-0">
            {newCol === null ? (
              <button className="btn btn-ghost w-full justify-start text-muted" onClick={() => setNewCol('')}>
                <Icon name="plus" /> {t('addColumn')}
              </button>
            ) : (
              <form className="rounded-[8px] bg-raised p-2" onSubmit={(e) => {
                e.preventDefault()
                if (newCol.trim()) addColumn(state, boardId, newCol.trim())
                setNewCol(null)
              }}>
                <input autoFocus className="field" placeholder={t('columnName')} value={newCol}
                  onChange={(e) => setNewCol(e.target.value)} onBlur={(e) => !e.target.value && setNewCol(null)} />
              </form>
            )}
          </div>
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragCard && <CardTile card={dragCard} state={state} overlay />}
      </DragOverlay>
    </DndContext>
  )
}

interface ColProps {
  state: State; boardId: string; col: Column; cards: Card[]; allCards: Card[]; readOnly?: boolean
  ym: Ym; setYm: (ym: Ym) => void; onOpen?: (id: string) => void; dimmed: boolean
}

function ColumnView({ state, boardId, col, cards, allCards, readOnly, ym, setYm, onOpen, dimmed }: ColProps) {
  const sortable = useSortable({ id: `col:${col.id}`, disabled: readOnly })
  const drop = useDroppable({ id: `drop:${col.id}`, disabled: readOnly })
  const [renaming, setRenaming] = useState(false)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const inCol = allCards.filter((c) => c.columnId === col.id)
  const over = col.wip != null && !col.countsAsDone && inCol.length > col.wip

  const submitCard = () => {
    if (title.trim()) addCard(boardId, col.id, title.trim(), keyAt(cards, cards.length))
    setTitle('')
  }

  return (
    <section ref={sortable.setNodeRef} aria-label={col.name}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      className={`flex max-h-full w-[284px] shrink-0 flex-col rounded-[8px] bg-raised ${dimmed ? 'opacity-50' : ''}`}>
      <header className="flex items-center gap-1 px-2 pb-1 pt-2">
        {!readOnly && (
          <button {...sortable.attributes} {...sortable.listeners} aria-label={t('reorderX', { name: col.name })}
            className="cursor-grab touch-none rounded p-1 text-muted hover:bg-sunken">
            <Icon name="grip" size={14} />
          </button>
        )}
        {renaming ? (
          <input autoFocus defaultValue={col.name} className="field h-7 flex-1"
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== col.name) updateColumn(boardId, col.id, { name: v }); setRenaming(false) }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(false) }} />
        ) : (
          <h2 className="flex-1 truncate px-1 text-[14px] font-semibold" onDoubleClick={() => !readOnly && setRenaming(true)}>{col.name}</h2>
        )}
        <span className={`px-1 text-xs ${over ? 'font-semibold text-negative' : 'text-muted'}`}
          title={col.wip != null ? t('wipTitle', { n: col.wip }) : undefined}>
          {col.countsAsDone ? cards.length : inCol.length}{col.wip != null && !col.countsAsDone ? ` / ${col.wip}` : ''}
        </span>
        {!readOnly && (
          <Popover align="right" button={(toggle) => (
            <button onClick={toggle} aria-label={t('optionsX', { name: col.name })} className="rounded p-1 text-muted hover:bg-sunken"><Icon name="more" /></button>
          )}>
            {(close) => (
              <>
                <MenuItem onClick={() => { close(); setRenaming(true) }}>{t('rename')}</MenuItem>
                <MenuItem onClick={() => { close(); updateColumn(boardId, col.id, { countsAsDone: !col.countsAsDone }) }}>
                  <Icon name="check" size={14} className={col.countsAsDone ? '' : 'opacity-0'} /> {t('countsAsDone')}
                </MenuItem>
                <MenuItem onClick={() => {
                  close()
                  const v = prompt(t('wipPrompt'), col.wip?.toString() ?? '')
                  if (v === null) return
                  const n = parseInt(v, 10)
                  updateColumn(boardId, col.id, { wip: Number.isFinite(n) && n > 0 ? n : null })
                }}>{t('setWip')}</MenuItem>
                <MenuItem onClick={() => { close(); updateColumn(boardId, col.id, { archived: true }) }}>
                  <Icon name="archive" size={14} /> {t('archiveColumn')}
                </MenuItem>
              </>
            )}
          </Popover>
        )}
      </header>

      {col.countsAsDone && <MonthNav ym={ym} setYm={setYm} cards={inCol} />}

      <div ref={drop.setNodeRef} className="flex min-h-10 flex-col gap-2 overflow-y-auto px-2 pb-2">
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((c) => <SortableCard key={c.id} card={c} state={state} readOnly={readOnly} onOpen={onOpen} />)}
        </SortableContext>
        {col.countsAsDone && cards.length === 0 && (
          <p className="px-1 py-3 text-center text-xs text-muted">{t('nothingFinished', { month: fmtMonth(ym.y, ym.m) })}</p>
        )}
      </div>

      {!readOnly && (adding ? (
        <div className="px-2 pb-2">
          <textarea autoFocus rows={2} className="field" placeholder={t('cardTitle')} value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitCard() }
              if (e.key === 'Escape') { setAdding(false); setTitle('') }
            }} />
          <div className="mt-1.5 flex gap-1">
            <button className="btn btn-primary" onClick={submitCard}>{t('addCard')}</button>
            <button className="btn btn-ghost" onClick={() => { setAdding(false); setTitle('') }}>{t('cancel')}</button>
          </div>
        </div>
      ) : (
        <button className="btn btn-ghost m-1 justify-start text-muted" onClick={() => setAdding(true)}>
          <Icon name="plus" /> {t('addACard')}
        </button>
      ))}
    </section>
  )
}

function MonthNav({ ym, setYm, cards }: { ym: Ym; setYm: (ym: Ym) => void; cards: Card[] }) {
  const now = nowYm()
  const atNow = sameYm(ym, now)
  const counts = new Map<string, number>()
  for (const c of cards) {
    const d = ymOf(c.completedAt ?? Date.now())
    counts.set(`${d.y}-${d.m}`, (counts.get(`${d.y}-${d.m}`) ?? 0) + 1)
    counts.set(`${d.y}`, (counts.get(`${d.y}`) ?? 0) + 1)
  }
  const years = [...new Set([now.y, ...cards.map((c) => ymOf(c.completedAt ?? Date.now()).y)])].sort((a, b) => b - a)
  const [pickYear, setPickYear] = useState<number | null>(null)
  const step = (d: number) => {
    const t = new Date(ym.y, ym.m + d, 1)
    setYm({ y: t.getFullYear(), m: t.getMonth() })
  }
  return (
    <div className="mx-2 mb-2 flex items-center justify-between rounded-[6px] bg-surface px-1 py-0.5">
      <button className="rounded p-1 hover:bg-raised" onClick={() => step(-1)} aria-label={t('prevMonth')}><Icon name="left" size={14} /></button>
      <Popover button={(toggle) => (
        <button onClick={() => { setPickYear(null); toggle() }} className="rounded px-2 py-0.5 text-[13px] font-medium hover:bg-raised">
          {fmtMonth(ym.y, ym.m)}
        </button>
      )}>
        {(close) => pickYear == null ? (
          years.map((y) => (
            <MenuItem key={y} onClick={() => setPickYear(y)}>
              <span className="flex-1">{y}</span><span className="text-xs text-muted">{counts.get(`${y}`) ?? 0}</span>
            </MenuItem>
          ))
        ) : (
          <div className="grid grid-cols-3 gap-1 p-1">
            {Array.from({ length: 12 }, (_, m) => {
              const future = pickYear > now.y || (pickYear === now.y && m > now.m)
              const n = counts.get(`${pickYear}-${m}`) ?? 0
              return (
                <button key={m} disabled={future} onClick={() => { setYm({ y: pickYear, m }); close() }}
                  className={`rounded-[6px] px-2 py-1.5 text-left text-xs hover:bg-raised disabled:opacity-30 ${sameYm({ y: pickYear, m }, ym) ? 'bg-raised font-semibold' : ''}`}>
                  {fmtMonthShort(pickYear, m)}
                  <span className={`block ${n ? 'text-data' : 'text-muted'}`}>{n}</span>
                </button>
              )
            })}
          </div>
        )}
      </Popover>
      <button className="rounded p-1 hover:bg-raised disabled:opacity-30" disabled={atNow} onClick={() => step(1)} aria-label={t('nextMonth')}>
        <Icon name="right" size={14} />
      </button>
    </div>
  )
}

function SortableCard({ card, state, readOnly, onOpen }: { card: Card; state: State; readOnly?: boolean; onOpen?: (id: string) => void }) {
  const s = useSortable({ id: card.id, disabled: readOnly })
  return (
    <div ref={s.setNodeRef} {...s.attributes} {...s.listeners}
      style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }}
      className={s.isDragging ? 'opacity-30' : ''}
      onClick={() => onOpen?.(card.id)}
      onKeyDown={(e) => { s.listeners?.onKeyDown?.(e); if (e.key === 'Enter') onOpen?.(card.id) }}>
      <CardTile card={card} state={state} />
    </div>
  )
}

// Separate component so only cards with a cover open an attachment query.
function Cover({ att }: { att: Attachment }) {
  const { url } = useAttachmentUrl(att)
  return url ? <img src={url} alt="" className="h-32 w-full object-cover" /> : <div className="h-32 bg-sunken" />
}

export function CardTile({ card, state, overlay }: { card: Card; state: State; overlay?: boolean }) {
  const cover = card.cover ? card.attachments[card.cover] : undefined
  const checks = card.checklist.length
  const done = card.checklist.filter((i) => i.done).length
  const overdue = card.due && !card.completedAt && card.due < today()
  const atts = Object.values(card.attachments).filter((a) => !a.removed).length
  const labels = card.labels.map((l) => state.labels[l]).filter((l) => l && !l.deleted)
  return (
    <article className={`cursor-pointer overflow-hidden rounded-[8px] bg-surface transition-colors hover:bg-ground ${overlay ? 'rotate-2 shadow-xl' : ''}`}>
      {cover && !cover.removed && cover.mime.startsWith('image/') && <Cover att={cover} />}
      <div className="px-3 py-2">
        {labels.length > 0 && <div className="mb-1.5 flex flex-wrap gap-1">{labels.map((l) => <LabelPill key={l.id} label={l} small />)}</div>}
        <h3 className="text-[14px] leading-snug">{card.title}</h3>
        {(card.due || checks || card.comments.length || atts || card.priority !== 'none' || card.description) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {card.priority !== 'none' && (
              <span className={card.priority === 'high' ? 'font-semibold text-negative' : card.priority === 'med' ? 'text-warning' : ''}>
                {priorityName(card.priority)}
              </span>
            )}
            {card.due && (
              <span className={`inline-flex items-center gap-1 ${overdue ? 'font-semibold text-negative' : ''}`}>
                <Icon name="clock" size={12} />
                {fmtDay(card.due)}
              </span>
            )}
            {checks > 0 && (
              <span className={`inline-flex items-center gap-1 ${done === checks ? 'text-positive' : ''}`}>
                <Icon name="check" size={12} />{done}/{checks}
              </span>
            )}
            {card.comments.length > 0 && <span className="inline-flex items-center gap-1"><Icon name="comment" size={12} />{card.comments.length}</span>}
            {atts > 0 && <span className="inline-flex items-center gap-1"><Icon name="clip" size={12} />{atts}</span>}
          </div>
        )}
      </div>
    </article>
  )
}
