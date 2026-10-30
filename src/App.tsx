import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getKv, listeners, setKv, useAppState, useKv, usePendingCount } from './lib/db'
import { AuthError } from './lib/github'
import { pendingMessage, pull, push, setToken } from './lib/sync'
import { createBoard } from './lib/actions'
import type { BioSealed, Sealed } from './lib/crypto'
import type { State } from './lib/model'
import { BoardView, noFilter, type Filter } from './components/Board'
import type { Command } from './components/Palette'
import { Setup, Unlock } from './components/Lock'
import { Icon, LabelPill, Mark, MenuItem, Popover, ago } from './components/ui'

type View = 'board' | 'journal' | 'activity' | 'settings'

// Secondary views load on first use; the board renders without them.
const CardModal = lazy(() => import('./components/CardModal').then((m) => ({ default: m.CardModal })))
const Journal = lazy(() => import('./components/Journal').then((m) => ({ default: m.Journal })))
const Activity = lazy(() => import('./components/Activity').then((m) => ({ default: m.Activity })))
const Settings = lazy(() => import('./components/Settings').then((m) => ({ default: m.Settings })))
const Palette = lazy(() => import('./components/Palette').then((m) => ({ default: m.Palette })))

function useTheme() {
  const theme = useKv<'system' | 'light' | 'dark'>('theme', (localStorage.getItem('theme') as any) ?? 'system')
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#121211' : '#f4f3f1')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
  return theme
}

export default function App() {
  useTheme()
  const sealed = useLiveQuery(() => getKv<Sealed | null>('sealed', null), [], undefined)
  const bio = useKv<BioSealed | null>('bio', null)
  const offline = useLiveQuery(() => getKv('offline', false), [], undefined)
  const [token, setTok] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [replacing, setReplacing] = useState(false)

  const unlock = useCallback((t: string | null) => { setToken(t); setTok(t); setReplacing(false); setNotice('') }, [])
  const authFailed = useCallback(() => { unlock(null); setNotice('GitHub rejected the token. Paste a new one.'); setReplacing(true) }, [unlock])

  if (sealed === undefined || offline === undefined) return null
  if (replacing || (!sealed && !offline)) return <Setup onDone={unlock} notice={notice} allowOffline={!replacing} />
  if (sealed && !token) return <Unlock sealed={sealed} bio={bio} onDone={unlock} />
  return <Shell token={token} onLock={() => unlock(null)} onReplaceToken={() => setReplacing(true)} onAuthFail={authFailed} />
}

