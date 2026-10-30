import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { getApi } from '../lib/sync'
import type { Attachment, Card, Label } from '../lib/model'

const P: Record<string, string> = {
  board: 'M3 4h4v16H3zM10 4h4v10h-4zM17 4h4v13h-4z',
  journal: 'M4 5h16M4 10h16M4 15h10M4 20h7',
  activity: 'M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v4H4zM10 10h4v4h-4zM4 16h4v4H4z',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  clip: 'M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15.5 7',
  check: 'M4 12l5 5L20 6',
  comment: 'M4 5h16v11H9l-5 4z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  cloud: 'M7 18a5 5 0 0 1-.6-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  archive: 'M3 5h18v4H3zM5 9v10h14V9M10 13h4',
}

export function Icon({ name, size = 16, className = '' }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={P[name]} />
    </svg>
  )
}

export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Mountain of Tasks">
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <path d="M8 50 26 18l8 13 5-7 17 26z" fill="var(--ground)" />
      <path d="m26 18-5 9 5-3 3 3z" fill="var(--data)" />
    </svg>
  )
}

// Pale identity tints for labels, spaced around the wheel.
export const LABEL_COLORS = ['#e8eefb', '#fde8e4', '#e3f4e6', '#fdf1d9', '#efe6fa', '#e1f2f4', '#f8e4f0', '#ececea']
export const LABEL_INKS: Record<string, string> = {
  '#e8eefb': '#173e7a', '#fde8e4': '#7a2414', '#e3f4e6': '#1d5226', '#fdf1d9': '#6b4507',
  '#efe6fa': '#4b2a78', '#e1f2f4': '#14535b', '#f8e4f0': '#72214e', '#ececea': '#3d3d3d',
}

export function LabelPill({ label, small }: { label: Label; small?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${small ? 'h-5 px-2 text-[11px]' : 'h-6 px-2.5 text-xs'}`}
      style={{ background: label.color, color: LABEL_INKS[label.color] ?? '#3d3d3d' }}>
      {label.name}
    </span>
  )
}

export const PRIORITIES: Card['priority'][] = ['none', 'low', 'med', 'high']
export { priorityName } from '../lib/describe'
export { fmtMonth, fmtMonthShort, fmtDate, fmtDay, fmtTime, ago } from '../i18n'
export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`)

export const today = () => new Date().toISOString().slice(0, 10)

export function Modal({ onClose, children, wide, label }: { onClose: () => void; children: ReactNode; wide?: boolean; label: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-0 sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={label}
        className={`relative min-h-full w-full bg-surface shadow-2xl sm:min-h-0 sm:rounded-[12px] ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
        {children}
      </div>
    </div>
  )
}

/** Small anchored menu that closes on outside click. */
export function Popover({ button, children, align = 'left' }: { button: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    // document fires before window, so this keeps Escape from also closing an enclosing modal
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [open])
  return (
    <div className="relative" ref={ref}>
      {button(() => setOpen((o) => !o))}
      {open && (
        <div className={`absolute z-30 mt-1 min-w-52 rounded-[8px] border border-line bg-surface p-1 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ onClick, children, danger }: { onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left hover:bg-raised ${danger ? 'text-negative' : ''}`}>
      {children}
    </button>
  )
}

// --- attachments ---

const urlCache = new Map<string, Promise<string>>()

/** Object URL for a synced attachment, fetched once per session and shared by every view. */
export function attachmentUrl(att: Attachment): Promise<string> {
  if (!urlCache.has(att.path)) {
    urlCache.set(att.path, getApi().blobBytes(att.blob)
      .then((b) => URL.createObjectURL(new Blob([b], { type: att.mime })))
      .catch((e) => { urlCache.delete(att.path); throw e }))
  }
  return urlCache.get(att.path)!
}

export function useAttachmentUrl(att: Attachment | undefined): { url: string | null; pending: boolean } {
  const pendingBlob = useLiveQuery(() => (att ? db.blobs.get(att.path) : undefined), [att?.path])
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!att) return
    if (pendingBlob) {
      const u = URL.createObjectURL(pendingBlob.data)
      setUrl(u)
      return () => URL.revokeObjectURL(u)
    }
    let live = true
    attachmentUrl(att).then((u) => live && setUrl(u), () => live && setUrl(null))
    return () => { live = false }
  }, [att?.path, pendingBlob])
  return { url, pending: !!pendingBlob }
}

const LazyMarkdown = lazy(() => import('./Markdown'))

export function Markdown(props: { text: string; attachments: Record<string, Attachment> }) {
  return <Suspense fallback={<p className="whitespace-pre-wrap">{props.text}</p>}><LazyMarkdown {...props} /></Suspense>
}
