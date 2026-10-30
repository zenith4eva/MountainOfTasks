// Integration test against a real (throwaway) GitHub repo. Skipped unless both are set:
//   SYNC_TEST_REPO=owner/name GH_TOKEN=$(gh auth token) npx vitest run tests/sync.int.test.ts
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll } from 'vitest'
import { db, emit, getKv, setKv } from '../src/lib/db'
import { client, AuthError, ConflictError } from '../src/lib/github'
import { getApi, hooks, pull, push, restore, setToken } from '../src/lib/sync'
import { createBoard, addCard, attachFiles } from '../src/lib/actions'
import { eventPath, replay, type Ev } from '../src/lib/model'

const env = (globalThis as any).process?.env ?? {}
const repo = env.SYNC_TEST_REPO
const token = env.GH_TOKEN

const local = async () => replay(await db.events.toArray())
const freshDevice = async () => {
  await Promise.all([db.events.clear(), db.files.clear(), db.blobs.clear(), db.kv.clear()])
}

describe.skipIf(!repo || !token)('sync against GitHub', () => {
  const gh = client(token!, repo)
  const remoteText = async (path: string) => {
    return gh.fileText(path)
  }
  let boardId = ''
  let firstDataCommit = ''
  let epoch0 = 0 // the repo may hold earlier runs; assert epochs relative to it

  beforeAll(() => {
    setToken(token!, repo)
    hooks.onRollback = async () => {}
  })

  it('initialises the repo (if empty) and reads meta on first pull', async () => {
    await pull()
    epoch0 = JSON.parse((await remoteText('meta.json'))!).epoch
    expect(await getKv('epoch', -1)).toBe(epoch0)
    expect(await getKv('headSha', null)).toBeTruthy()
  })

  it('pushes events, snapshot and meta in one commit', async () => {
    boardId = await createBoard('Integration')
    const s = await local()
    const todo = Object.values(s.boards[boardId].columns).find((c) => c.name === 'To do')!
    await addCard(boardId, todo.id, 'Fix auth', 'a0')
    await push()
    expect(await db.events.where('synced').equals(0).count()).toBe(0)

    firstDataCommit = (await gh.headSha())!
    const c = await gh.commit(firstDataCommit)
    expect(c.message).toMatch(/^\[Browser\] (create board|create 1 board)/)

    const ev = (await db.events.toArray())[0]
    const lines = (await remoteText(eventPath(ev)))!.trim().split('\n')
    expect(lines).toHaveLength(5)
    const snap = JSON.parse((await remoteText(`boards/${boardId}.json`))!)
    expect(snap.cards.map((x: any) => x.title)).toEqual(['Fix auth'])
    expect(JSON.parse((await remoteText('meta.json'))!).boards[0].name).toBe('Integration')
  })

  it('merges a commit made by another device before pushing', async () => {
    const s = await local()
    const card = Object.values(s.cards)[0]
    const path = eventPath({ ts: Date.now(), payload: { boardId } } as Ev)
    // Device B appends a title edit directly to the remote log.
    const other: Ev = { id: 'from-b', ts: Date.now(), device: 'iPhone', type: 'card.update', payload: { boardId, cardId: card.id, fields: { title: 'Fix auth (B)' } } }
    const head = (await gh.headSha())!
    const base = (await remoteText(path)) ?? ''
    const tree = await gh.createTree((await gh.commit(head)).tree.sha, [{ path, content: base + JSON.stringify(other) + '\n' }])
    await gh.moveRef(await gh.createCommit('[iPhone] edit', tree, [head]))

    await emit('comment.add', { boardId, cardId: card.id, commentId: 'm1', text: 'from A' })
    await push()

    const after = await local()
    expect(after.cards[card.id].title).toBe('Fix auth (B)')
    expect(after.cards[card.id].comments[0].text).toBe('from A')
    const remote = (await remoteText(path))!.trim().split('\n').map((l) => JSON.parse(l).id)
    expect(remote).toContain('from-b')
    expect(remote).toHaveLength(7)
  })

  it('retries when the branch moves between pull and ref update', async () => {
    const api = getApi()
    const real = api.moveRef
    let raced = false
    api.moveRef = async (sha, force) => {
      if (!raced) {
        raced = true
        // Another device lands a commit right now.
        const head = (await gh.headSha())!
        const t = await gh.createTree((await gh.commit(head)).tree.sha, [{ path: 'race.txt', content: 'x\n' }])
        await gh.moveRef(await gh.createCommit('[iPhone] race', t, [head]))
        throw new ConflictError('Branch moved')
      }
      return real(sha, force)
    }
    const s = await local()
    await emit('card.update', { boardId, cardId: Object.values(s.cards)[0].id, fields: { priority: 'high' } })
    await push()
    api.moveRef = real
    expect(raced).toBe(true)
    expect(await remoteText('race.txt')).toBe('x\n')
    expect(await db.events.where('synced').equals(0).count()).toBe(0)
  })

  it('a fresh device rebuilds the same state from the repo', async () => {
    const before = await local()
    await freshDevice()
    await pull()
    const after = await local()
    expect(after).toEqual(before)
  })

  it('uploads attachments and reads them back', async () => {
    const s = await local()
    const card = Object.values(s.cards)[0]
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 255])
    await attachFiles(card, [new File([bytes], 'pixel.png', { type: 'image/png' })])
    await push()
    expect(await db.blobs.count()).toBe(0)
    const att = Object.values((await local()).cards[card.id].attachments)[0]
    const back = new Uint8Array(await (await gh.blobBytes(att.blob)).arrayBuffer())
    expect([...back]).toEqual([...bytes])
  })

  it('restore makes a new commit with the old tree and bumps the epoch', async () => {
    const headBefore = await gh.headSha()
    await emit('card.update', { boardId, cardId: 'nope', fields: {} }) // pending change is discarded by restore
    await restore(firstDataCommit)
    const s = await local()
    const card = Object.values(s.cards)[0]
    expect(card.title).toBe('Fix auth')
    expect(card.comments).toHaveLength(0)
    expect(await getKv('epoch', 0)).toBe(epoch0 + 1)
    const head = await gh.commit((await gh.headSha())!)
    expect(head.message).toMatch(/restore to/)
    expect(head.sha).not.toBe(headBefore)
    expect(await db.events.where('synced').equals(0).count()).toBe(0)
  })

  it('a device with a lower epoch drops its cache and pending queue', async () => {
    await setKv('epoch', epoch0) // pretend this device missed the rollback
    await setKv('headSha', 'stale')
    await db.files.delete('meta.json')
    await emit('card.update', { boardId, cardId: 'ghost', fields: { title: 'lost' } })
    let warned = -1
    hooks.onRollback = async (n) => { warned = n }
    await pull()
    expect(warned).toBe(1)
    expect(await db.events.where('synced').equals(0).count()).toBe(0)
    expect(await getKv('epoch', 0)).toBe(epoch0 + 1)
  })

  it('rejects a bad token with AuthError', async () => {
    await expect(client('github_pat_invalid', repo).headSha()).rejects.toBeInstanceOf(AuthError)
  })
})
