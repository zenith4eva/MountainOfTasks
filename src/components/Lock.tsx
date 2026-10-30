import { useEffect, useState } from 'react'
import { db, getKv, setKv } from '../lib/db'
import { MAX_FAILS, openWithBiometric, openWithPin, type BioSealed, type Sealed } from '../lib/crypto'
import { Mark } from './ui'
import { t, tn } from '../i18n'

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

export function Unlock({ sealed, bio, onDone }: { sealed: Sealed; bio: BioSealed | null; onDone: (token: string) => void }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const len = sealed.len ?? 4

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
    const p = (pin + d).slice(0, len)
    setPin(p)
    if (p.length === len) submit(p)
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
        {Array.from({ length: len }, (_, i) => <span key={i} className={`size-3.5 rounded-full ${i < pin.length ? 'bg-ink' : 'bg-control'}`} />)}
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
