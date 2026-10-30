import { createElement, Fragment, type ReactNode } from 'react'
import en from './en'

export type Key = keyof typeof en
/** Every language must translate every key; extra keys are allowed for plural forms like `_few`. */
export type Dict = Record<Key, string> & Record<string, string>
type PluralBase = Key extends infer K ? (K extends `${infer B}_other` ? B : never) : never

export const LANGS = [
  ['en', 'English'],
  ['ko', '한국어'],
  ['ja', '日本語'],
  ['zh-CN', '简体中文'],
  ['zh-TW', '繁體中文'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['pt-BR', 'Português (Brasil)'],
  ['ru', 'Русский'],
] as const
export type Lang = (typeof LANGS)[number][0]

const loaders = import.meta.glob<{ default: Dict }>('./*.ts') // includes en/index; only language files are looked up
let lang: Lang = 'en'
let dict: Dict = en as Dict

export const currentLang = () => lang

/** Best match for the browser's preferred languages. */
export function systemLang(): Lang {
  for (const pref of navigator.languages ?? [navigator.language]) {
    const p = pref.toLowerCase()
    if (p.startsWith('zh')) return /hant|tw|hk|mo/.test(p) ? 'zh-TW' : 'zh-CN'
    if (p.startsWith('pt')) return 'pt-BR'
    const hit = LANGS.find(([code]) => code.toLowerCase() === p || code === p.split('-')[0])
    if (hit) return hit[0]
  }
  return 'en'
}

export function resolveLang(setting: string | null | undefined): Lang {
  return LANGS.some(([c]) => c === setting) ? (setting as Lang) : systemLang()
}

/** Loads the dictionary, then makes it current. Call before rendering in that language. */
export async function loadLang(l: Lang) {
  dict = l === 'en' ? (en as Dict) : (await loaders[`./${l}.ts`]()).default
  lang = l
  document.documentElement.lang = l
}

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s

export function t(key: Key, vars?: Record<string, string | number>): string {
  return fill(dict[key] ?? en[key], vars)
}

/** Plural-aware: picks `${base}_${rule}` for `n` (falls back to `_other`); `{n}` is filled in. */
export function tn(base: PluralBase, n: number, vars?: Record<string, string | number>): string {
  const rule = new Intl.PluralRules(lang).select(n)
  const s = dict[`${base}_${rule}`] ?? dict[`${base}_other`] ?? (en as Dict)[`${base}_${rule}`] ?? (en as Dict)[`${base}_other`]
  return fill(s, { n, ...vars })
}

/** Like t, but placeholders may be React nodes (for a bold repo name inside a sentence). */
export function tx(key: Key, nodes: Record<string, ReactNode>): ReactNode {
  const parts = (dict[key] ?? en[key]).split(/\{(\w+)\}/)
  return createElement(Fragment, null, ...parts.map((p, i) => (i % 2 ? nodes[p] ?? `{${p}}` : p)))
}

// --- locale-aware formatting ---

export const fmtMonth = (y: number, m: number) => new Date(y, m, 1).toLocaleDateString(lang, { month: 'short', year: 'numeric' })
export const fmtMonthShort = (y: number, m: number) => new Date(y, m, 1).toLocaleDateString(lang, { month: 'short' })
export const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })
export const fmtDay = (iso: string) => new Date(iso + 'T00:00').toLocaleDateString(lang, { day: 'numeric', month: 'short' })
export const fmtTime = (ts: number) => new Date(ts).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function ago(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000)
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  if (s < 45) return rtf.format(0, 'second')
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour')
  return fmtDate(ts)
}
