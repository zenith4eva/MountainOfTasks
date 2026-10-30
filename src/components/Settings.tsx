import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { db, defaultDevice, setKv, useKv, usePendingCount } from '../lib/db'
import { dataRepo } from '../lib/github'
import { bioSupported, enrollBiometric } from '../lib/crypto'
import { getApi, orphans, previewAt, purge, restore } from '../lib/sync'
import { deleteBoard, renameBoard, updateColumn, updateLabel } from '../lib/actions'
import type { State } from '../lib/model'
import { LABEL_COLORS, LabelPill, ago, fmtSize, fmtTime } from './ui'
import { BackgroundPicker } from './Background'
import { LANGS, systemLang, t, tn, type Lang } from '../i18n'
import { setLanguage } from './LangGate'
import { InstallHint } from './Onboarding'
import { useInstall } from '../lib/install'

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
  const langSetting = useKv<string>('lang', localStorage.getItem('lang') ?? 'system')
  const bio = useKv('bio', null)
  const bioOk = useQuery({ queryKey: ['bioSupported'], queryFn: bioSupported })
  const [bioErr, setBioErr] = useState('')
  const [bgBoard, setBgBoard] = useState<string | null>(null)
  const boards = Object.values(state.boards)

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <h1 className="pt-2 text-[24px] font-semibold">{t('navSettings')}</h1>

      <Section title={t('thisDevice')} help={t('thisDeviceHelp')}>
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium">{t('deviceName')}</span>
          <input className="field" defaultValue={device} key={device} onBlur={(e) => setKv('device', e.target.value.trim() || defaultDevice())} />
        </label>
      </Section>

      <Section title={t('sync')} help={t('syncHelp', { repo: dataRepo() })}>
        <Row title={t('commitAuto')} help={mode === 'auto' ? t('on') : t('offManual')}>
          <Toggle on={mode === 'auto'} label={t('commitAuto')} onChange={(v) => setKv('syncMode', v ? 'auto' : 'manual')} />
        </Row>
        {token && (
          <Row title={t('dataRepoTitle')}>
            <a className="inline-flex items-center gap-1 text-data underline" href={`https://github.com/${dataRepo()}`} target="_blank" rel="noreferrer">{dataRepo()}</a>
          </Row>
        )}
      </Section>

      <Section title={t('appSection')} help={t('appSectionHelp')}>
        <AppInstall />
      </Section>

      <Section title={t('appearance')} help={t('appearanceHelp')}>
        <div className="flex flex-wrap gap-1">
          {(['system', 'light', 'dark'] as const).map((k) => (
            <button key={k} onClick={() => { setKv('theme', k); localStorage.setItem('theme', k) }}
              className={`btn ${theme === k ? 'btn-primary' : 'btn-quiet'}`}>{t(k === 'system' ? 'themeSystem' : k === 'light' ? 'themeLight' : 'themeDark')}</button>
          ))}
        </div>
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium">{t('language')}</span>
          <select className="field" value={langSetting} onChange={(e) => setLanguage(e.target.value as Lang | 'system')}>
            <option value="system">{t('languageSystem', { name: LANGS.find(([c]) => c === systemLang())![1] })}</option>
            {LANGS.map(([code, name]) => <option key={code} value={code} lang={code}>{name}</option>)}
          </select>
        </label>
      </Section>

      <Section title={t('security')} help={t('securityHelp')}>
        <Row title={t('token')} help={token ? t('tokenUnlocked') : t('tokenNone')}>
          <div className="flex gap-1">
            {token && <button className="btn btn-quiet" onClick={onLock}>{t('lockNow')}</button>}
            <button className="btn btn-quiet" onClick={onReplaceToken}>{token ? t('replaceToken') : t('connectToken')}</button>
          </div>
        </Row>
        <Row title={t('biometric')} help={bio ? t('bioEnrolled') : bioOk.data === false ? t('bioUnavailable') : t('bioPrf')}>
          {bio ? (
            <button className="btn btn-quiet" onClick={() => db.kv.delete('bio')}>{t('remove')}</button>
          ) : (
            <button className="btn btn-quiet" disabled={!token || bioOk.data === false} onClick={async () => {
              setBioErr('')
              try { await setKv('bio', await enrollBiometric(token!)) } catch (e) { setBioErr((e as Error).message) }
            }}>{t('enroll')}</button>
          )}
        </Row>
        {bioErr && <p className="text-negative" role="alert">{bioErr}</p>}
      </Section>

      <Section title={t('labels')} help={t('labelsHelp')}>
        {Object.values(state.labels).filter((l) => !l.deleted).map((l) => (
          <div key={l.id} className="flex items-center gap-2">
            <LabelPill label={l} />
            <input className="field h-8 flex-1" defaultValue={l.name} aria-label={t('renameX', { name: l.name })}
              onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && updateLabel(l.id, { name: e.target.value.trim() })} />
            <div className="flex gap-0.5">
              {LABEL_COLORS.map((c) => (
                <button key={c} aria-label={t('colour')} onClick={() => updateLabel(l.id, { color: c })}
                  className={`size-5 rounded-full ${l.color === c ? 'ring-2 ring-ink' : ''}`} style={{ background: c }} />
              ))}
            </div>
            <button className="btn btn-ghost h-8 text-negative" onClick={() => updateLabel(l.id, { deleted: true })}>{t('delete')}</button>
          </div>
        ))}
        {!Object.values(state.labels).some((l) => !l.deleted) && <p className="text-muted">{t('createLabelsHint')}</p>}
      </Section>

      <Section title={t('navBoards')} help={t('boardsHelp')}>
        {boards.map((b) => (
          <div key={b.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <input className="field h-8 flex-1" defaultValue={b.name} disabled={b.deleted} aria-label={t('renameX', { name: b.name })}
                onBlur={(e) => e.target.value.trim() && e.target.value !== b.name && renameBoard(b.id, e.target.value.trim())} />
              {!b.deleted && <button className="btn btn-quiet h-8" onClick={() => setBgBoard(b.id)}>{t('background')}</button>}
              <button className={`btn btn-ghost h-8 ${b.deleted ? '' : 'text-negative'}`} onClick={() => deleteBoard(b.id, !b.deleted)}>{b.deleted ? t('restore') : t('delete')}</button>
            </div>
            {Object.values(b.columns).filter((c) => c.archived).map((c) => (
              <div key={c.id} className="flex items-center justify-between pl-3 text-[13px]">
                <span className="text-muted">{t('archivedColumnX', { name: c.name })}</span>
                <button className="btn btn-ghost h-7" onClick={() => updateColumn(b.id, c.id, { archived: false })}>{t('unarchive')}</button>
              </div>
            ))}
          </div>
        ))}
      </Section>

      {bgBoard && state.boards[bgBoard] && <BackgroundPicker board={state.boards[bgBoard]} onClose={() => setBgBoard(null)} />}
      {token ? <History onPreview={onPreview} /> : null}
      {token ? <Storage state={state} /> : null}
    </div>
  )
}

