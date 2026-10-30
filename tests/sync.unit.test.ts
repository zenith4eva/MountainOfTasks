import 'fake-indexeddb/auto'
import { it, expect, vi } from 'vitest'
import { pull, setToken } from '../src/lib/sync'

it('pull gives up when the data repo answers 404 instead of re-initialising forever', async () => {
  const fetch = vi.fn(async () => new Response('{"message":"Not Found"}', { status: 404 }))
  vi.stubGlobal('fetch', fetch)
  setToken('t')
  await expect(pull()).rejects.toThrow(/mountain-of-tasks-data/)
  expect(fetch.mock.calls.length).toBeLessThan(5)
  vi.unstubAllGlobals()
})
