import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { db } from '../lib/db'
import type { Board } from '../lib/model'
import { setBackground, stageBackground } from '../lib/actions'
import { PRESETS, focusPos, isVideo, lookOf, presetById, type Background, type Fit } from '../lib/backgrounds'
import { Icon, Modal, useAttachmentUrl } from './ui'
import { t } from '../i18n'

/**
 * The board's backdrop. `scale` shrinks pixel sizes (blur, tile width) for the small previews so
 * they match what the real board shows at full size.
 */
export function BoardBackground({ bg, scale = 1 }: { bg: Background; scale?: number }) {
  const { dim } = lookOf(bg)
  return (
    <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
      {bg.kind === 'preset' ? <PresetLayer id={bg.id} /> : <MediaLayer bg={bg} scale={scale} />}
      {dim > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: dim }} />}
    </div>
  )
}

function PresetLayer({ id }: { id: string }) {
  const p = presetById(id)
  return p ? <div className={`absolute inset-0 ${p.animated ? 'bg-anim' : ''}`} style={{ background: p.css }} /> : null
}

function useMediaUrl(bg: Background | null) {
  const file = bg?.kind === 'file' ? bg : undefined
  const { url: fileUrl } = useAttachmentUrl(file)
  if (!bg || bg.kind === 'preset') return { url: null, video: false }
  return bg.kind === 'url' ? { url: bg.url, video: isVideo(bg.url) } : { url: fileUrl, video: isVideo(bg.mime) }
}

function MediaLayer({ bg, scale }: { bg: Exclude<Background, { kind: 'preset' }>; scale: number }) {
  const { url, video } = useMediaUrl(bg)
  const { fit, focus, tile } = lookOf(bg)
  if (!url) return null
  const pos = focusPos(focus)

  if (video) {
    // Tiling a video makes no sense; it falls back to fill. "Fit" letterboxes on the plain ground.
    const contain = fit === 'fit'
    return <video className={`absolute inset-0 h-full w-full ${contain ? 'object-contain' : 'object-cover'}`} style={{ objectPosition: pos }}
      src={url} autoPlay muted loop playsInline />
  }

  const img = `url("${url}")`
  if (fit === 'tile') {
    return <div className="absolute inset-0" style={{ backgroundImage: img, backgroundRepeat: 'repeat', backgroundSize: `${Math.max(8, tile * scale)}px auto` }} />
  }
  if (fit === 'fit') {
    // The whole picture, centred on its focal point, over a blurred and darkened copy instead of bars.
    const blur: CSSProperties = { backgroundImage: img, backgroundSize: 'cover', backgroundPosition: pos, filter: `blur(${Math.max(4, 28 * scale)}px) brightness(0.7)`, transform: 'scale(1.15)' }
    return (
      <>
        <div className="absolute inset-0" style={blur} />
        <div className="absolute inset-0" style={{ backgroundImage: img, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }} />
      </>
    )
  }
  return <div className="absolute inset-0" style={{ backgroundImage: img, backgroundSize: 'cover', backgroundPosition: pos }} />
}

// --- picker ---

const same = (a: Background | null, b: Background | null) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Edits a draft: nothing touches the board until Apply. A file uploaded here is staged (pending
 * upload) so it can be previewed; Cancel, or picking something else, drops it again.
 */
