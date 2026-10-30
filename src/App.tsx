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
// Eager: a lazy chunk drops the keys typed right after Ctrl+K while it loads.
import { Palette, type Command } from './components/Palette'
import { Setup, Unlock } from './components/Lock'
import { Icon, LabelPill, Mark, MenuItem, Popover } from './components/ui'
import { ago, t, tn } from './i18n'
import { useLang } from './components/LangGate'

type View = 'board' | 'journal' | 'activity' | 'settings'

// Secondary views load on first use; the board renders without them.
const CardModal = lazy(() => import('./components/CardModal').then((m) => ({ default: m.CardModal })))
const Journal = lazy(() => import('./components/Journal').then((m) => ({ default: m.Journal })))
const Activity = lazy(() => import('./components/Activity').then((m) => ({ default: m.Activity })))
const Settings = lazy(() => import('./components/Settings').then((m) => ({ default: m.Settings })))

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
  useLang() // re-render the tree when the language changes
  const sealed = useLiveQuery(() => getKv<Sealed | null>('sealed', null), [], undefined)
  const bio = useKv<BioSealed | null>('bio', null)
  const offline = useLiveQuery(() => getKv('offline', false), [], undefined)
  const [token, setTok] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [replacing, setReplacing] = useState(false)

  const unlock = useCallback((t: string | null) => { setToken(t); setTok(t); setReplacing(false); setNotice('') }, [])
  const authFailed = useCallback(() => { unlock(null); setNotice(t('tokenRejected')); setReplacing(true) }, [unlock])

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
    setError(navigator.onLine ? (e as Error).message : t('offline'))
  }, [onAuthFail])

  useQuery({
    queryKey: ['pull', token],
    queryFn: async () => {
      // In auto mode a push that failed (offline, 5xx) is retried here; push pulls first anyway.
      const pending = mode === 'auto' && (await db.events.where('synced').equals(0).count()) + (await db.blobs.count()) > 0
      try { await (pending ? push() : pull()); setError('') } catch (e) { handle(e) }
      return Date.now()
    },
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
  const lang = useLang()
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
    const name = prompt(t('boardNamePrompt'), boards.length ? t('newBoard') : t('myBoard'))?.trim()
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
    { id: 'new-board', label: t('newBoard'), run: newBoard },
    { id: 'theme', label: t('cmdToggleTheme'), run: async () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
      await setKv('theme', next); localStorage.setItem('theme', next)
    } },
    { id: 'journal', label: t('cmdJournal'), run: () => setView('journal') },
    { id: 'activity', label: t('cmdActivity'), run: () => setView('activity') },
    { id: 'settings', label: t('cmdSettings'), run: () => setView('settings') },
    ...(token ? [{ id: 'sync', label: t('cmdSync'), run: () => sync.commit() }] : []),
    ...(token ? [{ id: 'lock', label: t('cmdLock'), run: onLock }] : []),
    ...(board ? [{ id: 'new-card', label: t('cmdNewCard', { board: board.name }), run: () => {
      setView('board')
      setTimeout(() => document.querySelector<HTMLButtonElement>('section[aria-label] button.btn-ghost.m-1')?.click(), 0)
    } }] : []),
  ], [board, token, sync.commit, lang]) // eslint-disable-line react-hooks/exhaustive-deps

  const nav: [View, string, string][] = [['board', 'board', t('navBoards')], ['journal', 'journal', t('navJournal')], ['activity', 'activity', t('navActivity')], ['settings', 'settings', t('navSettings')]]

  return (
    <div className="flex h-full flex-col sm:flex-row">
      <nav aria-label={t('mainNav')} className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-line py-3 sm:flex">
        <div className="mb-4"><Mark /></div>
        {nav.map(([v, icon, label]) => (
          <button key={v} onClick={() => setView(v)} aria-label={label} title={label} aria-current={view === v}
            className={`flex size-10 items-center justify-center rounded-[8px] ${view === v ? 'bg-raised text-ink' : 'text-muted hover:bg-raised hover:text-ink'}`}>
            <Icon name={icon} size={18} />
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={() => setPalette(true)} aria-label={t('searchShortcut')} title={t('searchShortcut')} className="flex size-10 items-center justify-center rounded-[8px] text-muted hover:bg-raised hover:text-ink">
          <Icon name="search" size={18} />
        </button>
      </nav>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-3 sm:px-6">
          <div className="sm:hidden"><Mark size={26} /></div>
          {view === 'board' && (
            <Popover button={(toggle) => (
              <button onClick={toggle} className="flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-[20px] font-semibold hover:bg-raised">
                <h1>{board?.name ?? t('noBoard')}</h1><Icon name="down" size={16} className="text-muted" />
              </button>
            )}>
              {(close) => (
                <>
                  {boards.map((b) => <MenuItem key={b.id} onClick={() => { close(); openBoard(b.id) }}>{b.name}</MenuItem>)}
                  <MenuItem onClick={() => { close(); newBoard() }}><Icon name="plus" size={14} /> {t('newBoard')}</MenuItem>
                </>
              )}
            </Popover>
          )}
          <div className="flex-1" />
          <SyncStatus token={token} sync={sync} />
          <button onClick={() => setPalette(true)} className="btn btn-quiet h-8 sm:hidden" aria-label={t('search')}><Icon name="search" /></button>
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

        <nav aria-label={t('mainNav')} className="grid grid-cols-4 border-t border-line bg-ground pb-[env(safe-area-inset-bottom)] sm:hidden">
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

  if (!token) return <span className="text-xs text-muted">{t('localOnly')}</span>
  const n = pending + pendingBlobs
  const text = sync.busy ? t('syncing') : !sync.online ? (n ? `${t('offline')} · ${t('pendingN', { n })}` : t('offline')) : sync.error ? sync.error : n && sync.mode === 'auto' ? t('pendingN', { n }) : lastSync ? t('syncedAgo', { ago: ago(lastSync) }) : t('notSynced')

  if (sync.mode === 'manual' && n) {
    return (
      <Popover align="right" button={(toggle) => (
        <button className="btn btn-primary h-8" onClick={async () => { setMsg(await pendingMessage()); toggle() }}>
          {t('commit')} <span className="rounded-full bg-on-accent/20 px-1.5 text-xs">{n}</span>
        </button>
      )}>
        {(close) => (
          <form className="w-80 p-2" onSubmit={(e) => { e.preventDefault(); close(); sync.commit(msg) }}>
            <label className="mb-1 block text-xs font-medium text-muted" htmlFor="commit-msg">{t('commitMessage')}</label>
            <textarea id="commit-msg" rows={3} className="field" value={msg} onChange={(e) => setMsg(e.target.value)} />
            <button className="btn btn-primary mt-2 w-full justify-center" disabled={sync.busy}>{tn('commitN', n)}</button>
          </form>
        )}
      </Popover>
    )
  }
  return (
    <button onClick={() => sync.commit()} title={t('cmdSync')} className={`inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-xs hover:bg-raised ${sync.error && sync.online ? 'text-negative' : 'text-muted'}`}>
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
          <button key={l.id} aria-pressed={on} className={`shrink-0 rounded-full ${on ? 'ring-2 ring-ink ring-offset-1 ring-offset-ground' : 'opacity-80 hover:opacity-100'}`}
            onClick={() => setFilter({ ...filter, labels: on ? filter.labels.filter((x) => x !== l.id) : [...filter.labels, l.id] })}>
            <LabelPill label={l} small />
          </button>
        )
      })}
      <select className="field h-7 w-auto shrink-0 text-xs" value={filter.due} aria-label={t('dueFilter')} onChange={(e) => setFilter({ ...filter, due: e.target.value as Filter['due'] })}>
        <option value="any">{t('anyDue')}</option><option value="overdue">{t('overdue')}</option><option value="week">{t('dueWeek')}</option><option value="none">{t('noDue')}</option>
      </select>
      <select className="field h-7 w-auto shrink-0 text-xs" value={filter.priority} aria-label={t('priorityFilter')} onChange={(e) => setFilter({ ...filter, priority: e.target.value as Filter['priority'] })}>
        <option value="any">{t('anyPriority')}</option><option value="high">{t('high')}</option><option value="med">{t('medium')}</option><option value="low">{t('low')}</option><option value="none">{t('noPriority')}</option>
      </select>
      {active ? <button className="shrink-0 text-xs text-muted underline" onClick={() => setFilter(noFilter)}>{t('clear')}</button> : null}
    </div>
  )
}

