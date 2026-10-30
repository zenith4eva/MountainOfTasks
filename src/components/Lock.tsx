import { useEffect, useState } from 'react'
import { db, getKv, setKv } from '../lib/db'
import { DATA_REPO } from '../lib/github'
import { MAX_FAILS, openWithBiometric, openWithPin, sealWithPin, type BioSealed, type Sealed } from '../lib/crypto'
import { Mark } from './ui'
import { t, tn, tx } from '../i18n'

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3"><Mark size={36} /><span className="text-[18px] font-semibold">Mountain of Tasks</span></div>
        {children}
      </div>
    </main>
  )
}

export async function checkToken(token: string): Promise<string | null> {
  const r = await fetch(`https://api.github.com/repos/${DATA_REPO}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null)
  if (!r) return t('errReach')
  if (r.status === 401) return t('errRejected')
  if (r.status === 404) return t('errNoRepo', { repo: DATA_REPO })
  if (!r.ok) return t('errStatus', { status: r.status })
  const j = await r.json()
  if (j.permissions && !j.permissions.push) return t('errReadOnly')
  return null
}

export function Setup({ onDone, notice, allowOffline = true }: { onDone: (token: string) => void; notice?: string; allowOffline?: boolean }) {
  const [token, setToken] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [step, setStep] = useState<'token' | 'pin'>('token')
  const [err, setErr] = useState(notice ?? '')
  const [busy, setBusy] = useState(false)

  return (
    <Frame>
      {step === 'token' ? (
        <form onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          const problem = await checkToken(token.trim())
          setBusy(false)
          if (problem) return setErr(problem)
          setErr('')
          setStep('pin')
        }}>
          <h1 className="mb-1 text-[24px] font-semibold">{t('connectRepo')}</h1>
          <p className="mb-5 text-muted">
            {tx('connectHelp', { repo: <b key="r" className="font-medium text-ink">{DATA_REPO}</b> })}
          </p>
          <label className="mb-1 block text-xs font-medium text-muted" htmlFor="pat">{t('pat')}</label>
          <input id="pat" className="field" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" />
          {err && <p className="mt-2 text-negative" role="alert">{err}</p>}
          <button className="btn btn-primary mt-4 w-full justify-center" disabled={!token.trim() || busy}>{busy ? t('checking') : t('continue')}</button>
          <a className="mt-3 block text-center text-xs text-muted underline" target="_blank" rel="noreferrer"
            href="https://github.com/settings/personal-access-tokens/new">{t('createTokenLink')}</a>
          {allowOffline && (
            <button type="button" className="btn btn-ghost mt-6 w-full justify-center text-muted" onClick={() => setKv('offline', true)}>
              {t('useOffline')}
            </button>
          )}
        </form>
      ) : (
        <form onSubmit={async (e) => {
          e.preventDefault()
          if (!/^\d{4}$/.test(pin)) return setErr(t('pinFour'))
          if (pin !== pin2) return setErr(t('pinsDiffer'))
          setBusy(true)
          const sealed = await sealWithPin(pin, token.trim())
          await setKv('sealed', sealed)
          await setKv('pinFails', 0)
          await setKv('offline', false)
          await db.kv.delete('bio')
          onDone(token.trim())
        }}>
          <h1 className="mb-1 text-[24px] font-semibold">{t('choosePin')}</h1>
          <p className="mb-5 text-muted">{t('pinHelp')}</p>
          <div className="grid grid-cols-2 gap-2">
            <input className="field text-center text-lg tracking-[0.5em]" inputMode="numeric" maxLength={4} type="password" aria-label={t('pin')} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            <input className="field text-center text-lg tracking-[0.5em]" inputMode="numeric" maxLength={4} type="password" aria-label={t('repeatPin')} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />
          </div>
          {err && <p className="mt-2 text-negative" role="alert">{err}</p>}
          <button className="btn btn-primary mt-4 w-full justify-center" disabled={busy}>{busy ? t('encrypting') : t('saveOpen')}</button>
        </form>
      )}
    </Frame>
  )
}

export function Unlock({ sealed, bio, onDone }: { sealed: Sealed; bio: BioSealed | null; onDone: (token: string) => void }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const tryBio = async () => {
    if (!bio) return
    try { onDone(await openWithBiometric(bio)) } catch (e) { setErr((e as Error).message || t('bioFailed')) }
  }
  useEffect(() => { tryBio() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (p: string) => {
    setBusy(true)
    try {
      const token = await openWithPin(p, sealed)
      await setKv('pinFails', 0)
      onDone(token)
    } catch {
      const fails = (await getKv('pinFails', 0)) + 1
      if (fails >= MAX_FAILS) {
        await db.kv.bulkDelete(['sealed', 'bio', 'pinFails'])
        return
      }
      await setKv('pinFails', fails)
      setErr(tn('wrongPin', MAX_FAILS - fails))
      setPin('')
      setBusy(false)
    }
  }
  const press = (d: string) => {
    if (busy) return
    const p = (pin + d).slice(0, 4)
    setPin(p)
    if (p.length === 4) submit(p)
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key)
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  return (
    <Frame>
      <h1 className="mb-1 text-[24px] font-semibold">{t('enterPin')}</h1>
      <p className="mb-6 text-muted">{busy ? t('unlocking') : t('unlockHelp')}</p>
      <div className="mb-6 flex justify-center gap-4" aria-live="polite" aria-label={t('digitsOf', { n: pin.length })}>
        {[0, 1, 2, 3].map((i) => <span key={i} className={`size-3.5 rounded-full ${i < pin.length ? 'bg-ink' : 'bg-control'}`} />)}
      </div>
      <div className="mx-auto grid max-w-64 grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} onClick={() => press(d)} className="h-14 rounded-full bg-surface text-[20px] font-medium hover:bg-raised active:scale-95">{d}</button>
        ))}
        {bio ? <button onClick={tryBio} className="h-14 rounded-full text-xs text-muted hover:bg-raised">{t('bioButton')}</button> : <span />}
        <button onClick={() => press('0')} className="h-14 rounded-full bg-surface text-[20px] font-medium hover:bg-raised active:scale-95">0</button>
        <button onClick={() => setPin((p) => p.slice(0, -1))} className="h-14 rounded-full text-sm text-muted hover:bg-raised" aria-label={t('deleteDigit')}>{t('delete')}</button>
      </div>
      {err && <p className="mt-5 text-center text-negative" role="alert">{err}</p>}
    </Frame>
  )
}