export function BackgroundPicker({ board, onClose }: { board: Board; onClose: () => void }) {
  const applied = (board.settings.background ?? null) as Background | null
  const [draft, setDraft] = useState<Background | null>(applied)
  const [url, setUrl] = useState('')
  const staged = useRef<string | null>(null)
  const okUrl = /^https?:\/\/\S+$/.test(url.trim())
  const look = draft ? lookOf(draft) : null
  const media = useMediaUrl(draft)

  const dropStaged = (keep?: string) => {
    const p = staged.current
    if (p && p !== keep && p !== (applied?.kind === 'file' ? applied.path : null)) db.blobs.delete(p)
    if (p !== keep) staged.current = null
  }
  // Keeps fit/focus/dim when switching the picture, so a tuned look survives trying another image.
  const pick = (src: Background | null) => {
    dropStaged(src?.kind === 'file' ? src.path : undefined)
    setDraft(src && draft ? { ...src, fit: draft.fit, dim: draft.dim, tile: draft.tile, focus: src.kind === 'preset' ? undefined : { x: 0.5, y: 0.5 } } : src)
  }
  const tweak = (patch: Partial<Background>) => setDraft((d) => (d ? ({ ...d, ...patch } as Background) : d))
  const cancel = () => { dropStaged(); onClose() }
  const apply = async () => {
    staged.current = null
    if (!same(draft, applied)) await setBackground(board, draft)
    onClose()
  }

  const ring = 'ring-2 ring-ink ring-offset-2 ring-offset-surface'
  const isPreset = (id: string) => draft?.kind === 'preset' && draft.id === id
  const fits: [Fit, string, string][] = [
    ['fill', t('bgModeFill'), t('bgModeFillHint')],
    ['fit', t('bgModeFit'), t('bgModeFitHint')],
    ['tile', t('bgModeTile'), t('bgModeTileHint')],
  ]
  const isMedia = !!draft && draft.kind !== 'preset'

  return (
    <Modal onClose={cancel} wide label={t('background')}>
      <div className="p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-[20px] font-semibold">{t('background')} · {board.name}</h2>
          <button onClick={cancel} aria-label={t('close')} className="rounded p-1.5 text-muted hover:bg-raised"><Icon name="x" size={18} /></button>
        </div>

        <Previews bg={draft} />

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-medium text-muted">{t('bgPresets')}</h3>
            <div className="grid grid-cols-4 gap-2">
              <button onClick={() => pick(null)} aria-pressed={!draft}
                className={`flex h-12 items-center justify-center rounded-[8px] bg-raised text-xs text-muted ${!draft ? ring : ''}`}>{t('bgNone')}</button>
              {PRESETS.map((p) => (
                <button key={p.id} onClick={() => pick({ kind: 'preset', id: p.id })} aria-label={p.name} aria-pressed={isPreset(p.id)} title={p.name}
                  className={`relative h-12 overflow-hidden rounded-[8px] ${isPreset(p.id) ? ring : ''}`}>
                  <span className={`absolute inset-0 ${p.animated ? 'bg-anim' : ''}`} style={{ background: p.css }} />
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <label className="btn btn-quiet cursor-pointer">
                <Icon name="image" size={14} /> {t('bgUpload')}
                <input type="file" accept="image/*,video/*" className="hidden" onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  const bg = await stageBackground(board, f)
                  if (bg?.kind === 'file') { pick(bg); staged.current = bg.path }
                }} />
              </label>
            </div>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (okUrl) { pick({ kind: 'url', url: url.trim() }); setUrl('') } }}>
              <input className="field" placeholder={t('bgUrl')} value={url} onChange={(e) => setUrl(e.target.value)} aria-label={t('bgUrl')} />
              <button className="btn btn-quiet shrink-0" disabled={!okUrl}>{t('bgUse')}</button>
            </form>
          </div>

          <div className="space-y-5">
            {isMedia && look && (
              <div>
                <h3 className="mb-2 text-xs font-medium text-muted">{t('bgLayout')}</h3>
                <div className="flex gap-1" role="radiogroup" aria-label={t('bgLayout')}>
                  {fits.filter(([f]) => !(f === 'tile' && media.video)).map(([f, label]) => (
                    <button key={f} role="radio" aria-checked={look.fit === f} onClick={() => tweak({ fit: f })}
                      className={`btn h-8 ${look.fit === f ? 'btn-primary' : 'btn-quiet'}`}>{label}</button>
                  ))}
                </div>
                <p className="mt-2 text-[13px] text-muted">{fits.find(([f]) => f === look.fit)?.[2]}</p>
              </div>
            )}
            {isMedia && look && look.fit === 'fill' && media.url && (
              <FocusPicker url={media.url} video={media.video} focus={look.focus} onChange={(focus) => tweak({ focus })} />
            )}
            {isMedia && look?.fit === 'tile' && (
              <Slider label={t('bgTileSize')} min={80} max={1200} step={20} value={look.tile} format={(v) => `${v}px`} onChange={(v) => tweak({ tile: v })} />
            )}
            {draft && look && (
              <Slider label={t('bgDim')} min={0} max={60} step={5} value={Math.round(look.dim * 100)} format={(v) => `${v}%`} onChange={(v) => tweak({ dim: v / 100 })} />
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={cancel}>{t('cancel')}</button>
          <button className="btn btn-primary" onClick={apply} disabled={same(draft, applied)}>{t('bgApply')}</button>
        </div>
      </div>
    </Modal>
  )
}

function Slider({ label, min, max, step, value, format, onChange }: {
  label: string; min: number; max: number; step: number; value: number; format: (v: number) => string; onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-xs font-medium text-muted"><span>{label}</span><span className="tabular-nums">{format(value)}</span></span>
      <input type="range" className="w-full accent-[var(--data)]" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  )
}

/** The whole picture with a draggable dot: the point every crop keeps in view. Arrow keys move it too. */
function FocusPicker({ url, video, focus, onChange }: { url: string; video: boolean; focus: { x: number; y: number }; onChange: (f: { x: number; y: number }) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const clamp = (v: number) => Math.min(1, Math.max(0, Math.round(v * 1000) / 1000))
  const at = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    onChange({ x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) })
  }
  const key = (e: KeyboardEvent) => {
    const d = e.shiftKey ? 0.1 : 0.02
    const m: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }
    if (!m[e.key]) return
    e.preventDefault()
    onChange({ x: clamp(focus.x + m[e.key][0]), y: clamp(focus.y + m[e.key][1]) })
  }
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium text-muted">{t('bgFocus')}</h3>
      <p className="mb-2 text-[13px] text-muted">{t('bgFocusHint')}</p>
      <div ref={box} className="relative cursor-crosshair touch-none select-none overflow-hidden rounded-[8px]"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e) }}
        onPointerMove={(e) => { if (e.buttons) at(e) }}>
        {video
          ? <video className="block max-h-56 w-full object-contain" src={url} muted loop autoPlay playsInline />
          : <img className="block max-h-56 w-full object-contain" src={url} alt="" draggable={false} />}
        <button type="button" role="slider" aria-label={t('bgFocus')} aria-valuetext={`${Math.round(focus.x * 100)}%, ${Math.round(focus.y * 100)}%`}
          onKeyDown={key}
          className="absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-data/80 shadow-[0_0_0_2px_rgba(0,0,0,.35)]"
          style={{ left: `${focus.x * 100}%`, top: `${focus.y * 100}%` }} />
      </div>
    </div>
  )
}