function Empty({ onCreate, syncing }: { onCreate: () => void; syncing: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <Mark size={48} />
      <h2 className="text-[20px] font-semibold">{syncing ? t('fetchingBoards') : t('emptyTitle')}</h2>
      <p className="max-w-sm text-muted">{t('emptyBody')}</p>
      <button className="btn btn-primary" onClick={onCreate}><Icon name="plus" /> {t('createBoard')}</button>
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
    <div className="fixed inset-0 z-40 flex flex-col bg-ground" role="dialog" aria-label={t('readOnlyPreview')}>
      <header className="flex flex-wrap items-center gap-3 bg-accent px-4 py-2 text-on-accent sm:px-6">
        <span className="font-semibold">{t('readOnly')}</span>
        <span className="min-w-0 flex-1 truncate opacity-80">{title}</span>
        <select className="field h-8 w-auto" value={id} onChange={(e) => setId(e.target.value)} aria-label={t('board')}>
          {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button className="btn h-8 bg-on-accent/15" onClick={onClose}>{t('close')}</button>
      </header>
      <div className="min-h-0 flex-1 pt-3">
        {id ? <BoardView state={state} boardId={id} readOnly onOpen={setCard} /> : <p className="p-6 text-muted">{t('noBoardsAtPoint')}</p>}
      </div>
      {card && <Suspense fallback={null}><CardModal state={state} events={[]} cardId={card} readOnly onClose={() => setCard(null)} /></Suspense>}
    </div>
  )
}

