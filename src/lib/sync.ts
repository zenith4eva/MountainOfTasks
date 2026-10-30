import { db, getKv, setKv, device, dropCache, type StoredEv } from './db'
import { client, ConflictError, type Client, type NewEntry } from './github'
import { commitMessage, eventPath, merge, replay, snapshot, type Ev, type State } from './model'
import { b64, gitBlobSha } from './crypto'

let api: Client | null = null
export const setToken = (t: string | null) => { api = t ? client(t) : null }
export const getApi = () => {
  if (!api) throw new Error('Locked')
  return api
}

export const hooks = {
  /** Called before a remote rollback wipes local cache; resolves when the user has been warned. */
  onRollback: async (pending: number) => {
    alert(`The data repo was rolled back on another device. ${pending} unsynced change(s) on this device will be discarded.`)
  },
}

// One sync operation at a time.
let chain: Promise<unknown> = Promise.resolve()
const locked = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = chain.then(fn, fn)
  chain = p.catch(() => {})
  return p
}

const enc = new TextEncoder()

const parseLines = (text: string): Ev[] =>
  text.split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l) as Ev] } catch { return [] }
  })

const metaJson = async (state: State, epoch: number, prev: any) =>
  JSON.stringify({
    epoch,
    boards: Object.values(state.boards).map((b) => ({ id: b.id, name: b.name, deleted: b.deleted })),
    labels: Object.values(state.labels),
    devices: { ...(prev?.devices ?? {}), [await device()]: new Date().toISOString() },
  }, null, 2) + '\n'

async function pullInner(): Promise<boolean> {
  const gh = getApi()
  const head = await gh.headSha()
  if (!head) {
    const epoch = await getKv('epoch', 0)
    await gh.init(await metaJson(replay([]), epoch, null))
    return pullInner()
  }
  if (head === (await getKv<string | null>('headSha', null))) return false

  const commit = await gh.commit(head)
  const entries = await gh.tree(commit.tree.sha)
  const known = new Map((await db.files.toArray()).map((f) => [f.path, f]))

  const metaEntry = entries.find((e) => e.path === 'meta.json')
  if (metaEntry && known.get('meta.json')?.sha !== metaEntry.sha) {
    const text = await gh.blobText(metaEntry.sha)
    const remoteEpoch = JSON.parse(text).epoch ?? 0
    const localEpoch = await getKv('epoch', 0)
    if (remoteEpoch > localEpoch) {
      const pending = await db.events.where('synced').equals(0).count()
      if (localEpoch > 0 || pending) await hooks.onRollback(pending)
      await dropCache()
      known.clear()
    }
    await setKv('epoch', remoteEpoch)
    await db.files.put({ path: 'meta.json', sha: metaEntry.sha, text })
  }

  for (const e of entries) {
    if (e.type !== 'blob' || !e.path.endsWith('.jsonl') || known.get(e.path)?.sha === e.sha) continue
    const text = await gh.blobText(e.sha)
    const evs = parseLines(text).map((x): StoredEv => ({ ...x, synced: 1 }))
    await db.transaction('rw', db.events, db.files, async () => {
      await db.events.bulkPut(evs)
      await db.files.put({ path: e.path, sha: e.sha, text })
    })
  }
  await setKv('headSha', head)
  await setKv('treeSha', commit.tree.sha)
  await setKv('lastSync', Date.now())
  return true
}

export const pull = () => locked(pullInner)

export async function pendingMessage(): Promise<string> {
  const all = await db.events.toArray()
  const pending = all.filter((e) => !e.synced).sort((a, b) => a.ts - b.ts)
  return pending.length ? commitMessage(await device(), pending, replay(all)) : ''
}