function AppInstall() {
  const install = useInstall()
  if (install.installed) return <p className="text-muted">{t('obInstalled')}</p>
  if (!install.canPrompt && !install.ios) return <p className="text-muted">{t('obInstallOther')}</p>
  return <InstallHint />
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-6 w-10 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-control'}`}>
      <span className={`absolute left-0 top-0.5 size-5 rounded-full bg-surface transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
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
  const repoName = dataRepo().split('/')[1]

  const doRestore = async (sha: string, force: boolean) => {
    if (pending && !confirm(tn('discardConfirm', pending))) return
    setBusy(sha)
    try {
      await restore(sha, force)
      await qc.invalidateQueries({ queryKey: ['commits'] })
    } catch (e) { alert((e as Error).message) } finally { setBusy('') }
  }

  return (
    <Section title={t('history')} help={t('historyHelp')}>
      {commits.isLoading && <p className="text-muted">{t('loadingCommits')}</p>}
      {commits.error && <p className="text-negative">{(commits.error as Error).message}</p>}
      <ul className="-mx-4">
        {commits.data?.map((c) => (
          <CommitRow key={c.sha} message={c.commit.message} date={c.commit.author.date} busy={busy === c.sha}
            onPreview={async () => onPreview(`${c.commit.message} · ${fmtTime(Date.parse(c.commit.author.date))}`, await previewAt(c.sha))}
            onRestore={() => doRestore(c.sha, false)} />
        ))}
      </ul>
      <div className="flex gap-1">
        <button className="btn btn-quiet" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>{t('newer')}</button>
        <button className="btn btn-quiet" disabled={(commits.data?.length ?? 0) < 30} onClick={() => setPage((p) => p + 1)}>{t('older')}</button>
      </div>
      <details className="rounded-[8px] bg-raised p-3">
        <summary className="cursor-pointer font-medium text-negative">{t('dangerForce')}</summary>
        <p className="mt-2 text-[13px] text-muted">{t('forceHelp')}</p>
        <select className="field mt-3" value={forceSha} onChange={(e) => setForceSha(e.target.value)} aria-label={t('commitToReset')}>
          <option value="">{t('chooseCommit')}</option>
          {commits.data?.map((c) => <option key={c.sha} value={c.sha}>{c.sha.slice(0, 7)} · {c.commit.message.slice(0, 60)}</option>)}
        </select>
        <input className="field mt-2" placeholder={repoName} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} aria-label={t('repoName')} />
        <button className="btn btn-danger mt-2" disabled={!forceSha || confirmName !== repoName || !!busy}
          onClick={() => doRestore(forceSha, true).then(() => { setForceSha(''); setConfirmName('') })}>{t('forceReset')}</button>
      </details>
    </Section>
  )
}

function CommitRow({ message, date, busy, onPreview, onRestore }: {
  message: string; date: string; busy: boolean; onPreview: () => void; onRestore: () => void
}) {
  const device = message.match(/^\[([^\]]+)\]/)?.[1]
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="truncate">{device ? message.slice(device.length + 3) : message}</div>
        <div className="text-xs text-muted">
          {ago(Date.parse(date))}{device && ` · ${device}`}
        </div>
      </div>
      <button className="btn btn-ghost h-7" onClick={onPreview}>{t('preview')}</button>
      <button className="btn btn-quiet h-7" disabled={busy} onClick={onRestore}>{busy ? t('restoring') : t('restore')}</button>
    </li>
  )
}

function Storage({ state }: { state: State }) {
  const purged = useKv<string[]>('purged', [])
  const list = orphans(state).filter((a) => !purged.includes(a.path))
  const [busy, setBusy] = useState(false)
  const total = list.reduce((n, a) => n + a.size, 0)
  return (
    <Section title={t('storage')} help={t('storageHelp')}>
      {list.length ? (
        <>
          <ul className="space-y-1 text-[13px]">
            {list.map((a) => <li key={a.path} className="flex justify-between gap-3"><span className="truncate">{a.name}</span><span className="text-muted">{fmtSize(a.size)}</span></li>)}
          </ul>
          <button className="btn btn-danger" disabled={busy} onClick={async () => {
            if (!confirm(tn('purgeConfirm', list.length, { size: fmtSize(total) }))) return
            setBusy(true)
            try {
              await purge(list.map((a) => a.path))
              await setKv('purged', [...purged, ...list.map((a) => a.path)])
            } catch (e) { alert((e as Error).message) } finally { setBusy(false) }
          }}>{busy ? t('purging') : tn('purgeN', list.length, { size: fmtSize(total) })}</button>
        </>
      ) : <p className="text-muted">{t('noOrphans')}</p>}
    </Section>
  )
}
