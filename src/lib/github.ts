/** Devices set up before the data repo became configurable synced here. */
export const LEGACY_REPO = 'zenith4eva/mountain-of-tasks-data'
export const DEFAULT_REPO_NAME = 'mountain-of-tasks-data'

// The signed-in person's data repo ("owner/name"); set from kv before sync starts.
let repo = LEGACY_REPO
export const dataRepo = () => repo
export const setDataRepo = (r: string) => { repo = r }

/** github.com links that pre-fill the two forms a new person has to submit. */
export const newRepoUrl = (name = DEFAULT_REPO_NAME) =>
  `https://github.com/new?name=${encodeURIComponent(name)}&visibility=private&description=${encodeURIComponent('Mountain of Tasks data')}`
// Repository selection cannot be pre-filled (GitHub docs); everything else can.
export const newTokenUrl = () =>
  'https://github.com/settings/personal-access-tokens/new?name=Mountain%20of%20Tasks&description=' +
  encodeURIComponent('Sync for Mountain of Tasks') + '&expires_in=366&contents=write'

export type TokenCheck =
  | { repo: string }
  | { error: 'reach' | 'rejected' | 'noRepos' }
  | { error: 'status'; status: number }
  | { error: 'notFound'; repos: string[] }
  | { error: 'confirm'; repo: string } // the token sees exactly one repo, under another name

/**
 * Works out the data repo from what the token can see, so people need not type owner/name.
 * Prefers a repo called `preferred`; a token limited to one other repo needs a confirmation.
 */
export async function findRepo(token: string, preferred = DEFAULT_REPO_NAME): Promise<TokenCheck> {
  const r = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  }).catch(() => null)
  if (!r) return { error: 'reach' }
  if (r.status === 401) return { error: 'rejected' }
  if (!r.ok) return { error: 'status', status: r.status }
  const repos = (await r.json()) as { full_name: string; name: string }[]
  if (!repos.length) return { error: 'noRepos' }
  const want = preferred.toLowerCase()
  const hit = repos.find((x) => x.full_name.toLowerCase() === want || x.name.toLowerCase() === want)
  if (hit) return { repo: hit.full_name }
  if (repos.length === 1) return { error: 'confirm', repo: repos[0].full_name }
  return { error: 'notFound', repos: repos.map((x) => x.full_name) }
}
export const BRANCH = 'main'

export class AuthError extends Error {}
export class ConflictError extends Error {}

export interface TreeEntry { path: string; mode: string; type: 'blob' | 'tree'; sha: string; size?: number }
export interface NewEntry { path: string; mode?: string; type?: 'blob'; content?: string; sha?: string | null }

export function client(token: string, repo = dataRepo()) {
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
  }
}

export type Client = ReturnType<typeof client>
