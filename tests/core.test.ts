import { describe, it, expect } from 'vitest'
import { between, keyAt, sortByPos } from '../src/lib/frac'
import { merge, replay, commitMessage, eventPath, type Ev } from '../src/lib/model'
import { sealWithPin, openWithPin } from '../src/lib/crypto'
import { describeRows } from '../src/lib/describe'

let n = 0
const ev = (type: Ev['type'], payload: any, ts = ++n, device = 'A'): Ev => ({ id: `e${String(ts).padStart(5, '0')}${device}`, ts, device, type, payload })

const base = (): Ev[] => [
  ev('board.create', { boardId: 'b', name: 'Main' }, 1),
  ev('column.create', { boardId: 'b', columnId: 'todo', name: 'To do', pos: 'a0' }, 2),
  ev('column.create', { boardId: 'b', columnId: 'done', name: 'Done', pos: 'a1', countsAsDone: true }, 3),
  ev('card.create', { boardId: 'b', cardId: 'c', columnId: 'todo', pos: 'a0', title: 'Fix auth' }, 4),
]

describe('reducer', () => {
  it('builds board, columns, card', () => {
    const s = replay(base())
    expect(s.boards.b.name).toBe('Main')
    expect(Object.keys(s.boards.b.columns)).toEqual(['todo', 'done'])
    expect(s.cards.c).toMatchObject({ title: 'Fix auth', columnId: 'todo', completedAt: null, priority: 'none' })
  })

  it('sets completedAt on move into a done column and clears it on move out', () => {
    const s1 = replay([...base(), ev('card.move', { boardId: 'b', cardId: 'c', columnId: 'done', pos: 'a0' }, 10)])
    expect(s1.cards.c.completedAt).toBe(10)
    const s2 = replay([...base(), ev('card.move', { boardId: 'b', cardId: 'c', columnId: 'done', pos: 'a0' }, 10),
      ev('card.move', { boardId: 'b', cardId: 'c', columnId: 'done', pos: 'a1' }, 11)])
    expect(s2.cards.c.completedAt).toBe(10) // reorder inside done keeps the month
    const s3 = replay([...base(), ev('card.move', { boardId: 'b', cardId: 'c', columnId: 'done', pos: 'a0' }, 10),
      ev('card.move', { boardId: 'b', cardId: 'c', columnId: 'todo', pos: 'a0' }, 12)])
    expect(s3.cards.c.completedAt).toBeNull()
  })

  it('toggling countsAsDone marks existing cards', () => {
    const s = replay([...base(), ev('column.update', { boardId: 'b', columnId: 'todo', fields: { countsAsDone: true } }, 20)])
    expect(s.cards.c.completedAt).toBe(20)
  })

  it('soft-deletes and keeps comments, attachments', () => {
    const s = replay([...base(),
      ev('comment.add', { boardId: 'b', cardId: 'c', commentId: 'm', text: 'hi' }, 5),
      ev('attachment.added', { boardId: 'b', cardId: 'c', att: { id: 'x', name: 'a.png', size: 1, mime: 'image/png', path: 'p', blob: 'b', sha256: 'h' } }, 6),
      ev('card.update', { boardId: 'b', cardId: 'c', fields: { cover: 'x' } }, 7),
      ev('attachment.removed', { boardId: 'b', cardId: 'c', attId: 'x' }, 8),
      ev('card.update', { boardId: 'b', cardId: 'c', fields: { deleted: true } }, 9)])
    expect(s.cards.c.deleted).toBe(true)
    expect(s.cards.c.comments[0].text).toBe('hi')
    expect(s.cards.c.attachments.x.removed).toBe(true)
    expect(s.cards.c.cover).toBeNull()
  })

  it('replay until a timestamp shows the past', () => {
    const evs = [...base(), ev('card.update', { boardId: 'b', cardId: 'c', fields: { title: 'New' } }, 30)]
    expect(replay(evs, 29).cards.c.title).toBe('Fix auth')
    expect(replay(evs).cards.c.title).toBe('New')
  })
})

