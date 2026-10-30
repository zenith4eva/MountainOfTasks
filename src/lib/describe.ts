import { apply, emptyState, evOrder, type Ev, type State } from './model'
import { fmtDay, t } from '../i18n'

const PRIORITY_KEY = { none: 'noPriority', low: 'low', med: 'medium', high: 'high' } as const
export const priorityName = (p: keyof typeof PRIORITY_KEY) => t(PRIORITY_KEY[p] ?? 'noPriority')

export function describeEvent(e: Ev, s: State): string {
  const p = e.payload
  const card = s.cards[p.cardId]?.title ?? p.title ?? t('defCard')
  const col = (id: string) => s.boards[p.boardId]?.columns[id]?.name ?? t('defColumn')
  switch (e.type) {
    case 'board.create': return t('dBoardCreated', { name: p.name })
    case 'board.update':
      return p.fields.deleted ? t('dBoardDeleted') : p.fields.deleted === false ? t('dBoardRestored') : t('dBoardRenamed', { name: p.fields.name })
    case 'column.create': return t('dColAdded', { name: p.name })
    case 'column.update': {
      const f = p.fields
      const name = col(p.columnId)
      if ('name' in f) return t('dColRenamed', { name: f.name })
      if ('archived' in f) return t(f.archived ? 'dColArchived' : 'dColUnarchived', { name })
      if ('countsAsDone' in f) return t(f.countsAsDone ? 'dColDoneOn' : 'dColDoneOff', { name })
      if ('wip' in f) return t('dColWip', { name, n: f.wip ?? t('none') })
      return t('dColReordered', { name })
    }
    case 'card.create': return t('dCardAdded', { card, col: col(p.columnId) })
    case 'card.move': return t('dCardMoved', { card, col: col(p.columnId) })
    case 'card.update': {
      const f = p.fields
      if (f.deleted === true) return t('dCardDeleted', { card })
      if (f.deleted === false) return t('dCardRestored', { card })
      if ('title' in f) return t('dCardRenamed', { name: f.title })
      if ('checklist' in f) return t('dChecklistUpdated', { card })
      if ('labels' in f) return t('dLabelsChanged', { card })
      if ('due' in f) return f.due ? t('dDueSet', { card, date: fmtDay(f.due) }) : t('dDueCleared', { card })
      if ('priority' in f) return t('dPrioritySet', { card, p: priorityName(f.priority) })
      if ('cover' in f) return t(f.cover ? 'dCoverSet' : 'dCoverRemoved', { card })
      if ('description' in f) return t('dDescEdited', { card })
      return t('dCardEdited', { card })
    }
    case 'card.checklist': return t('dChecklistUpdated', { card })
    case 'card.label': return t('dLabelsChanged', { card })
    case 'comment.add': return t('dCommented', { card, text: p.text.slice(0, 80) })
    case 'label.create': return t('dLabelCreated', { name: p.name })
    case 'label.update': return t('dLabelEdited', { name: s.labels[p.labelId]?.name ?? '' })
    case 'attachment.added': return t('dAttached', { name: p.att.name, card })
    case 'attachment.removed': return t('dAttRemoved', { card })
  }
}

export interface Row<E extends Ev = Ev> { ev: E; ts: number; text: string }

// Fields whose rapid repeat edits collapse into one row showing the net change.
const MERGEABLE = new Set(['labels', 'checklist', 'priority', 'due', 'cover'])
const MERGE_WINDOW = 120_000

function diffText(field: string, before: any, after: any, card: string, s: State): string {
  const names = (ids: string[]) => ids.map((id) => t('dLabelName', { name: s.labels[id]?.name ?? t('defLabel') })).join(t('dListSep'))
  switch (field) {
    case 'labels': {
      const b: string[] = before ?? [], a: string[] = after ?? []
      const add = a.filter((x) => !b.includes(x)), rem = b.filter((x) => !a.includes(x))
      return [
        add.length ? t('dLabelAdded', { names: names(add), card }) : '',
        rem.length ? t('dLabelRemoved', { names: names(rem), card }) : '',
      ].filter(Boolean).join(t('dJoin'))
    }
    case 'checklist': {
      const b: any[] = before ?? [], a: any[] = after ?? []
      const out: string[] = []
      for (const i of a) {
        const old = b.find((x) => x.id === i.id)
        if (!old) out.push(t('dClAdded', { text: i.text }))
        else if (old.done !== i.done) out.push(t(i.done ? 'dClChecked' : 'dClUnchecked', { text: i.text }))
        else if (old.text !== i.text) out.push(t('dClRenamed', { text: i.text }))
      }
      for (const i of b) if (!a.some((x) => x.id === i.id)) out.push(t('dClRemoved', { text: i.text }))
      return out.length ? t('dClOn', { changes: out.join(t('dJoin')), card }) : ''
    }
    case 'priority': return before === after ? '' : t('dPrioritySet', { card, p: priorityName(after) })
    case 'due': return before === after ? '' : after ? t('dDueSet', { card, date: fmtDay(after) }) : t('dDueCleared', { card })
    case 'cover': return before === after ? '' : t(after ? 'dCoverSet' : 'dCoverRemoved', { card })
  }
  return ''
}

/**
 * Human rows for a list of events. Repeated edits of the same field on the same card from the
 * same device within two minutes become one row with the net change; a net no-op disappears.
 * Names come from `final` (current titles), diffs from the state at each step.
 */
export function describeRows<E extends Ev>(events: E[], final: State): Row<E>[] {
  const step = emptyState()
  const rows: (Row<E> & { key?: string; before?: any })[] = []
  for (const e of [...events].sort(evOrder)) {
    const p = e.payload
    const keys = e.type === 'card.update' ? Object.keys(p.fields) : []
    const field = e.type === 'card.checklist' ? 'checklist' : e.type === 'card.label' ? 'labels'
      : keys.length === 1 && MERGEABLE.has(keys[0]) ? keys[0] : null
    const before = field ? structuredClone((step.cards[p.cardId] as any)?.[field]) : undefined
    apply(step, e)
    if (!field) {
      rows.push({ ev: e, ts: e.ts, text: describeEvent(e, final) })
      continue
    }
    const after = (step.cards[p.cardId] as any)?.[field]
    const title = final.cards[p.cardId]?.title ?? step.cards[p.cardId]?.title ?? t('defCard')
    const key = `${p.cardId}:${field}:${e.device}`
    const last = rows.at(-1)
    if (last?.key === key && e.ts - last.ts < MERGE_WINDOW) {
      Object.assign(last, { ev: e, ts: e.ts, text: diffText(field, last.before, after, title, final) })
    } else {
      rows.push({ ev: e, ts: e.ts, key, before, text: diffText(field, before, after, title, final) })
    }
  }
  return rows.filter((r) => r.text).map(({ ev, ts, text }) => ({ ev, ts, text }))
}
