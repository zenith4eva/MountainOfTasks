export type Priority = 'none' | 'low' | 'med' | 'high'

export interface Ev {
  id: string
  ts: number
  device: string
  type: EvType
  payload: any
}

export type EvType =
  | 'board.create' | 'board.update'
  | 'column.create' | 'column.update'
  | 'card.create' | 'card.update' | 'card.move'
  | 'comment.add'
  | 'label.create' | 'label.update'
  | 'attachment.added' | 'attachment.removed'

export interface Column {
  id: string
  name: string
  pos: string
  countsAsDone: boolean
  wip: number | null
  archived: boolean
}

export interface Board {
  id: string
  name: string
  columns: Record<string, Column>
  settings: Record<string, unknown>
  deleted: boolean
  createdAt: number
}

export interface ChecklistItem { id: string; text: string; done: boolean }
export interface Comment { id: string; ts: number; device: string; text: string }
export interface Attachment {
  id: string
  name: string
  size: number
  mime: string
  path: string // repo path of the stored file
  blob: string // git blob sha; read through git/blobs, since the contents API mangles binary
  sha256: string
  ts: number
  removed: boolean
}

export interface Card {
  id: string
  boardId: string
  columnId: string
  pos: string
  title: string
  description: string
  labels: string[]
  due: string | null
  checklist: ChecklistItem[]
  priority: Priority
  comments: Comment[]
  attachments: Record<string, Attachment>
  cover: string | null
  completedAt: number | null
  deleted: boolean
  createdAt: number
  updatedAt: number
}

export interface Label { id: string; name: string; color: string; deleted: boolean }

export interface State {
  boards: Record<string, Board>
  cards: Record<string, Card>
  labels: Record<string, Label>
}

export const emptyState = (): State => ({ boards: {}, cards: {}, labels: {} })

export const evOrder = (a: Ev, b: Ev) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Union by id, ordered by ts. Later ts wins per field during replay; nothing is dropped. */
export function merge(...lists: Ev[][]): Ev[] {
  const m = new Map<string, Ev>()
  for (const l of lists) for (const e of l) m.set(e.id, e)
  return [...m.values()].sort(evOrder)
}

/** File an event belongs to in the data repo. */
export function eventPath(e: Ev): string {
  const d = new Date(e.ts)
  const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  return `events/${e.payload.boardId ?? '_global'}/${month}.jsonl`
}

const isDone = (s: State, boardId: string, columnId: string) =>
  !!s.boards[boardId]?.columns[columnId]?.countsAsDone

export function apply(s: State, e: Ev): State {
  const p = e.payload
  switch (e.type) {
    case 'board.create':
      s.boards[p.boardId] = { id: p.boardId, name: p.name, columns: {}, settings: {}, deleted: false, createdAt: e.ts }
      break
    case 'board.update': {
      const b = s.boards[p.boardId]
      if (b) Object.assign(b, p.fields)
      break
    }
    case 'column.create': {
      const b = s.boards[p.boardId]
      if (b) b.columns[p.columnId] = { id: p.columnId, name: p.name, pos: p.pos, countsAsDone: !!p.countsAsDone, wip: p.wip ?? null, archived: false }
      break
    }
    case 'column.update': {
      const col = s.boards[p.boardId]?.columns[p.columnId]
      if (!col) break
      const wasDone = col.countsAsDone
      Object.assign(col, p.fields)
      if (wasDone !== col.countsAsDone)
        for (const c of Object.values(s.cards))
          if (c.columnId === col.id) c.completedAt = col.countsAsDone ? (c.completedAt ?? e.ts) : null
      break
    }
    case 'card.create':
      s.cards[p.cardId] = {
        id: p.cardId, boardId: p.boardId, columnId: p.columnId, pos: p.pos, title: p.title,
        description: '', labels: [], due: null, checklist: [], priority: 'none', comments: [],
        attachments: {}, cover: null, deleted: false, createdAt: e.ts, updatedAt: e.ts,
        completedAt: isDone(s, p.boardId, p.columnId) ? e.ts : null,
      }
      break
    case 'card.update': {
      const c = s.cards[p.cardId]
      if (c) Object.assign(c, p.fields, { updatedAt: e.ts })
      break
    }
    case 'card.move': {
      const c = s.cards[p.cardId]
      if (!c) break
      const was = isDone(s, c.boardId, c.columnId)
      const now = isDone(s, c.boardId, p.columnId)
      c.columnId = p.columnId
      c.pos = p.pos
      c.updatedAt = e.ts
      if (now && !was) c.completedAt = e.ts
      if (!now) c.completedAt = null
      break
    }
    case 'comment.add': {
      const c = s.cards[p.cardId]
      if (c) c.comments = [...c.comments, { id: p.commentId, ts: e.ts, device: e.device, text: p.text }]
      break
    }
    case 'label.create':
      s.labels[p.labelId] = { id: p.labelId, name: p.name, color: p.color, deleted: false }
      break
    case 'label.update': {
      const l = s.labels[p.labelId]
      if (l) Object.assign(l, p.fields)
      break
    }
    case 'attachment.added': {
      const c = s.cards[p.cardId]
      if (c) c.attachments = { ...c.attachments, [p.att.id]: { ...p.att, ts: e.ts, removed: false } }
      break
    }
    case 'attachment.removed': {
      const a = s.cards[p.cardId]?.attachments[p.attId]
      if (a) {
        a.removed = true
        const c = s.cards[p.cardId]
        if (c.cover === p.attId) c.cover = null
      }
      break
    }
  }
  return s
}