describe('merge', () => {
  it('unions by id and is order independent; later ts wins per field', () => {
    const a = [...base(), ev('card.update', { boardId: 'b', cardId: 'c', fields: { title: 'From A' } }, 40, 'A')]
    const b = [...base(), ev('card.update', { boardId: 'b', cardId: 'c', fields: { title: 'From B', priority: 'high' } }, 41, 'B')]
    const ab = merge(a, b), ba = merge(b, a)
    expect(ab.map((e) => e.id)).toEqual(ba.map((e) => e.id))
    expect(ab.length).toBe(base().length + 2)
    const s = replay(ab)
    expect(s.cards.c.title).toBe('From B')
    expect(s.cards.c.priority).toBe('high')
  })

  it('edits to different fields both survive', () => {
    const a = ev('card.update', { boardId: 'b', cardId: 'c', fields: { due: '2026-11-01' } }, 50, 'A')
    const b = ev('card.update', { boardId: 'b', cardId: 'c', fields: { priority: 'low' } }, 51, 'B')
    const s = replay(merge([...base(), a], [b]))
    expect(s.cards.c).toMatchObject({ due: '2026-11-01', priority: 'low' })
  })

  it('files events by board and UTC month', () => {
    expect(eventPath(ev('card.create', { boardId: 'b' }, Date.UTC(2026, 9, 31, 23)))).toBe('events/b/2026-10.jsonl')
    expect(eventPath(ev('label.create', { labelId: 'l' }, Date.UTC(2026, 0, 1)))).toBe('events/_global/2026-01.jsonl')
  })

  it('commit message', () => {
    const evs = base()
    const s = replay(evs)
    const mv = ev('card.move', { boardId: 'b', cardId: 'c', columnId: 'done', pos: 'a1' }, 60)
    expect(commitMessage('iPhone', [mv], s)).toBe('[iPhone] move "Fix auth" → Done')
    const adds = [1, 2, 3, 4].map((i) => ev('card.create', { boardId: 'b', cardId: `n${i}`, columnId: 'todo', pos: 'a0', title: `t${i}` }, 70 + i))
    expect(commitMessage('iPhone', [mv, ...adds], s)).toBe('[iPhone] move 1 card; add 4 cards')
  })
})

describe('history rows', () => {
  const lbl = ev('label.create', { labelId: 'L', name: 'Project', color: '#e8eefb' }, 5)
  const set = (labels: string[], ts: number) => ev('card.update', { boardId: 'b', cardId: 'c', fields: { labels } }, ts)

  it('collapses rapid toggles into the net change', () => {
    const evs = [...base(), lbl, set(['L'], 1000), set([], 2000), set(['L'], 3000), set([], 4000), set(['L'], 5000)]
    const rows = describeRows(evs, replay(evs)).filter((r) => r.ev.type === 'card.update')
    expect(rows.map((r) => r.text)).toEqual(['Added label "Project" to "Fix auth"'])
  })

  it('drops a net no-op and keeps edits far apart in time', () => {
    const noop = [...base(), lbl, set(['L'], 1000), set([], 2000)]
    expect(describeRows(noop, replay(noop)).filter((r) => r.ev.type === 'card.update')).toHaveLength(0)
    const apart = [...base(), lbl, set(['L'], 1000), set([], 1000 + 5 * 60_000)]
    expect(describeRows(apart, replay(apart)).filter((r) => r.ev.type === 'card.update').map((r) => r.text))
      .toEqual(['Added label "Project" to "Fix auth"', 'Removed label "Project" from "Fix auth"'])
  })

  it('names checklist changes', () => {
    const item = { id: 'i', text: 'Deploy', done: false }
    const evs = [...base(),
      ev('card.update', { boardId: 'b', cardId: 'c', fields: { checklist: [item] } }, 1000),
      ev('card.update', { boardId: 'b', cardId: 'c', fields: { checklist: [{ ...item, done: true }] } }, 1000 + 5 * 60_000)]
    expect(describeRows(evs, replay(evs)).slice(-2).map((r) => r.text))
      .toEqual(['Added "Deploy" to the checklist on "Fix auth"', 'Checked "Deploy" on "Fix auth"'])
  })

  it('commit message counts distinct cards, not edits', () => {
    const evs = [...base(), lbl, set(['L'], 1000), set([], 2000), set(['L'], 3000), set([], 4000)]
    expect(commitMessage('Windows', evs.slice(4), replay(evs))).toBe('[Windows] add 1 label; edit 1 card')
  })
})

