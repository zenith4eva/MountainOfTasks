import Dexie, { type Table } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { replay, type Ev, type EvType, type State, emptyState } from './model'

export interface StoredEv extends Ev { synced: 0 | 1 }
export interface RemoteFile { path: string; sha: string; text?: string }
export interface PendingBlob { path: string; cardId: string; data: Blob }
export interface Kv { k: string; v: any }

class DB extends Dexie {
  events!: Table<StoredEv, string>
  files!: Table<RemoteFile, string>
  blobs!: Table<PendingBlob, string>
  kv!: Table<Kv, string>
  constructor() {
    super('mountain-of-tasks')
    this.version(1).stores({ events: '&id, ts, synced', files: '&path', blobs: '&path', kv: '&k' })
  }
}

export const db = new DB()

export const getKv = async <T>(k: string, d: T): Promise<T> => ((await db.kv.get(k))?.v ?? d) as T
export const setKv = (k: string, v: unknown) => db.kv.put({ k, v })

export function useKv<T>(k: string, d: T): T {
  return useLiveQuery(() => getKv(k, d), [k], d) as T
}

export const defaultDevice = () => {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Mac/.test(ua)) return 'Mac'
  return 'Browser'
}

export const device = () => getKv('device', defaultDevice())
export const uid = () => crypto.randomUUID()

// Wakes the sync loop; set by the sync module.
export const listeners = { onEmit: () => {} }

export async function emit(type: EvType, payload: Record<string, unknown>) {
  return (await emitMany([[type, payload]]))[0]
}

/** Several events in one transaction: all land or none do. */
export async function emitMany(list: [EvType, Record<string, unknown>][]) {
  const dev = await device()
  const ts = Date.now()
  const evs: StoredEv[] = list.map(([type, payload], i) => ({ id: uid(), ts: ts + i, device: dev, type, payload, synced: 0 }))
  await db.events.bulkAdd(evs)
  listeners.onEmit()
  return evs
}

export function useEvents(): StoredEv[] {
  return useLiveQuery(() => db.events.toArray(), [], [] as StoredEv[])
}

export function useAppState(): { state: State; events: StoredEv[] } {
  const events = useEvents()
  const state = useMemo(() => (events.length ? replay(events) : emptyState()), [events])
  return { state, events }
}

export function usePendingCount(): number {
  return useLiveQuery(() => db.events.where('synced').equals(0).count(), [], 0)
}

/** Drop cached data and the pending queue (used after a remote rollback). */
export async function dropCache() {
  await db.transaction('rw', db.events, db.files, db.blobs, async () => {
    await db.events.clear()
    await db.files.clear()
    await db.blobs.clear()
  })
  await db.kv.delete('headSha')
}