// --- previews ---

/** Width of an element, kept current. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.offsetWidth))
    ro.observe(el)
    setW(el.offsetWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** A desktop and a phone frame at the real aspect ratios, so the crop on each is visible before applying. */
function Previews({ bg }: { bg: Background | null }) {
  return (
    <div className="flex items-end gap-4" aria-label={t('bgPreview')}>
      <Frame bg={bg} label={t('bgDesktop')} aspect="16 / 10" reference={1280} className="min-w-0 flex-1" columns={3} />
      <Frame bg={bg} label={t('bgPhone')} aspect="9 / 19.5" reference={390} className="w-[22%] max-w-32 shrink-0" columns={1} />
    </div>
  )
}

function Frame({ bg, label, aspect, reference, className, columns }: {
  bg: Background | null; label: string; aspect: string; reference: number; className: string; columns: number
}) {
  const [ref, w] = useWidth()
  // Re-key the media so a new source starts fresh instead of flashing the previous picture.
  const [k, setK] = useState(0)
  useEffect(() => setK((n) => n + 1), [bg?.kind, bg?.kind === 'file' ? bg.path : bg?.kind === 'url' ? bg.url : bg?.kind === 'preset' ? bg.id : ''])
  return (
    <figure className={className}>
      <div ref={ref} className="relative isolate overflow-hidden rounded-[10px] bg-ground ring-1 ring-line" style={{ aspectRatio: aspect }}>
        {bg && <BoardBackground key={k} bg={bg} scale={w ? w / reference : 1} />}
        <div className="flex h-full gap-[3%] p-[4%]">
          {Array.from({ length: columns }, (_, i) => (
            <div key={i} className="flex h-[70%] flex-col gap-[6%] rounded-[6px] bg-raised/90 p-[3%]" style={{ width: columns === 1 ? '100%' : '24%' }}>
              {Array.from({ length: 3 - (i % 2) }, (_, j) => <div key={j} className="h-[14%] rounded-[3px] bg-surface" />)}
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mt-1.5 text-center text-xs text-muted">{label}</figcaption>
    </figure>
  )
}
