import { apply, emptyState, evOrder, type Ev, type State } from './model'

export function describeEvent(e: Ev, s: State): string {
  const p = e.payload
  const card = `"${s.cards[p.cardId]?.title ?? p.title ?? 'card'}"`
  const col = (id: string) => s.boards[p.boardId]?.columns[id]?.name ?? 'column'
  switch (e.type) {
    case 'board.create': return `Created board "${p.name}"`
    case 'board.update': return p.fields.deleted ? 'Deleted board' : p.fields.deleted === false ? 'Restored board' : `Renamed board to "${p.fields.name}"`
    case 'column.create': return `Added column "${p.name}"`
    case 'column.update': {
      const f = p.fields
      if ('name' in f) return `Renamed column to "${f.name}"`
      if ('archived' in f) return `${f.archived ? 'Archived' : 'Unarchived'} column "${col(p.columnId)}"`
      if ('countsAsDone' in f) return `"${col(p.columnId)}" ${f.countsAsDone ? 'now counts' : 'no longer counts'} as done`
      if ('wip' in f) return `Set WIP limit of "${col(p.columnId)}" to ${f.wip ?? 'none'}`
      return `Reordered column "${col(p.columnId)}"`
    }
    case 'card.create': return `Added ${card} to ${col(p.columnId)}`
    case 'card.move': return `Moved ${card} to ${col(p.columnId)}`
    case 'card.update': {
      const f = p.fields
      if (f.deleted === true) return `Deleted ${card}`
      if (f.deleted === false) return `Restored ${card}`
      if ('title' in f) return `Renamed card to "${f.title}"`
      if ('checklist' in f) return `Updated checklist on ${card}`
      if ('labels' in f) return `Changed labels on ${card}`
      if ('due' in f) return f.due ? `Set due date of ${card} to ${f.due}` : `Cleared due date of ${card}`
      if ('priority' in f) return `Set priority of ${card} to ${f.priority}`
      if ('cover' in f) return f.cover ? `Set cover on ${card}` : `Removed cover from ${card}`
      if ('description' in f) return `Edited description of ${card}`
      return `Edited ${card}`
    }
    case 'comment.add': return `Commented on ${card}: ${p.text.slice(0, 80)}`
    case 'label.create': return `Created label "${p.name}"`
    case 'label.update': return `Edited label "${s.labels[p.labelId]?.name ?? ''}"`
    case 'attachment.added': return `Attached ${p.att.name} to ${card}`
    case 'attachment.removed': return `Removed attachment from ${card}`
  }
}


export interface Row<E extends Ev = Ev> { ev: E; ts: number; text: string }

// Fields whose rapid repeat edits collapse into one row showing the net change.
const MERGEABLE = new Set(['labels', 'checklist', 'priority', 'due', 'cover'])
const MERGE_WINDOW = 120_000

function diffText(field: string, before: any, after: any, title: string, s: State): string {
  const card = `"${title}"`
  const name = (id: string) => `"${s.labels[id]?.name ?? 'label'}"`
  switch (field) {
    case 'labels': {
      const b: string[] = before ?? [], a: string[] = after ?? []
      const add = a.filter((x) => !b.includes(x)), rem = b.filter((x) => !a.includes(x))
      return [
        add.length ? `Added label ${add.map(name).join(', ')} to ${card}` : '',
        rem.length ? `Removed label ${rem.map(name).join(', ')} from ${card}` : '',
      ].filter(Boolean).join('; ')
    }
    case 'checklist': {
      const b: any[] = before ?? [], a: any[] = after ?? []
      const out: string[] = []
      for (const i of a) {
        const old = b.find((x) => x.id === i.id)
        if (!old) out.push(`Added "${i.text}" to the checklist`)
        else if (old.done !== i.done) out.push(`${i.done ? 'Checked' : 'Unchecked'} "${i.text}"`)
        else if (old.text !== i.text) out.push(`Renamed checklist item to "${i.text}"`)
      }
      for (const i of b) if (!a.some((x) => x.id === i.id)) out.push(`Removed "${i.text}" from the checklist`)
      return out.length ? `${out.join('; ')} on ${card}` : ''
    }
    case 'priority': return before === after ? '' : `Set priority of ${card} to ${after}`
    case 'due': return before === after ? '' : after ? `Set due date of ${card} to ${after}` : `Cleared due date of ${card}`
    case 'cover': return before === after ? '' : after ? `Set cover on ${card}` : `Removed cover from ${card}`
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
    const field = keys.length === 1 && MERGEABLE.has(keys[0]) ? keys[0] : null
    const before = field ? structuredClone((step.cards[p.cardId] as any)?.[field]) : undefined
    apply(step, e)
    if (!field) {
      rows.push({ ev: e, ts: e.ts, text: describeEvent(e, final) })
      continue
    }
    const after = (step.cards[p.cardId] as any)?.[field]
    const title = final.cards[p.cardId]?.title ?? step.cards[p.cardId]?.title ?? 'card'
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
