import { useEffect, useState, type ReactNode } from 'react'
import { db, defaultDevice, getKv, setKv } from '../lib/db'
import { DEFAULT_REPO_NAME, findRepo, newRepoUrl, newTokenUrl, type TokenCheck } from '../lib/github'
import { sealWithPin } from '../lib/crypto'
import { switchRepo } from '../lib/sync'
import { useInstall } from '../lib/install'
import { LANGS, systemLang, t, type Lang } from '../i18n'
import { setLanguage } from './LangGate'
import { Icon, Mark } from './ui'

type Step = 'welcome' | 'repo' | 'token' | 'paste' | 'pin'

/**
 * First run. "Start now" needs nothing; "Sync with GitHub" walks through the two GitHub forms with
 * pre-filled links and a sketch of each page, so the one manual choice (which repo the token may
 * see) is obvious. When replacing a rejected token it opens straight on the paste step.
 */
export function Setup({ onDone, notice, allowOffline = true }: { onDone: (token: string) => void; notice?: string; allowOffline?: boolean }) {
  const [step, setStep] = useState<Step>(allowOffline ? 'welcome' : 'paste')
  const [repoName, setRepoName] = useState(DEFAULT_REPO_NAME)
  const [token, setToken] = useState('')
  const [repo, setRepo] = useState('')

  return (
    <main className="flex min-h-full justify-center px-4 py-8 sm:items-center">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center gap-3"><Mark size={36} /><span className="text-[18px] font-semibold">Mountain of Tasks</span></div>
        {step !== 'welcome' && step !== 'pin' && <Progress step={step} />}
        {step === 'welcome' && <Welcome onSync={() => setStep('repo')} />}
        {step === 'repo' && <RepoStep name={repoName} setName={setRepoName} onBack={() => setStep('welcome')} onNext={() => setStep('token')} />}
        {step === 'token' && <TokenStep name={repoName} onBack={() => setStep('repo')} onNext={() => setStep('paste')} />}
        {step === 'paste' && (
          <PasteStep name={repoName} setName={setRepoName} notice={notice}
            onBack={allowOffline ? () => setStep('token') : undefined}
            onHelp={() => setStep('token')}
            onOk={(tok, r) => { setToken(tok); setRepo(r); setStep('pin') }} />
        )}
        {step === 'pin' && <PinStep token={token} repo={repo} onDone={onDone} />}
      </div>
    </main>
  )
}

function Progress({ step }: { step: Step }) {
  const steps: Step[] = ['repo', 'token', 'paste']
  const i = steps.indexOf(step)
  return (
    <div className="mb-5" aria-label={t('obStepOf', { n: i + 1, total: steps.length })}>
      <div className="mb-1.5 text-xs text-muted">{t('obStepOf', { n: i + 1, total: steps.length })}</div>
      <div className="flex gap-1">
        {steps.map((s, j) => <span key={s} className={`h-1 flex-1 rounded-full ${j <= i ? 'bg-data' : 'bg-control'}`} />)}
      </div>
    </div>
  )
}

function Nav({ onBack, children }: { onBack?: () => void; children?: ReactNode }) {
  return (
    <div className="mt-6 flex items-center justify-between gap-2">
      {onBack ? <button type="button" className="btn btn-ghost" onClick={onBack}><Icon name="left" size={14} /> {t('obBack')}</button> : <span />}
      <div className="flex gap-2">{children}</div>
    </div>
  )
}

// --- welcome ---

function Welcome({ onSync }: { onSync: () => void }) {
  const [lang, setLang] = useState(() => localStorage.getItem('lang') ?? 'system')
  return (
    <>
      <h1 className="text-[28px] font-semibold leading-tight">{t('obWelcomeTitle')}</h1>
      <p className="mt-2 text-[15px] text-muted">{t('obWelcomeBody')}</p>
      <div className="mt-6 grid gap-2">
        <button className="group rounded-[12px] bg-accent p-4 text-left text-on-accent transition-transform active:scale-[0.99]" onClick={() => setKv('offline', true)}>
          <span className="block text-[16px] font-semibold">{t('obStartNow')}</span>
          <span className="mt-0.5 block text-[13px] opacity-75">{t('obStartNowHelp')}</span>
        </button>
        <button className="rounded-[12px] bg-surface p-4 text-left transition-colors hover:bg-raised active:scale-[0.99]" onClick={onSync}>
          <span className="flex items-center gap-2 text-[16px] font-semibold"><Icon name="github" size={18} /> {t('obSyncGithub')}</span>
          <span className="mt-0.5 block text-[13px] text-muted">{t('obSyncGithubHelp')}</span>
        </button>
      </div>
      <InstallHint className="mt-4" />
      <label className="mt-8 flex items-center gap-2 text-[13px] text-muted">
        {t('language')}
        <select className="field h-8 w-auto" value={lang} onChange={(e) => { setLang(e.target.value); setLanguage(e.target.value as Lang | 'system') }}>
          <option value="system">{t('languageSystem', { name: LANGS.find(([c]) => c === systemLang())![1] })}</option>
          {LANGS.map(([code, name]) => <option key={code} value={code} lang={code}>{name}</option>)}
        </select>
      </label>
    </>
  )
}

