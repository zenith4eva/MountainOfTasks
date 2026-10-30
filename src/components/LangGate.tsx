import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { currentLang, loadLang, resolveLang, type Lang } from '../i18n'
import { setKv, useKv } from '../lib/db'

const LangCtx = createContext<Lang>('en')

/** Components that memoise translated text take this as a dependency. */
export const useLang = () => useContext(LangCtx)

export async function setLanguage(setting: Lang | 'system') {
  try { localStorage.setItem('lang', setting) } catch { /* private mode */ }
  await setKv('lang', setting)
}

export function LangGate({ children }: { children: ReactNode }) {
  const setting = useKv<string | null>('lang', localStorage.getItem('lang'))
  const want = resolveLang(setting)
  const [ready, setReady] = useState<Lang>(currentLang())
  useEffect(() => {
    let live = true
    if (want !== ready) loadLang(want).then(() => live && setReady(want))
    return () => { live = false }
  }, [want, ready])
  return <LangCtx.Provider value={ready}>{children}</LangCtx.Provider>
}