export const push = (message?: string) => locked(async () => {
  const gh = getApi()
  for (let attempt = 0; attempt < 4; attempt++) {
    await pullInner()
    const all = await db.events.toArray()
    const pending = all.filter((e) => !e.synced).sort((a, b) => a.ts - b.ts)
    const blobs = await db.blobs.toArray()
    if (!pending.length && !blobs.length) return
    const head = (await getKv<string>('headSha', ''))!
    const treeSha = (await getKv<string>('treeSha', ''))!
    const state = replay(all)
    const entries: NewEntry[] = []

    for (const b of blobs) {
      const sha = await gh.createBlob(b64(await b.data.arrayBuffer()))
      entries.push({ path: b.path, sha })
    }

    const byPath = new Map<string, Ev[]>()
    for (const e of pending) {
      const p = eventPath(e)
      byPath.set(p, [...(byPath.get(p) ?? []), e])
    }
    const texts = new Map<string, string>()
    for (const [path, evs] of byPath) {
      const base = (await db.files.get(path))?.text ?? ''
      const lines = evs.map(({ synced: _, ...e }: any) => JSON.stringify(e)).join('\n') + '\n'
      texts.set(path, base + lines)
    }
    const boards = new Set(pending.map((e) => e.payload.boardId).filter(Boolean))
    for (const id of boards) if (state.boards[id]) texts.set(`boards/${id}.json`, JSON.stringify(snapshot(state, id), null, 2) + '\n')
    const prevMeta = (await db.files.get('meta.json'))?.text
    texts.set('meta.json', await metaJson(state, await getKv('epoch', 0), prevMeta ? JSON.parse(prevMeta) : null))
    for (const [path, content] of texts) entries.push({ path, content })

    const tree = await gh.createTree(treeSha, entries)
    const commit = await gh.createCommit(message || commitMessage(await device(), pending, state), tree, [head])
    try {
      await gh.moveRef(commit)
    } catch (err) {
      if (err instanceof ConflictError) continue
      throw err
    }
    const ids = pending.map((e) => e.id)
    const files = await Promise.all([...texts].map(async ([path, text]) => ({ path, text, sha: await gitBlobSha(enc.encode(text)) })))
    await db.transaction('rw', db.events, db.files, db.blobs, db.kv, async () => {
      await db.events.where('id').anyOf(ids).modify({ synced: 1 })
      await db.files.bulkPut(files)
      await db.blobs.bulkDelete(blobs.map((b) => b.path))
      await setKv('headSha', commit)
      await setKv('treeSha', tree)
      await setKv('lastSync', Date.now())
    })
    return
  }
  throw new Error('Could not push after 4 attempts; the branch keeps moving')
})

// --- history ---

async function eventsAt(commitSha: string): Promise<Ev[]> {
  const gh = getApi()
  const c = await gh.commit(commitSha)
  const entries = await gh.tree(c.tree.sha)
  const cache = new Map((await db.files.toArray()).map((f) => [f.sha, f.text]))
  const lists = await Promise.all(
    entries.filter((e) => e.path.endsWith('.jsonl')).map(async (e) => parseLines(cache.get(e.sha) ?? (await gh.blobText(e.sha)))),
  )
  return merge(...lists)
}

export const previewAt = async (commitSha: string) => replay(await eventsAt(commitSha))

/** Restore = new commit carrying the old tree (safe). Force = move main back, discarding later commits. */
export const restore = (commitSha: string, force = false) => locked(async () => {
  const gh = getApi()
  const head = await gh.headSha()
  const old = await gh.commit(commitSha)
  const entries = await gh.tree(old.tree.sha)
  const metaEntry = entries.find((e) => e.path === 'meta.json')
  const meta = metaEntry ? JSON.parse(await gh.blobText(metaEntry.sha)) : {}
  const epoch = Math.max(await getKv('epoch', 0), meta.epoch ?? 0) + 1
  const tree = await gh.createTree(old.tree.sha, [{ path: 'meta.json', content: JSON.stringify({ ...meta, epoch }, null, 2) + '\n' }])
  const msg = `[${await device()}] ${force ? 'force reset' : 'restore'} to ${commitSha.slice(0, 7)}`
  const commit = await gh.createCommit(msg, tree, force ? [commitSha] : [head!])
  await gh.moveRef(commit, force)
  await dropCache()
  await setKv('epoch', epoch)
  await pullInner()
})

/** Repo paths of attachments no live card references. */
export function orphans(state: State): { path: string; name: string; size: number }[] {
  const out = []
  for (const c of Object.values(state.cards))
    for (const a of Object.values(c.attachments))
      if (a.removed || c.deleted) out.push({ path: a.path, name: a.name, size: a.size })
  return out
}

export const purge = (paths: string[]) => locked(async () => {
  const gh = getApi()
  await pullInner()
  const head = (await getKv<string>('headSha', ''))!
  const treeSha = await getKv('treeSha', '')
  const present = new Set((await gh.tree(treeSha)).map((e) => e.path))
  paths = paths.filter((p) => present.has(p))
  if (!paths.length) return
  const tree = await gh.createTree(treeSha, paths.map((path) => ({ path, sha: null })))
  const commit = await gh.createCommit(`[${await device()}] purge ${paths.length} attachment(s)`, tree, [head])
  await gh.moveRef(commit)
  await setKv('headSha', null) // re-read tree on next pull
})