/** Native install button where the browser offers one; Share-sheet steps on iPhone and iPad. */
export function InstallHint({ className = '' }: { className?: string }) {
  const install = useInstall()
  if (install.installed) return null
  if (install.canPrompt) {
    return (
      <button className={`btn btn-quiet w-full justify-center ${className}`} onClick={install.prompt}>
        <Icon name="download" size={14} /> {t('obInstall')}
      </button>
    )
  }
  if (install.ios) {
    return (
      <div className={`flex items-start gap-3 rounded-[12px] bg-surface p-3 text-[13px] ${className}`}>
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-raised"><Icon name="share" size={16} /></span>
        <span><b className="font-medium">{t('obInstallIosTitle')}</b><br /><span className="text-muted">{t('obInstallIos')}</span></span>
      </div>
    )
  }
  return null
}

// --- step 1: repository ---

function RepoStep({ name, setName, onBack, onNext }: { name: string; setName: (s: string) => void; onBack: () => void; onNext: () => void }) {
  const [custom, setCustom] = useState(name !== DEFAULT_REPO_NAME)
  return (
    <>
      <h1 className="text-[22px] font-semibold">{t('obRepoTitle')}</h1>
      <p className="mt-1 text-muted">{t('obRepoBody')}</p>
      <a className="btn btn-primary mt-5 h-10 w-full justify-center" href={newRepoUrl(name)} target="_blank" rel="noreferrer" onClick={() => setTimeout(onNext, 400)}>
        {t('obOpenGithub')} <Icon name="external" size={14} />
      </a>
      <Sketch url="github.com/new" caption={t('obRepoSketch')}>
        <Field label="Repository name" filled><Box>{name}</Box></Field>
        <Field label="Visibility" filled>
          <Radio>Public</Radio>
          <Radio on>Private</Radio>
        </Field>
        <Marker n={1}><Btn>Create repository</Btn></Marker>
      </Sketch>
      <div className="mt-4 text-[13px]">
        {custom ? (
          <label className="block">
            <span className="mb-1 block text-muted">{t('obRepoName')}</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value.trim() || DEFAULT_REPO_NAME)} spellCheck={false} />
          </label>
        ) : (
          <button className="text-muted underline" onClick={() => setCustom(true)}>{t('obRepoCustom')}</button>
        )}
      </div>
      <Nav onBack={onBack}>
        <button className="btn btn-quiet" onClick={onNext}>{t('obHaveRepo')}</button>
      </Nav>
    </>
  )
}

// --- step 2: token ---

function TokenStep({ name, onBack, onNext }: { name: string; onBack: () => void; onNext: () => void }) {
  return (
    <>
      <h1 className="text-[22px] font-semibold">{t('obTokenTitle')}</h1>
      <p className="mt-1 text-muted">{t('obTokenBody')}</p>
      <a className="btn btn-primary mt-5 h-10 w-full justify-center" href={newTokenUrl()} target="_blank" rel="noreferrer">
        {t('obOpenGithub')} <Icon name="external" size={14} />
      </a>
      <ol className="mt-5 space-y-2 text-[14px]">
        <li className="flex gap-2"><Num n={1} />{t('obTokenPick', { name })}</li>
        <li className="flex gap-2"><Num n={2} />{t('obTokenGenerate')}</li>
        <li className="flex gap-2"><Num n={3} />{t('obTokenCopy')}</li>
      </ol>
      <TokenSketch name={name} />
      <p className="mt-3 text-[13px] text-muted">{t('obTokenNote')}</p>
      <Nav onBack={onBack}>
        <button className="btn btn-primary" onClick={onNext}>{t('obIHaveToken')}</button>
      </Nav>
    </>
  )
}