// ponytail: full replay on every change; snapshot + incremental apply if event count gets into the 100k range.
export function replay(events: Ev[], until = Infinity): State {
  const s = emptyState()
  for (const e of [...events].sort(evOrder)) {
    if (e.ts > until) break
    apply(s, e)
  }
  return s
}

/** Board snapshot written to boards/<id>.json on every sync. */
export function snapshot(s: State, boardId: string) {
  return {
    board: s.boards[boardId],
    cards: Object.values(s.cards).filter((c) => c.boardId === boardId && !c.deleted),
  }
}

const q = (t: string) => `"${t.length > 40 ? t.slice(0, 39) + '…' : t}"`

/** `[iPhone] move "Fix auth" → Doing; add 2 cards` */
export function commitMessage(device: string, events: Ev[], s: State): string {
  const card = (id: string) => s.cards[id]?.title ?? 'card'
  const col = (b: string, c: string) => s.boards[b]?.columns[c]?.name ?? 'column'
  const parts: string[] = []
  const counts = new Map<string, number>()
  if (events.length <= 3) {
    for (const e of events) {
      const p = e.payload
      switch (e.type) {
        case 'card.create': parts.push(`add ${q(p.title)}`); break
        case 'card.move': parts.push(`move ${q(card(p.cardId))} → ${col(p.boardId, p.columnId)}`); break
        case 'card.update':
          parts.push(p.fields.deleted ? `delete ${q(card(p.cardId))}` : `edit ${q(card(p.cardId))} (${Object.keys(p.fields).join(', ')})`)
          break
        case 'comment.add': parts.push(`comment on ${q(card(p.cardId))}`); break
        case 'board.create': parts.push(`create board ${q(p.name)}`); break
        case 'attachment.added': parts.push(`attach ${q(p.att.name)}`); break
        default: parts.push(e.type.replace('.', ' '))
      }
    }
  } else {
    const nouns: Record<string, [string, string]> = {
      'card.create': ['add', 'card'], 'card.move': ['move', 'card'], 'card.update': ['edit', 'card'],
      'comment.add': ['add', 'comment'], 'column.create': ['add', 'column'], 'column.update': ['edit', 'column'],
      'board.create': ['create', 'board'], 'board.update': ['edit', 'board'], 'label.create': ['add', 'label'],
      'label.update': ['edit', 'label'], 'attachment.added': ['attach', 'file'], 'attachment.removed': ['remove', 'file'],
    }
    // Count distinct things touched, so nine edits of one card read "edit 1 card".
    const touched = new Map<string, Set<string>>()
    for (const e of events) {
      const p = e.payload
      const id = p.cardId ?? p.columnId ?? p.labelId ?? p.att?.id ?? p.attId ?? p.boardId ?? e.id
      touched.set(e.type, (touched.get(e.type) ?? new Set()).add(id))
    }
    for (const [t, ids] of touched) counts.set(t, ids.size)
    for (const [t, n] of counts) {
      const [verb, noun] = nouns[t] ?? [t, 'event']
      parts.push(`${verb} ${n} ${noun}${n > 1 ? 's' : ''}`)
    }
  }
  return `[${device}] ${parts.join('; ')}`
}
