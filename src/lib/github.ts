export const DATA_REPO = 'zenith4eva/mountain-of-tasks-data'
export const BRANCH = 'main'

export class AuthError extends Error {}
export class ConflictError extends Error {}

export interface TreeEntry { path: string; mode: string; type: 'blob' | 'tree'; sha: string; size?: number }
export interface NewEntry { path: string; mode?: string; type?: 'blob'; content?: string; sha?: string | null }

export function client(token: string, repo = DATA_REPO) {
  async function gh(path: string, init: RequestInit & { raw?: boolean } = {}) {
    const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: init.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
    if (r.status === 401) throw new AuthError('Token rejected')
    if (r.status === 409 && path.startsWith('/git/ref/')) return null // empty repo
    if (r.status === 404) return null
    if (r.status === 422 && init.method === 'PATCH') throw new ConflictError('Branch moved')
    if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`)
    return init.raw ? r : r.json()
  }
  const post = (path: string, body: unknown) => gh(path, { method: 'POST', body: JSON.stringify(body) })

  return {
    async headSha(): Promise<string | null> {
      return (await gh(`/git/ref/heads/${BRANCH}`))?.object.sha ?? null
    },
    async commit(sha: string) {
      return gh(`/git/commits/${sha}`) as Promise<{ sha: string; tree: { sha: string }; message: string }>
    },
    async tree(treeSha: string): Promise<TreeEntry[]> {
      return (await gh(`/git/trees/${treeSha}?recursive=1`))?.tree ?? []
    },
    async blobText(sha: string): Promise<string> {
      const r: Response = await gh(`/git/blobs/${sha}`, { raw: true })
      return r.text()
    },
    async blobBytes(sha: string): Promise<Blob> {
      const r: Response = await gh(`/git/blobs/${sha}`, { raw: true })
      return r.blob()
    },
    async fileText(path: string, ref = BRANCH): Promise<string | null> {
      const r: Response | null = await gh(`/contents/${encodeURI(path)}?ref=${ref}`, { raw: true })
      return r ? r.text() : null
    },
    async createBlob(base64: string): Promise<string> {
      return (await post('/git/blobs', { content: base64, encoding: 'base64' })).sha
    },
    async createTree(base: string | null, entries: NewEntry[]): Promise<string> {
      const tree = entries.map((e) => ({ mode: '100644', type: 'blob', ...e }))
      return (await post('/git/trees', base ? { base_tree: base, tree } : { tree })).sha
    },
    async createCommit(message: string, tree: string, parents: string[]): Promise<string> {
      return (await post('/git/commits', { message, tree, parents })).sha
    },
    async moveRef(sha: string, force = false) {
      return gh(`/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha, force }) })
    },
    /** First commit into an empty repo (the git data API refuses to work on empty repos). */
    async init(meta: string) {
      return gh('/contents/meta.json', {
        method: 'PUT',
        body: JSON.stringify({ message: 'init', content: btoa(meta), branch: BRANCH }),
      })
    },
    async commits(page = 1) {
      return ((await gh(`/commits?sha=${BRANCH}&per_page=30&page=${page}`)) ?? []) as {
        sha: string
        commit: { message: string; author: { date: string } }
      }[]
    },
    async commitStats(sha: string) {
      const c = await gh(`/commits/${sha}`)
      let add = 0, del = 0
      for (const f of c?.files ?? []) if (f.filename.endsWith('.jsonl')) { add += f.additions; del += f.deletions }
      return { add, del }
    },
  }
}

export type Client = ReturnType<typeof client>
