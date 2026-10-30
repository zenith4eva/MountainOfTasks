import { describe, it, expect } from 'vitest'
import en from '../src/i18n/en'
import { LANGS, loadLang, t, tn } from '../src/i18n'

const dicts = import.meta.glob<{ default: Record<string, string> }>('../src/i18n/*.ts', { eager: true })
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
const base = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, '')

describe('translations', () => {
  for (const [code] of LANGS.filter(([c]) => c !== 'en')) {
    const d = dicts[`../src/i18n/${code}.ts`]?.default
    it(`${code} matches English keys and placeholders`, () => {
      expect(d, `missing src/i18n/${code}.ts`).toBeTruthy()
      for (const k of Object.keys(en)) expect(d[k], `${code}.${k}`).toBeTypeOf('string')
      for (const k of Object.keys(d)) {
        // extra keys may only be plural forms of an English plural key
        const ok = k in en || `${base(k)}_other` in en
        expect(ok, `${code} has unknown key ${k}`).toBe(true)
        const ref = (en as Record<string, string>)[k] ?? (en as Record<string, string>)[`${base(k)}_other`]
        expect(holes(d[k]), `${code}.${k} placeholders`).toBe(holes(ref))
        expect(d[k].trim(), `${code}.${k} is empty`).not.toBe('')
      }
    })
  }
})

describe('t / tn', () => {
  it('fills placeholders and picks plural forms', async () => {
    expect(t('cmdNewCard', { board: 'Home' })).toBe('New card in Home')
    expect(tn('eventsN', 1)).toBe('1 event')
    expect(tn('eventsN', 3)).toBe('3 events')
  })

  it('uses Russian few/many', async () => {
    ;(globalThis as any).document = { documentElement: {} }
    await loadLang('ru')
    expect(tn('eventsN', 1)).toBe('1 событие')
    expect(tn('eventsN', 3)).toBe('3 события')
    expect(tn('eventsN', 5)).toBe('5 событий')
    await loadLang('en')
  })
})
