import { useMemo, useState } from 'react'
import type { State } from '../lib/model'
import { fmtDate } from './ui'
import { t, tn } from '../i18n'

const DAY = 864e5
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Contribution heatmap of completed cards; one hue, four steps. */
export function Activity({ state, onOpen }: { state: State; onOpen: (cardId: string) => void }) {
  const done = useMemo(() => Object.values(state.cards).filter((c) => c.completedAt && !c.deleted), [state])
  const years = [...new Set([new Date().getFullYear(), ...done.map((c) => new Date(c.completedAt!).getFullYear())])].sort((a, b) => b - a)
  const [year, setYear] = useState(years[0])
  const [day, setDay] = useState<string | null>(null)

  const byDay = useMemo(() => {
    const m = new Map<string, typeof done>()
    for (const c of done) {
      const k = key(new Date(c.completedAt!))
      m.set(k, [...(m.get(k) ?? []), c])
    }
    return m
  }, [done])

  const start = new Date(year, 0, 1)
  start.setDate(start.getDate() - start.getDay()) // Sunday on or before Jan 1
  const weeks: Date[][] = []
  for (let t = start.getTime(); new Date(t).getFullYear() <= year; t += 7 * DAY) {
    weeks.push(Array.from({ length: 7 }, (_, i) => new Date(t + i * DAY)))
  }
  const yearTotal = done.filter((c) => new Date(c.completedAt!).getFullYear() === year).length
  const max = Math.max(1, ...[...byDay.entries()].filter(([k]) => k.startsWith(String(year))).map(([, v]) => v.length))
  const level = (n: number) => (n === 0 ? 0 : Math.ceil((n / max) * 4))
  const fills = ['var(--raised)', 'color-mix(in srgb, var(--data) 30%, var(--surface))', 'color-mix(in srgb, var(--data) 55%, var(--surface))', 'color-mix(in srgb, var(--data) 78%, var(--surface))', 'var(--data)']
  const sel = day ? byDay.get(day) ?? [] : []
  const todayKey = key(new Date())

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <div className="flex items-baseline justify-between pb-4 pt-2">
        <h1 className="text-[24px] font-semibold">{t('navActivity')}</h1>
        <select className="field w-auto" value={year} onChange={(e) => { setYear(+e.target.value); setDay(null) }} aria-label={t('year')}>
          {years.map((y) => <option key={y}>{y}</option>)}
        </select>
      </div>
      <div className="rounded-[8px] bg-surface p-5">
        <p className="mb-4"><span className="text-[30px] font-semibold">{yearTotal}</span> <span className="text-muted">{tn('completedInYear', yearTotal, { year })}</span></p>
        <div className="scroll-x pb-2">
          <div className="flex gap-[3px]" role="grid" aria-label={t('completionsIn', { year })}>
            {weeks.map((w, i) => (
              <div key={i} className="flex flex-col gap-[3px]" role="row">
                {w.map((d) => {
                  const k = key(d)
                  const n = byDay.get(k)?.length ?? 0
                  const out = d.getFullYear() !== year
                  return (
                    <button key={k} role="gridcell" disabled={out} aria-label={t('dayCompleted', { date: fmtDate(d.getTime()), n })} title={t('dayCompleted', { date: fmtDate(d.getTime()), n })}
                      onClick={() => setDay(k)}
                      className={`size-[13px] rounded-[3px] ${out ? 'invisible' : ''} ${day === k ? 'ring-2 ring-ink ring-offset-1 ring-offset-surface' : ''} ${k === todayKey ? 'outline outline-1 outline-ink/40' : ''}`}
                      style={{ background: fills[level(n)] }} />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1 text-xs text-muted">
          {t('less')} {fills.map((f, i) => <span key={i} className="size-[11px] rounded-[3px]" style={{ background: f }} />)} {t('more')}
        </div>
      </div>
      {day && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">{t('dayHeading', { date: fmtDate(new Date(day + 'T00:00').getTime()), n: sel.length })}</h2>
          {sel.length ? (
            <ul className="overflow-hidden rounded-[8px] bg-surface">
              {sel.map((c) => (
                <li key={c.id} className="border-b border-line last:border-0">
                  <button className="flex w-full items-baseline gap-3 px-4 py-2.5 text-left hover:bg-raised" onClick={() => onOpen(c.id)}>
                    <span className="flex-1">{c.title}</span>
                    <span className="text-xs text-muted">{state.boards[c.boardId]?.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-muted">{t('nothingThatDay')}</p>}
        </section>
      )}
    </div>
  )
}