function TokenSketch({ name, only1 }: { name: string; only1?: boolean }) {
  return (
    <Sketch url="github.com/settings/personal-access-tokens/new" caption={only1 ? undefined : t('obTokenSketch')}>
      {!only1 && <Field label="Token name" filled><Box>Mountain of Tasks</Box></Field>}
      {!only1 && <Field label="Expiration" filled><Box>366 days</Box></Field>}
      <Marker n={1}>
        <Field label="Repository access">
          <Radio>Public repositories</Radio>
          <Radio>All repositories</Radio>
          <Radio on>Only select repositories</Radio>
          <div className="ml-5 mt-1 inline-flex items-center gap-1.5 rounded-[6px] bg-surface px-2 py-1 ring-1 ring-control">
            <Icon name="check" size={12} className="text-data" /><span className="font-medium">{name}</span><Icon name="down" size={12} className="text-muted" />
          </div>
        </Field>
      </Marker>
      {!only1 && <Field label="Permissions · Contents" filled><Box>Read and write</Box></Field>}
      {!only1 && <Marker n={2}><Btn>Generate token</Btn></Marker>}
      {!only1 && (
        <Marker n={3}>
          <div className="flex items-center gap-2 rounded-[6px] bg-surface px-2 py-1.5 font-mono text-[11px] ring-1 ring-control">
            <span className="flex-1 truncate">github_pat_11A2B3C4D5…</span><Icon name="copy" size={13} />
          </div>
        </Marker>
      )}
    </Sketch>
  )
}

// --- step 3: paste ---

function PasteStep({ name, setName, notice, onBack, onHelp, onOk }: {
  name: string; setName: (s: string) => void; notice?: string
  onBack?: () => void; onHelp: () => void; onOk: (token: string, repo: string) => void
}) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<Extract<TokenCheck, { error: string }> | null>(null)
  const canPaste = !!navigator.clipboard?.readText

  const check = async (tok = token, want = name) => {
    const v = tok.trim()
    if (!v) return
    setBusy(true)
    const r = await findRepo(v, want)
    setBusy(false)
    if (!('error' in r)) onOk(v, r.repo)
    else setRes(r)
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); check() }}>
      <h1 className="text-[22px] font-semibold">{t('obPasteTitle')}</h1>
      <p className="mt-1 text-muted">{notice || t('obPasteBody')}</p>
      <div className="mt-5 flex gap-2">
        <input className="field h-10 flex-1 font-mono text-[13px]" type="password" autoComplete="off" spellCheck={false} placeholder="github_pat_…"
          aria-label={t('pat')} value={token} autoFocus
          onChange={(e) => { setToken(e.target.value); setRes(null) }} />
        {canPaste && (
          <button type="button" className="btn btn-quiet h-10" onClick={async () => {
            try {
              const v = (await navigator.clipboard.readText()).trim()
              setToken(v)
              setRes(null)
              if (v.startsWith('github_pat_') || v.startsWith('ghp_')) check(v)
            } catch { /* permission denied: the field still accepts a normal paste */ }
          }}><Icon name="copy" size={14} /> {t('obPaste')}</button>
        )}
      </div>
      {res && <Problem res={res} name={name} setName={setName} onRetry={(n) => check(token, n)} onUse={(r) => onOk(token.trim(), r)} />}
      <p className="mt-3 text-[13px] text-muted">{t('obPastePrivacy')}</p>
      <Nav onBack={onBack}>
        <button type="button" className="btn btn-ghost" onClick={onHelp}>{t('obNeedToken')}</button>
        <button className="btn btn-primary" disabled={!token.trim() || busy}>{busy ? t('checking') : t('continue')}</button>
      </Nav>
    </form>
  )
}

