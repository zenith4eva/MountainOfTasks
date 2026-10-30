import { db, emit, emitMany, uid } from './db'
import { between, sortByPos } from './frac'
import { gitBlobSha, sha256Hex } from './crypto'
import { t } from '../i18n'
import { type Card, type ChecklistItem, type Column, type EvType, type State } from './model'

export async function createBoard(name: string) {
  const boardId = uid()
  const evs: [EvType, Record<string, unknown>][] = [['board.create', { boardId, name }]]
  let pos: string | null = null
  for (const [n, done] of [[t('colTodo'), false], [t('colDoing'), false], [t('colDone'), true]] as const) {
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

/** Upsert one checklist item (partial fields merge); `null` removes it. */
export const setChecklistItem = (card: Card, itemId: string, item: Partial<Omit<ChecklistItem, 'id'>> | null) =>
  emit('card.checklist', { boardId: card.boardId, cardId: card.id, itemId, item })

export const setLabel = (card: Card, labelId: string, on: boolean) =>
  emit('card.label', { boardId: card.boardId, cardId: card.id, labelId, on })

export const moveCard = (card: Card, columnId: string, pos: string) =>
  emit('card.move', { boardId: card.boardId, cardId: card.id, columnId, pos })

export const addComment = (card: Card, text: string) =>
  emit('comment.add', { boardId: card.boardId, cardId: card.id, commentId: uid(), text })

export async function createLabel(name: string, color: string) {
  const labelId = uid()
  await emit('label.create', { labelId, name, color })
  return labelId
}

export async function addNewLabel(card: Card, name: string, color: string) {
  await setLabel(card, await createLabel(name, color), true)
}

export const updateLabel = (labelId: string, fields: Record<string, unknown>) => emit('label.update', { labelId, fields })

export const WARN_BYTES = 50 * 1024 * 1024
// GitHub rejects files over 100 MB in a repo; the spec's 500 MB ceiling assumed release assets,
// which browsers cannot upload to (uploads.github.com sends no CORS headers).
export const MAX_BYTES = 100 * 1024 * 1024

// Pasted screenshots are multi-megabyte PNGs and the repo keeps them forever. Re-encode big raster
// images to WebP (JPEG where WebP encoding is missing) at most 2048 px; keep the original if that is not smaller.
// ponytail: alpha is lost on the JPEG fallback; fine for screenshots, revisit if people attach logos.
const SHRINK_ABOVE = 300 * 1024
export async function shrinkImage(f: File): Promise<File> {
  if (!/^image\/(png|jpe?g|webp|bmp|tiff?)$/.test(f.type) || f.size < SHRINK_ABOVE || typeof createImageBitmap !== 'function') return f
  try {
    const bmp = await createImageBitmap(f)
    const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k)
    const canvas = new OffscreenCanvas(w, h)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    let blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })
    if (blob.type !== 'image/webp') blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
    if (blob.size >= f.size) return f
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg'
    return new File([blob], f.name.replace(/\.[^.]*$/, '') + '.' + ext, { type: blob.type, lastModified: f.lastModified })
  } catch { return f } // undecodable or canvas tainted: upload as-is
}

export async function attachFiles(card: Card, files: File[]): Promise<{ id: string; mime: string }[]> {
  const ids: { id: string; mime: string }[] = []
  for (const raw of files) {
    const f = await shrinkImage(raw)
    if (f.size > MAX_BYTES) { alert(t('tooLarge', { name: f.name })); continue }
    if (f.size > WARN_BYTES && !confirm(t('largeConfirm', { name: f.name, mb: (f.size / 1048576).toFixed(0) }))) continue
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

export async function removeAttachment(card: Card, attId: string) {
  const path = card.attachments[attId]?.path
  if (path) await db.blobs.delete(path) // still pending: never upload it
  return emit('attachment.removed', { boardId: card.boardId, cardId: card.id, attId })
}