function useSync(token: string | null, onAuthFail: () => void) {
  const mode = useKv<'auto' | 'manual'>('syncMode', 'auto')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [online, setOnline] = useState(navigator.onLine)

  const handle = useCallback((e: unknown) => {
    if (e instanceof AuthError) return onAuthFail()
    setError(navigator.onLine ? (e as Error).message : 'Offline')
  }, [onAuthFail])

  useQuery({
    queryKey: ['pull', token],
    queryFn: async () => { try { await pull(); setError('') } catch (e) { handle(e) } return Date.now() },
    enabled: !!token && online,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })

  const commit = useCallback(async (message?: string) => {
    if (!token) return
    setBusy(true)
    try { await push(message); setError('') } catch (e) { handle(e) } finally { setBusy(false) }
  }, [token, handle])

  const timer = useRef<number>(0)
  useEffect(() => {
    const auto = () => {
      clearTimeout(timer.current)
      if (token && mode === 'auto') timer.current = window.setTimeout(() => commit(), 3000)
    }
    listeners.onEmit = auto
    auto() // flush anything left from a previous session
    const on = () => { setOnline(true); auto() }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { listeners.onEmit = () => {}; window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [token, mode, commit])

  return { mode, busy, error, online, commit }
}

function Shell({ token, onLock, onReplaceToken, onAuthFail }: { token: string | null; onLock: () => void; onReplaceToken: () => void; onAuthFail: () => void }) {
  const { state, events } = useAppState()
  const sync = useSync(token, onAuthFail)
  const [view, setView] = useState<View>('board')
  const [boardId, setBoardId] = useState<string | null>(() => localStorage.getItem('board'))
  const [cardId, setCardId] = useState<string | null>(null)
  const [palette, setPalette] = useState(false)
  const [filter, setFilter] = useState<Filter>(noFilter)
  const [preview, setPreview] = useState<{ title: string; state: State; boardId?: string } | null>(null)

  const boards = Object.values(state.boards).filter((b) => !b.deleted).sort((a, b) => a.createdAt - b.createdAt)
  const board = (boardId && state.boards[boardId] && !state.boards[boardId].deleted) ? state.boards[boardId] : boards[0]

  const openBoard = useCallback((id: string) => { setBoardId(id); localStorage.setItem('board', id); setView('board'); setFilter(noFilter) }, [])
  const newBoard = async () => {
    const name = prompt('Board name', boards.length ? 'New board' : 'My board')?.trim()
    if (name) openBoard(await createBoard(name))
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  const commands: Command[] = useMemo(() => [
    { id: 'new-board', label: 'New board', run: newBoard },
    { id: 'theme', label: 'Toggle theme', run: async () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
      await setKv('theme', next); localStorage.setItem('theme', next)
    } },
    { id: 'journal', label: 'Open journal', run: () => setView('journal') },
    { id: 'activity', label: 'Open activity', run: () => setView('activity') },
    { id: 'settings', label: 'Open settings', run: () => setView('settings') },
    ...(token ? [{ id: 'sync', label: 'Sync now', run: () => sync.commit() }] : []),
    ...(token ? [{ id: 'lock', label: 'Lock', run: onLock }] : []),
    ...(board ? [{ id: 'new-card', label: `New card in ${board.name}`, run: () => {
      setView('board')
      setTimeout(() => document.querySelector<HTMLButtonElement>('section[aria-label] button.btn-ghost.m-1')?.click(), 0)
    } }] : []),
  ], [board, token, sync.commit]) // eslint-disable-line react-hooks/exhaustive-deps

  const nav: [View, string, string][] = [['board', 'board', 'Boards'], ['journal', 'journal', 'Journal'], ['activity', 'activity', 'Activity'], ['settings', 'settings', 'Settings']]

  return (
    <div className="flex h-full flex-col sm:flex-row">
      <nav aria-label="Main" className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-line py-3 sm:flex">
        <div className="mb-4"><Mark /></div>
        {nav.map(([v, icon, label]) => (
          <button key={v} onClick={() => setView(v)} aria-label={label} title={label} aria-current={view === v}
            className={`flex size-10 items-center justify-center rounded-[8px] ${view === v ? 'bg-raised text-ink' : 'text-muted hover:bg-raised hover:text-ink'}`}>
            <Icon name={icon} size={18} />
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={() => setPalette(true)} aria-label="Search (Ctrl+K)" title="Search (Ctrl+K)" className="flex size-10 items-center justify-center rounded-[8px] text-muted hover:bg-raised hover:text-ink">
          <Icon name="search" size={18} />
        </button>
      </nav>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-3 sm:px-6">
          <div className="sm:hidden"><Mark size={26} /></div>
          {view === 'board' && (
            <Popover button={(t) => (
              <button onClick={t} className="flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-[20px] font-semibold hover:bg-raised">
                <h1>{board?.name ?? 'No board'}</h1><Icon name="down" size={16} className="text-muted" />
              </button>
            )}>
              {(close) => (
                <>
                  {boards.map((b) => <MenuItem key={b.id} onClick={() => { close(); openBoard(b.id) }}>{b.name}</MenuItem>)}
                  <MenuItem onClick={() => { close(); newBoard() }}><Icon name="plus" size={14} /> New board</MenuItem>
                </>
              )}
            </Popover>
          )}
          <div className="flex-1" />
          <SyncStatus token={token} sync={sync} />
          <button onClick={() => setPalette(true)} className="btn btn-quiet h-8 sm:hidden" aria-label="Search"><Icon name="search" /></button>
        </header>
        {view === 'board' && board && <FilterBar state={state} filter={filter} setFilter={setFilter} />}

        <div className={`min-h-0 flex-1 ${view === 'board' ? '' : 'overflow-y-auto'}`}>
          <Suspense fallback={null}>
          {view === 'board' && (board
            ? <BoardView state={state} boardId={board.id} filter={filter} onOpen={setCardId} />
            : <Empty onCreate={newBoard} syncing={!!token && !events.length} />)}
          {view === 'journal' && <Journal state={state} events={events} onOpen={setCardId} onPreview={(title, s, b) => setPreview({ title, state: s, boardId: b })} />}
          {view === 'activity' && <Activity state={state} onOpen={setCardId} />}
          {view === 'settings' && <Settings state={state} token={token} onLock={onLock} onReplaceToken={onReplaceToken} onPreview={(title, s) => setPreview({ title, state: s })} />}
          </Suspense>
        </div>

        <nav aria-label="Main" className="grid grid-cols-4 border-t border-line bg-ground pb-[env(safe-area-inset-bottom)] sm:hidden">
          {nav.map(([v, icon, label]) => (
            <button key={v} onClick={() => setView(v)} aria-current={view === v}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${view === v ? 'text-ink' : 'text-muted'}`}>
              <Icon name={icon} size={20} />{label}
            </button>
          ))}
        </nav>
      </main>

      <Suspense fallback={null}>
      {cardId && state.cards[cardId] && <CardModal state={state} events={events} cardId={cardId} onClose={() => setCardId(null)} />}
      {palette && <Palette state={state} commands={commands} onBoard={openBoard} onCard={setCardId} onClose={() => setPalette(false)} />}
      {preview && <Preview {...preview} onClose={() => setPreview(null)} />}
      </Suspense>
    </div>
  )
}

function SyncStatus({ token, sync }: { token: string | null; sync: ReturnType<typeof useSync> }) {
  const pending = usePendingCount()
  const pendingBlobs = useLiveQuery(() => db.blobs.count(), [], 0)
  const lastSync = useKv<number | null>('lastSync', null)
  const [msg, setMsg] = useState('')
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t) }, [])

  if (!token) return <span className="text-xs text-muted">Local only</span>
  const n = pending + pendingBlobs
  const text = sync.busy ? 'Syncing…' : !sync.online ? `Offline${n ? ` · ${n} pending` : ''}` : sync.error ? sync.error : n && sync.mode === 'auto' ? `${n} pending` : lastSync ? `Synced ${ago(lastSync)}` : 'Not synced yet'

  if (sync.mode === 'manual' && n) {
    return (
      <Popover align="right" button={(t) => (
        <button className="btn btn-primary h-8" onClick={async () => { setMsg(await pendingMessage()); t() }}>
          Commit <span className="rounded-full bg-on-accent/20 px-1.5 text-xs">{n}</span>
        </button>
      )}>
        {(close) => (
          <form className="w-80 p-2" onSubmit={(e) => { e.preventDefault(); close(); sync.commit(msg) }}>
            <label className="mb-1 block text-xs font-medium text-muted" htmlFor="commit-msg">Commit message</label>
            <textarea id="commit-msg" rows={3} className="field" value={msg} onChange={(e) => setMsg(e.target.value)} />
            <button className="btn btn-primary mt-2 w-full justify-center" disabled={sync.busy}>Commit {n} change{n > 1 ? 's' : ''}</button>
          </form>
        )}
      </Popover>
    )
  }
  return (
    <button onClick={() => sync.commit()} title="Sync now" className={`inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-xs hover:bg-raised ${sync.error && sync.online ? 'text-negative' : 'text-muted'}`}>
      <Icon name="cloud" size={14} />{text}
    </button>
  )
}

function FilterBar({ state, filter, setFilter }: { state: State; filter: Filter; setFilter: (f: Filter) => void }) {
  const labels = Object.values(state.labels).filter((l) => !l.deleted)
  const active = filter.labels.length || filter.due !== 'any' || filter.priority !== 'any'
  return (
    <div className="no-scrollbar flex items-center gap-2 overflow-x-auto px-4 pb-3 sm:px-6">
      <Icon name="filter" size={14} className="shrink-0 text-muted" />
      {labels.map((l) => {
        const on = filter.labels.includes(l.id)
        return (
          <button key={l.id} aria-pressed={on} className={`shrink-0 ${on ? '' : 'opacity-50 hover:opacity-90'}`}
            onClick={() => setFilter({ ...filter, labels: on ? filter.labels.filter((x) => x !== l.id) : [...filter.labels, l.id] })}>
            <LabelPill label={l} small />
          </button>
        )
      })}
      <select className="field h-7 w-auto shrink-0 text-xs" value={filter.due} aria-label="Due filter" onChange={(e) => setFilter({ ...filter, due: e.target.value as Filter['due'] })}>
        <option value="any">Any due date</option><option value="overdue">Overdue</option><option value="week">Due within a week</option><option value="none">No due date</option>
      </select>
      <select className="field h-7 w-auto shrink-0 text-xs" value={filter.priority} aria-label="Priority filter" onChange={(e) => setFilter({ ...filter, priority: e.target.value as Filter['priority'] })}>
        <option value="any">Any priority</option><option value="high">High</option><option value="med">Medium</option><option value="low">Low</option><option value="none">No priority</option>
      </select>
      {active ? <button className="shrink-0 text-xs text-muted underline" onClick={() => setFilter(noFilter)}>Clear</button> : null}
    </div>
  )
}

function Empty({ onCreate, syncing }: { onCreate: () => void; syncing: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <Mark size={48} />
      <h2 className="text-[20px] font-semibold">{syncing ? 'Fetching your boards…' : 'The mountain is empty'}</h2>
      <p className="max-w-sm text-muted">Boards hold columns, columns hold cards. Start with one; To do, Doing and Done are set up for you.</p>
      <button className="btn btn-primary" onClick={onCreate}><Icon name="plus" /> Create a board</button>
    </div>
  )
}

function Preview({ title, state, boardId, onClose }: { title: string; state: State; boardId?: string; onClose: () => void }) {
  const boards = Object.values(state.boards).filter((b) => !b.deleted)
  const [id, setId] = useState(boardId && state.boards[boardId] ? boardId : boards[0]?.id)
  const [card, setCard] = useState<string | null>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !card && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [card, onClose])
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-ground" role="dialog" aria-label="Read-only preview">
      <header className="flex flex-wrap items-center gap-3 bg-accent px-4 py-2 text-on-accent sm:px-6">
        <span className="font-semibold">Read-only</span>
        <span className="min-w-0 flex-1 truncate opacity-80">{title}</span>
        <select className="field h-8 w-auto" value={id} onChange={(e) => setId(e.target.value)} aria-label="Board">
          {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button className="btn h-8 bg-on-accent/15" onClick={onClose}>Close</button>
      </header>
      <div className="min-h-0 flex-1 pt-3">
        {id ? <BoardView state={state} boardId={id} readOnly onOpen={setCard} /> : <p className="p-6 text-muted">No boards at this point.</p>}
      </div>
      {card && <Suspense fallback={null}><CardModal state={state} events={[]} cardId={card} readOnly onClose={() => setCard(null)} /></Suspense>}
    </div>
  )
}