/** What went wrong with the token, and the one thing to change on GitHub. */
function Problem({ res, name, setName, onRetry, onUse }: {
  res: Extract<TokenCheck, { error: string }>; name: string; setName: (s: string) => void
  onRetry: (name: string) => void; onUse: (repo: string) => void
}) {
  const box = 'mt-4 rounded-[12px] bg-surface p-4 text-[14px]'
  const editTokens = (
    <a className="mt-3 inline-flex items-center gap-1 text-data underline" href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noreferrer">
      {t('obEditToken')} <Icon name="external" size={12} />
    </a>
  )
  switch (res.error) {
    case 'reach': return <p className="mt-3 text-negative" role="alert">{t('errReach')}</p>
    case 'status': return <p className="mt-3 text-negative" role="alert">{t('errStatus', { status: res.status })}</p>
    case 'rejected': return <p className="mt-3 text-negative" role="alert">{t('obErrRejected')}</p>
    case 'confirm':
      return (
        <div className={box} role="alert">
          <p>{t('obErrConfirm', { repo: res.repo })}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-primary" onClick={() => onUse(res.repo)}>{t('obUseRepo')}</button>
          </div>
        </div>
      )
    case 'noRepos':
    case 'notFound':
      return (
        <div className={box} role="alert">
          <p className="font-medium text-negative">{res.error === 'noRepos' ? t('obErrNoRepos') : t('obErrNotFound', { name })}</p>
          <p className="mt-1 text-muted">{t('obErrFix', { name })}</p>
          <TokenSketch name={name} only1 />
          {editTokens}
          {res.error === 'notFound' && res.repos.length > 0 && (
            <label className="mt-4 block">
              <span className="mb-1 block text-[13px] text-muted">{t('obOrPick')}</span>
              <select className="field" defaultValue="" onChange={(e) => { if (e.target.value) { setName(e.target.value); onRetry(e.target.value) } }}>
                <option value="" disabled>—</option>
                {res.repos.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          )}
        </div>
      )
  }
}

// --- step 4: PIN ---

function PinStep({ token, repo, onDone }: { token: string; repo: string; onDone: (token: string) => void }) {
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [len, setLen] = useState(4)
  const [name, setName] = useState(defaultDevice)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { getKv('device', defaultDevice()).then(setName) }, [])

  return (
    <form onSubmit={async (e) => {
      e.preventDefault()
      if (pin.length !== len) return setErr(t('pinMustBe', { n: len }))
      if (pin !== pin2) return setErr(t('pinsDiffer'))
      setBusy(true)
      const sealed = await sealWithPin(pin, token)
      await switchRepo(repo)
      await setKv('sealed', { ...sealed, len })
      await setKv('pinFails', 0)
      await setKv('offline', false)
      await setKv('device', name.trim() || defaultDevice())
      await db.kv.delete('bio')
      onDone(token)
    }}>
      <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-[13px]">
        <Icon name="check" size={14} className="text-positive" /> {t('obConnected', { repo })}
      </p>
      <h1 className="mb-1 text-[22px] font-semibold">{t('choosePin')}</h1>
      <p className="mb-5 text-muted">{t('pinHelp')}</p>
      <div className="mb-3 flex gap-1" role="radiogroup" aria-label={t('pin')}>
        {[4, 6].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={len === n} className={`btn h-8 ${len === n ? 'btn-primary' : 'btn-quiet'}`}
            onClick={() => { setLen(n); setPin(''); setPin2('') }}>{t('pinLen', { n })}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="field text-center text-lg tracking-[0.4em]" inputMode="numeric" maxLength={len} type="password" aria-label={t('pin')} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        <input className="field text-center text-lg tracking-[0.4em]" inputMode="numeric" maxLength={len} type="password" aria-label={t('repeatPin')} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />
      </div>
      {/* Tags this device's commits and comments; the UA guess ("Windows") is rarely what people want. */}
      <label className="mb-1 mt-4 block text-xs font-medium text-muted" htmlFor="device">{t('deviceName')}</label>
      <input id="device" className="field" value={name} onChange={(e) => setName(e.target.value)} />
      {err && <p className="mt-2 text-negative" role="alert">{err}</p>}
      <button className="btn btn-primary mt-5 h-10 w-full justify-center" disabled={busy}>{busy ? t('encrypting') : t('saveOpen')}</button>
    </form>
  )
}

// --- sketches of GitHub's forms (GitHub's own labels, which are English-only) ---

function Sketch({ url, caption, children }: { url: string; caption?: string; children: ReactNode }) {
  return (
    <figure className="mt-5">
      <div className="overflow-hidden rounded-[12px] bg-raised" lang="en" aria-hidden="true">
        <div className="flex items-center gap-2 bg-sunken px-3 py-2 text-[11px] text-muted">
          <Icon name="github" size={13} /><span className="truncate">{url}</span>
        </div>
        <div className="space-y-3 p-4 text-[12px]">{children}</div>
      </div>
      {caption && <figcaption className="mt-2 text-[13px] text-muted">{caption}</figcaption>}
    </figure>
  )
}

function Field({ label, filled, children }: { label: string; filled?: boolean; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 font-medium">
        {label}
        {filled && <span className="inline-flex items-center gap-0.5 rounded-full bg-surface px-1.5 text-[10px] font-normal text-positive"><Icon name="check" size={10} />{t('obFilled')}</span>}
      </div>
      {children}
    </div>
  )
}

const Box = ({ children }: { children: ReactNode }) => <div className="rounded-[6px] bg-surface px-2 py-1 ring-1 ring-control">{children}</div>
const Btn = ({ children }: { children: ReactNode }) => <span className="inline-block rounded-[6px] bg-positive px-3 py-1 font-medium text-white">{children}</span>
const Radio = ({ on, children }: { on?: boolean; children: ReactNode }) => (
  <div className="flex items-center gap-1.5 py-0.5">
    <span className={`size-3 rounded-full ring-1 ${on ? 'bg-data ring-data ring-offset-1 ring-offset-raised' : 'ring-control'}`} />
    <span className={on ? 'font-medium' : 'text-muted'}>{children}</span>
  </div>
)
const Num = ({ n }: { n: number }) => (
  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-data text-[11px] font-semibold text-data-ink">{n}</span>
)

/** Rings the part of the sketch to act on, with its step number. */
function Marker({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="relative rounded-[8px] p-2 ring-2 ring-data">
      <span className="absolute -left-2.5 -top-2.5"><Num n={n} /></span>
      {children}
    </div>
  )
}
