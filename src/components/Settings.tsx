import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { db, defaultDevice, setKv, useKv, usePendingCount } from '../lib/db'
import { DATA_REPO } from '../lib/github'
import { bioSupported, enrollBiometric } from '../lib/crypto'
import { getApi, orphans, previewAt, purge, restore } from '../lib/sync'
import { deleteBoard, renameBoard, updateColumn, updateLabel } from '../lib/actions'
import type { State } from '../lib/model'
import { LABEL_COLORS, LabelPill, ago, fmtSize, fmtTime } from './ui'

function Section({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-b border-line py-8 last:border-0 md:grid-cols-[300px_1fr] md:gap-10">
      <div>
        <h2 className="text-[16px] font-medium">{title}</h2>
        <p className="mt-1 text-muted">{help}</p>
      </div>
      <div className="min-w-0 space-y-4 rounded-[12px] bg-surface p-4">{children}</div>
    </section>
  )
}

function Row({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        {help && <div className="text-[13px] text-muted">{help}</div>}
      </div>
      {children}
    </div>
  )
}

export function Settings({ state, token, onPreview, onLock, onReplaceToken }: {
  state: State; token: string | null
  onPreview: (title: string, s: State) => void; onLock: () => void; onReplaceToken: () => void
}) {
  const device = useKv('device', defaultDevice())
  const mode = useKv<'auto' | 'manual'>('syncMode', 'auto')
  const theme = useKv<'system' | 'light' | 'dark'>('theme', 'system')
  const bio = useKv('bio', null)
  const bioOk = useQuery({ queryKey: ['bioSupported'], queryFn: bioSupported })
  const [bioErr, setBioErr] = useState('')
  const boards = Object.values(state.boards)

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <h1 className="pt-2 text-[24px] font-semibold">Settings</h1>

      <Section title="This device" help="The name tags every change and commit made here.">
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium">Device name</span>
          <input className="field" defaultValue={device} key={device} onBlur={(e) => setKv('device', e.target.value.trim() || defaultDevice())} />
        </label>
      </Section>

      <Section title="Sync" help={`Changes are committed to ${DATA_REPO}. Auto commits three seconds after you stop; manual waits for the Commit button.`}>
        <Row title="Commit automatically" help={mode === 'auto' ? 'On' : 'Off: a badge counts pending changes'}>
          <Toggle on={mode === 'auto'} label="Commit automatically" onChange={(v) => setKv('syncMode', v ? 'auto' : 'manual')} />
        </Row>
      </Section>

      <Section title="Appearance" help="Follows the system unless you pick a side.">
        <div className="flex gap-1">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button key={t} onClick={() => { setKv('theme', t); localStorage.setItem('theme', t) }}
              className={`btn ${theme === t ? 'btn-primary' : 'btn-quiet'}`}>{t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
      </Section>

      <Section title="Security" help="The token is encrypted with your PIN (PBKDF2, 600,000 rounds, AES-GCM). A passkey with Face ID or Windows Hello can unlock it instead.">
        <Row title="Token" help={token ? 'Unlocked for this session' : 'Not connected: this device works offline only'}>
          <div className="flex gap-1">
            {token && <button className="btn btn-quiet" onClick={onLock}>Lock now</button>}
            <button className="btn btn-quiet" onClick={onReplaceToken}>{token ? 'Replace token' : 'Connect token'}</button>
          </div>
        </Row>
        <Row title="Biometric unlock" help={bio ? 'Enrolled on this device' : bioOk.data === false ? 'No platform authenticator on this device' : 'Passkey with the PRF extension'}>
          {bio ? (
            <button className="btn btn-quiet" onClick={() => db.kv.delete('bio')}>Remove</button>
          ) : (
            <button className="btn btn-quiet" disabled={!token || bioOk.data === false} onClick={async () => {
              setBioErr('')
              try { await setKv('bio', await enrollBiometric(token!)) } catch (e) { setBioErr((e as Error).message) }
            }}>Enroll</button>
          )}
        </Row>
        {bioErr && <p className="text-negative" role="alert">{bioErr}</p>}
      </Section>

      <Section title="Labels" help="Labels are shared by every board.">
        {Object.values(state.labels).filter((l) => !l.deleted).map((l) => (
          <div key={l.id} className="flex items-center gap-2">
            <LabelPill label={l} />
            <input className="field h-8 flex-1" defaultValue={l.name} aria-label={`Rename ${l.name}`}
              onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && updateLabel(l.id, { name: e.target.value.trim() })} />
            <div className="flex gap-0.5">
              {LABEL_COLORS.map((c) => (
                <button key={c} aria-label="Colour" onClick={() => updateLabel(l.id, { color: c })}
                  className={`size-5 rounded-full ${l.color === c ? 'ring-2 ring-ink' : ''}`} style={{ background: c }} />
              ))}
            </div>
            <button className="btn btn-ghost h-8 text-negative" onClick={() => updateLabel(l.id, { deleted: true })}>Delete</button>
          </div>
        ))}
        {!Object.values(state.labels).some((l) => !l.deleted) && <p className="text-muted">Create labels from a card.</p>}
      </Section>

      <Section title="Boards" help="Deleted boards and archived columns stay in history and can be brought back.">
        {boards.map((b) => (
          <div key={b.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <input className="field h-8 flex-1" defaultValue={b.name} disabled={b.deleted} aria-label={`Rename ${b.name}`}
                onBlur={(e) => e.target.value.trim() && e.target.value !== b.name && renameBoard(b.id, e.target.value.trim())} />
              <button className={`btn btn-ghost h-8 ${b.deleted ? '' : 'text-negative'}`} onClick={() => deleteBoard(b.id, !b.deleted)}>{b.deleted ? 'Restore' : 'Delete'}</button>
            </div>
            {Object.values(b.columns).filter((c) => c.archived).map((c) => (
              <div key={c.id} className="flex items-center justify-between pl-3 text-[13px]">
                <span className="text-muted">Archived column: {c.name}</span>
                <button className="btn btn-ghost h-7" onClick={() => updateColumn(b.id, c.id, { archived: false })}>Unarchive</button>
              </div>
            ))}
          </div>
        ))}
      </Section>

      {token ? <History onPreview={onPreview} /> : null}
      {token ? <Storage state={state} /> : null}
    </div>
  )
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-6 w-10 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-control'}`}>
      <span className={`absolute top-0.5 size-5 rounded-full bg-surface transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  )
}

function History({ onPreview }: { onPreview: (title: string, s: State) => void }) {
  const qc = useQueryClient()
  const pending = usePendingCount()
  const [page, setPage] = useState(1)
  const commits = useQuery({ queryKey: ['commits', page], queryFn: () => getApi().commits(page) })
  const [busy, setBusy] = useState('')
  const [forceSha, setForceSha] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const repoName = DATA_REPO.split('/')[1]

  const doRestore = async (sha: string, force: boolean) => {
    if (pending && !confirm(`${pending} unsynced change(s) on this device will be discarded. Continue?`)) return
    setBusy(sha)
    try {
      await restore(sha, force)
      await qc.invalidateQueries({ queryKey: ['commits'] })
    } catch (e) { alert((e as Error).message) } finally { setBusy('') }
  }

  return (
    <Section title="History" help="Every sync is a commit. Restore makes a new commit with the old contents, so nothing is lost; other devices drop their cache and reload.">
      {commits.isLoading && <p className="text-muted">Loading commits…</p>}
      {commits.error && <p className="text-negative">{(commits.error as Error).message}</p>}
      <ul className="-mx-4">
        {commits.data?.map((c) => (
          <CommitRow key={c.sha} sha={c.sha} message={c.commit.message} date={c.commit.author.date} busy={busy === c.sha}
            onPreview={async () => onPreview(`${c.commit.message} · ${fmtTime(Date.parse(c.commit.author.date))}`, await previewAt(c.sha))}
            onRestore={() => doRestore(c.sha, false)} />
        ))}
      </ul>
      <div className="flex gap-1">
        <button className="btn btn-quiet" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Newer</button>
        <button className="btn btn-quiet" disabled={(commits.data?.length ?? 0) < 30} onClick={() => setPage((p) => p + 1)}>Older</button>
      </div>
      <details className="rounded-[8px] bg-raised p-3">
        <summary className="cursor-pointer font-medium text-negative">Danger: force reset</summary>
        <p className="mt-2 text-[13px] text-muted">Moves <b>main</b> back to the chosen commit and discards every commit after it. Type the repo name to confirm.</p>
        <select className="field mt-3" value={forceSha} onChange={(e) => setForceSha(e.target.value)} aria-label="Commit to reset to">
          <option value="">Choose a commit</option>
          {commits.data?.map((c) => <option key={c.sha} value={c.sha}>{c.sha.slice(0, 7)} · {c.commit.message.slice(0, 60)}</option>)}
        </select>
        <input className="field mt-2" placeholder={repoName} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} aria-label="Repository name" />
        <button className="btn btn-danger mt-2" disabled={!forceSha || confirmName !== repoName || !!busy}
          onClick={() => doRestore(forceSha, true).then(() => { setForceSha(''); setConfirmName('') })}>Force reset</button>
      </details>
    </Section>
  )
}

function CommitRow({ sha, message, date, busy, onPreview, onRestore }: {
  sha: string; message: string; date: string; busy: boolean; onPreview: () => void; onRestore: () => void
}) {
  const stats = useQuery({ queryKey: ['stats', sha], queryFn: () => getApi().commitStats(sha), staleTime: Infinity })
  const device = message.match(/^\[([^\]]+)\]/)?.[1]
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="truncate">{device ? message.slice(device.length + 3) : message}</div>
        <div className="text-xs text-muted">
          {ago(Date.parse(date))}{device && ` · ${device}`}
          {stats.data && <> · <span className="text-positive">+{stats.data.add}</span> <span className="text-negative">−{stats.data.del}</span> events</>}
        </div>
      </div>
      <button className="btn btn-ghost h-7" onClick={onPreview}>Preview</button>
      <button className="btn btn-quiet h-7" disabled={busy} onClick={onRestore}>{busy ? 'Restoring…' : 'Restore'}</button>
    </li>
  )
}

function Storage({ state }: { state: State }) {
  const purged = useKv<string[]>('purged', [])
  const list = orphans(state).filter((a) => !purged.includes(a.path))
  const [busy, setBusy] = useState(false)
  const total = list.reduce((n, a) => n + a.size, 0)
  return (
    <Section title="Storage" help="Removed attachments stay in the repo until purged. Purging deletes them from the current tree; git history still holds them.">
      {list.length ? (
        <>
          <ul className="space-y-1 text-[13px]">
            {list.map((a) => <li key={a.path} className="flex justify-between gap-3"><span className="truncate">{a.name}</span><span className="text-muted">{fmtSize(a.size)}</span></li>)}
          </ul>
          <button className="btn btn-danger" disabled={busy} onClick={async () => {
            if (!confirm(`Delete ${list.length} file(s), ${fmtSize(total)}, from the repo?`)) return
            setBusy(true)
            try {
              await purge(list.map((a) => a.path))
              await setKv('purged', [...purged, ...list.map((a) => a.path)])
            } catch (e) { alert((e as Error).message) } finally { setBusy(false) }
          }}>{busy ? 'Purging…' : `Purge ${list.length} file(s), ${fmtSize(total)}`}</button>
        </>
      ) : <p className="text-muted">No orphaned attachments.</p>}
    </Section>
  )
}