describe('fractional index', () => {
  it('between is strictly ordered, including repeated inserts at the same gap', () => {
    let lo: string | null = null
    const hi = between(null, null)
    for (let i = 0; i < 200; i++) {
      const k = between(lo, hi)
      if (lo) expect(lo < k).toBe(true)
      expect(k < hi).toBe(true)
      lo = k
    }
  })

  it('concurrent inserts into the same gap do not collide and stay sortable', () => {
    const a = between(null, null), b = between(a, null)
    const keys = Array.from({ length: 50 }, () => between(a, b))
    for (const k of keys) expect(a < k && k < b).toBe(true)
    expect(new Set(keys).size).toBeGreaterThan(45)
  })

  it('keyAt drops at index, and survives duplicate keys', () => {
    const items = sortByPos([{ id: '1', pos: 'a0' }, { id: '2', pos: 'a1' }, { id: '3', pos: 'a1' }])
    const k = keyAt(items, 1)
    expect('a0' < k && k < 'a1').toBe(true)
    expect(() => keyAt(items, 2)).not.toThrow() // between two equal keys
    expect(sortByPos(items).map((x) => x.id)).toEqual(['1', '2', '3'])
  })
})

describe('PIN crypto', () => {
  it('round-trips with the right PIN and rejects a wrong one', async () => {
    const s = await sealWithPin('1234', 'github_pat_secret', 1000)
    expect(s.ct).not.toContain('secret')
    expect(await openWithPin('1234', s, 1000)).toBe('github_pat_secret')
    await expect(openWithPin('4321', s, 1000)).rejects.toThrow()
  })
})

describe('item-level checklist and label events', () => {
  const cl = (itemId: string, item: any, ts: number, device = 'A') => ev('card.checklist', { boardId: 'b', cardId: 'c', itemId, item }, ts, device)
  const lb = (labelId: string, on: boolean, ts: number, device = 'A') => ev('card.label', { boardId: 'b', cardId: 'c', labelId, on }, ts, device)

  it('two devices ticking different items offline both land', () => {
    const shared = [...base(), cl('x', { text: 'Write', done: false }, 100), cl('y', { text: 'Ship', done: false }, 101)]
    const phone = [cl('x', { done: true }, 200, 'iPhone')]
    const pc = [cl('y', { done: true }, 201, 'Windows')]
    const s = replay(merge(shared, phone, pc))
    expect(s.cards.c.checklist).toEqual([{ id: 'x', text: 'Write', done: true }, { id: 'y', text: 'Ship', done: true }])
  })

  it('rename and tick of the same item merge field by field; remove wins when later', () => {
    const evs = [...base(), cl('x', { text: 'Write', done: false }, 100), cl('x', { text: 'Write docs' }, 200, 'iPhone'), cl('x', { done: true }, 201, 'Windows')]
    expect(replay(evs).cards.c.checklist).toEqual([{ id: 'x', text: 'Write docs', done: true }])
    expect(replay([...evs, cl('x', null, 300)]).cards.c.checklist).toEqual([])
  })

  it('label toggles from two devices union', () => {
    const s = replay(merge([...base(), lb('L1', true, 100, 'iPhone')], [lb('L2', true, 100, 'Windows')]))
    expect(s.cards.c.labels.sort()).toEqual(['L1', 'L2'])
    expect(replay([...base(), lb('L1', true, 100), lb('L1', false, 200), lb('L1', false, 201)]).cards.c.labels).toEqual([])
  })

  it('history rows name item events like the old whole-array edits', () => {
    const lbl = ev('label.create', { labelId: 'L', name: 'Project', color: '#e8eefb' }, 5)
    const evs = [...base(), lbl, cl('x', { text: 'Deploy', done: false }, 1000), cl('x', { done: true }, 1000 + 5 * 60_000), lb('L', true, 1000 + 10 * 60_000)]
    expect(describeRows(evs, replay(evs)).slice(-3).map((r) => r.text))
      .toEqual(['Added "Deploy" to the checklist on "Fix auth"', 'Checked "Deploy" on "Fix auth"', 'Added label "Project" to "Fix auth"'])
    expect(commitMessage('iPhone', evs.slice(4), replay(evs))).toBe('[iPhone] add 1 label; edit 1 card')
  })
})
