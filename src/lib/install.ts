import { useEffect, useState } from 'react'

// Chrome, Edge and Android fire this once, early; keep it so a button can show the native install dialog later.
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: InstallEvent | null = null
const subs = new Set<() => void>()
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferred = e as InstallEvent
  subs.forEach((f) => f())
})
window.addEventListener('appinstalled', () => { deferred = null; subs.forEach((f) => f()) })

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

// iPhone/iPad Safari has no install event; people add it from the Share sheet.
export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function useInstall() {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((n) => n + 1)
    subs.add(f)
    return () => { subs.delete(f) }
  }, [])
  return {
    installed: isStandalone(),
    canPrompt: !!deferred,
    ios: isIos(),
    async prompt() {
      if (!deferred) return
      await deferred.prompt()
      await deferred.userChoice
      deferred = null
      subs.forEach((f) => f())
    },
  }
}
