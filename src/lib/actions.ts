import { db, emit, emitMany, uid } from './db'
import { between, sortByPos } from './frac'
import { gitBlobSha, sha256Hex } from './crypto'
import { replay, type Card, type Column, type EvType, type State } from './model'

export async function createBoard(name: string) {
  const boardId = uid()
  const evs: [EvType, Record<string, unknown>][] = [['board.create', { boardId, name }]]
  let pos: string | null = null
  for (const [n, done] of [['To do', false], ['Doing', false], ['Done', true]] as const) {
    pos = between(pos, null)
    evs.push(['column.create', { boardId, columnId: uid(), name: n, pos, countsAsDone: done }])
  }
  await emitMany(evs)
  return boardId
}

export const renameBoard = (boardId: string, name: string) => emit('board.update', { boardId, fields: { name } })
export const deleteBoard = (boardId: string, deleted = true) => emit('board.update', { boardId, fields: { deleted } })

export function addColumn(state: State, boardId: string, name: string) {
  const cols = sortByPos(Object.values(state.boards[boardId].columns))
  return emit('column.create', { boardId, columnId: uid(), name, pos: between(cols.at(-1)?.pos ?? null, null) })
}

export const updateColumn = (boardId: string, columnId: string, fields: Partial<Column>) =>
  emit('column.update', { boardId, columnId, fields })

export const addCard = (boardId: string, columnId: string, title: string, pos: string) =>
  emit('card.create', { boardId, cardId: uid(), columnId, pos, title })

export const updateCard = (card: Card, fields: Partial<Card>) =>
  emit('card.update', { boardId: card.boardId, cardId: card.id, fields })

export const moveCard = (card: Card, columnId: string, pos: string) =>
  emit('card.move', { boardId: card.boardId, cardId: card.id, columnId, pos })

export const addComment = (card: Card, text: string) =>
  emit('comment.add', { boardId: card.boardId, cardId: card.id, commentId: uid(), text })

export async function createLabel(name: string, color: string) {
  const labelId = uid()
  await emit('label.create', { labelId, name, color })
  return labelId
}

/** Create a label and put it on the card, reading the card's labels at write time (not from a stale render). */
export async function addNewLabel(card: Card, name: string, color: string) {
  const id = await createLabel(name, color)
  const current = replay(await db.events.toArray()).cards[card.id]?.labels ?? card.labels
  await updateCard(card, { labels: [...current, id] })
}

export const updateLabel = (labelId: string, fields: Record<string, unknown>) => emit('label.update', { labelId, fields })

export const WARN_BYTES = 50 * 1024 * 1024
// GitHub rejects files over 100 MB in a repo; the spec's 500 MB ceiling assumed release assets,
// which browsers cannot upload to (uploads.github.com sends no CORS headers).
export const MAX_BYTES = 100 * 1024 * 1024

export async function attachFiles(card: Card, files: File[]): Promise<{ id: string; mime: string }[]> {
  const ids: { id: string; mime: string }[] = []
  for (const f of files) {
    if (f.size > MAX_BYTES) { alert(`${f.name} is larger than 100 MB, which GitHub will not store.`); continue }
    if (f.size > WARN_BYTES && !confirm(`${f.name} is ${(f.size / 1048576).toFixed(0)} MB. Attach anyway?`)) continue
    const id = uid()
    const safe = f.name.replace(/[^\w.-]+/g, '_').slice(-80) || 'file'
    const path = `attachments/${card.id}/${id}-${safe}`
    const bytes = new Uint8Array(await f.arrayBuffer())
    const sha256 = await sha256Hex(bytes)
    const blob = await gitBlobSha(bytes)
    await db.blobs.put({ path, cardId: card.id, data: f })
    await emit('attachment.added', {
      boardId: card.boardId, cardId: card.id,
      att: { id, name: f.name || 'pasted', size: f.size, mime: f.type || 'application/octet-stream', path, blob, sha256 },
    })
    ids.push({ id, mime: f.type })
  }
  return ids
}

export const removeAttachment = (card: Card, attId: string) =>
  emit('attachment.removed', { boardId: card.boardId, cardId: card.id, attId })
