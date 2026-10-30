import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, type StoredEv } from '../lib/db'
import { sortByPos } from '../lib/frac'
import type { Attachment, Card, Label, State } from '../lib/model'
import { addComment, addNewLabel, attachFiles, moveCard, removeAttachment, updateCard, updateLabel } from '../lib/actions'
import { keyAt } from '../lib/frac'
import { describeRows } from '../lib/describe'
import { t, tn } from '../i18n'
import { Icon, LABEL_COLORS, LabelPill, Markdown, Modal, Popover, PRIORITIES, priorityName, fmtSize, fmtTime, useAttachmentUrl } from './ui'

export function CardModal({ state, events, cardId, onClose, readOnly }: { state: State; events: StoredEv[]; cardId: string; onClose: () => void; readOnly?: boolean }) {
  const card = state.cards[cardId]
  const [editing, setEditing] = useState(false)
  const [desc, setDesc] = useState(card?.description ?? '')
  const [comment, setComment] = useState('')
  const [newItem, setNewItem] = useState('')
  const [lightbox, setLightbox] = useState<Attachment | null>(null)
  const [tab, setTab] = useState<'comments' | 'timeline'>('comments')
  if (!card) return null
  const board = state.boards[card.boardId]
  const columns = sortByPos(Object.values(board.columns).filter((c) => !c.archived))
  const atts = Object.values(card.attachments).filter((a) => !a.removed).sort((a, b) => a.ts - b.ts)
  const ro = readOnly || card.deleted

  const onFiles = async (files: File[]) => {
    if (!files.length || ro) return
    const ids = await attachFiles(card, files)
    if (editing) setDesc((d) => d + ids.filter((a) => a.mime.startsWith('image/')).map((a) => `\n![](att:${a.id})`).join(''))
  }

  const timeline = describeRows(events.filter((e) => e.payload.cardId === cardId), state).reverse()

  return (
    <Modal onClose={onClose} wide label={card.title}>
      <div className="p-5 sm:p-6"
        onPaste={(e) => onFiles([...e.clipboardData.files])}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onFiles([...e.dataTransfer.files]) }}>
        <div className="flex items-start gap-3">
          <textarea key={card.title} rows={1} disabled={ro} defaultValue={card.title} aria-label={t('title')}
            className="field min-h-0 flex-1 resize-none border-transparent bg-transparent px-1 text-[20px] font-semibold leading-tight hover:border-line"
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== card.title) updateCard(card, { title: v }) }}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())} />
          <button onClick={onClose} aria-label={t('close')} className="rounded p-1.5 text-muted hover:bg-raised"><Icon name="x" size={18} /></button>
        </div>
        {card.deleted && (
          <div className="mt-3 flex items-center justify-between rounded-[6px] bg-raised px-3 py-2 text-sm">
            {t('cardDeleted')}
            {!readOnly && <button className="btn btn-quiet" onClick={() => updateCard(card, { deleted: false })}>{t('restore')}</button>}
          </div>
        )}

        <div className="mt-4 grid gap-6 md:grid-cols-[1fr_200px]">
          <div className="min-w-0 space-y-6">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold">{t('description')}</h3>
                {!ro && !editing && <button className="btn btn-ghost h-7 text-xs" onClick={() => { setDesc(card.description); setEditing(true) }}>{t('edit')}</button>}
              </div>
              {editing ? (
                <>
                  <textarea autoFocus rows={8} className="field font-[inherit]" value={desc} onChange={(e) => setDesc(e.target.value)}
                    placeholder={t('mdPlaceholder')} />
                  <div className="mt-2 flex gap-1">
                    <button className="btn btn-primary" onClick={() => { if (desc !== card.description) updateCard(card, { description: desc }); setEditing(false) }}>{t('save')}</button>
                    <button className="btn btn-ghost" onClick={() => setEditing(false)}>{t('cancel')}</button>
                  </div>
                </>
              ) : card.description ? (
                <div onDoubleClick={() => !ro && (setDesc(card.description), setEditing(true))}><Markdown text={card.description} attachments={card.attachments} /></div>
              ) : (
                <p className="text-muted">{t('noDescription')}</p>
              )}
            </section>

            <section>
              <h3 className="mb-2 font-semibold">
                {t('checklist')} {card.checklist.length > 0 && <span className="font-normal text-muted">{card.checklist.filter((i) => i.done).length}/{card.checklist.length}</span>}
              </h3>
              {card.checklist.length > 0 && (
                <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-raised">
                  <div className="h-full bg-data transition-[width]" style={{ width: `${(card.checklist.filter((i) => i.done).length / card.checklist.length) * 100}%` }} />
                </div>
              )}
              <ul className="space-y-0.5">
                {card.checklist.map((item) => (
                  <li key={item.id} className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-raised">
                    <input type="checkbox" disabled={ro} checked={item.done} className="size-4 accent-[var(--data)]"
                      onChange={() => updateCard(card, { checklist: card.checklist.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) })} />
                    <span className={`flex-1 ${item.done ? 'text-muted line-through' : ''}`}>{item.text}</span>
                    {!ro && (
                      <button aria-label={t('removeItem')} className="text-muted opacity-0 group-hover:opacity-100"
                        onClick={() => updateCard(card, { checklist: card.checklist.filter((i) => i.id !== item.id) })}><Icon name="x" size={14} /></button>
                    )}
                  </li>
                ))}
              </ul>
              {!ro && (
                <form className="mt-1" onSubmit={(e) => {
                  e.preventDefault()
                  if (newItem.trim()) updateCard(card, { checklist: [...card.checklist, { id: uid(), text: newItem.trim(), done: false }] })
                  setNewItem('')
                }}>
                  <input className="field" placeholder={t('addItem')} value={newItem} onChange={(e) => setNewItem(e.target.value)} />
                </form>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold">{t('attachments')}</h3>
                {!ro && (
                  <label className="btn btn-ghost h-7 cursor-pointer text-xs">
                    <Icon name="clip" size={14} /> {t('attach')}
                    <input type="file" multiple className="hidden" onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
                  </label>
                )}
              </div>
              {atts.length ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {atts.map((a) => <AttachmentTile key={a.id} att={a} card={card} ro={ro} onOpen={() => setLightbox(a)} />)}
                </div>
              ) : <p className="text-muted">{t('attachHint')}</p>}
            </section>

            <section>
              <div className="mb-2 flex gap-1">
                {(['comments', 'timeline'] as const).map((k) => (
                  <button key={k} onClick={() => setTab(k)} className={`btn h-7 ${tab === k ? 'btn-quiet' : 'btn-ghost text-muted'}`}>
                    {k === 'comments' ? `${t('comments')} ${card.comments.length || ''}` : t('timeline')}
                  </button>
                ))}
              </div>
              {tab === 'comments' ? (
                <>
                  {!ro && (
                    <form onSubmit={(e) => { e.preventDefault(); if (comment.trim()) addComment(card, comment.trim()); setComment('') }}>
                      <textarea rows={2} className="field" placeholder={t('writeComment')} value={comment} onChange={(e) => setComment(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit() }} />
                      {comment && <button className="btn btn-primary mt-1.5">{t('comment')}</button>}
                    </form>
                  )}
                  <ul className="mt-3 space-y-3">
                    {[...card.comments].reverse().map((c) => (
                      <li key={c.id}>
                        <div className="text-xs text-muted">{c.device} · {fmtTime(c.ts)}</div>
                        <div className="mt-0.5 rounded-[6px] bg-raised px-3 py-2"><Markdown text={c.text} attachments={card.attachments} /></div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <ol className="space-y-2">
                  {timeline.map(({ ev: e, text }) => (
                    <li key={e.id} className="flex gap-3 text-[13px]">
                      <span className="w-28 shrink-0 text-muted">{fmtTime(e.ts)}</span>
                      <span className="flex-1">{text}</span>
                      <span className="text-muted">{e.device}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <Field label={t('column')}>
              <select disabled={ro} className="field" value={card.columnId} onChange={(e) => {
                const to = e.target.value
                const list = sortByPos(Object.values(state.cards).filter((c) => c.columnId === to && !c.deleted))
                moveCard(card, to, keyAt(list, 0))
              }}>
                {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label={t('priority')}>
              <select disabled={ro} className="field" value={card.priority} onChange={(e) => updateCard(card, { priority: e.target.value as Card['priority'] })}>
                {PRIORITIES.map((k) => <option key={k} value={k}>{priorityName(k)}</option>)}
              </select>
            </Field>
            <Field label={t('dueDate')}>
              <input type="date" disabled={ro} className="field" value={card.due ?? ''} onChange={(e) => updateCard(card, { due: e.target.value || null })} />
            </Field>
            <Field label={t('labels')}>
              <LabelPicker card={card} state={state} ro={ro} />
            </Field>
            {card.completedAt && <Field label={t('completed')}><p>{fmtTime(card.completedAt)}</p></Field>}
            <Field label={t('created')}><p className="text-muted">{fmtTime(card.createdAt)}</p></Field>
            {!ro && (
              <button className="btn btn-ghost w-full justify-start text-negative" onClick={() => { updateCard(card, { deleted: true }); onClose() }}>
                <Icon name="trash" size={14} /> {t('deleteCard')}
              </button>
            )}
          </aside>
        </div>
      </div>
      {lightbox && <Lightbox att={lightbox} card={card} ro={ro} onClose={() => setLightbox(null)} />}
    </Modal>
  )
}

function Swatches({ value, onPick, name }: { value: string; onPick: (c: string) => void; name: string }) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t('colourFor', { name })}>
      {LABEL_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c}
          onClick={() => onPick(c)}
          className={`size-6 rounded-full transition-transform hover:scale-110 ${value === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : ''}`}
          style={{ background: c }} />
      ))}
    </div>
  )
}

function LabelPicker({ card, state, ro }: { card: Card; state: State; ro: boolean }) {
  const labels = Object.values(state.labels).filter((l) => !l.deleted)
  const applied = card.labels.map((id) => state.labels[id]).filter((l): l is Label => !!l && !l.deleted)
  const [colouring, setColouring] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [colour, setColour] = useState(LABEL_COLORS[0])
  const toggle = (id: string) =>
    updateCard(card, { labels: card.labels.includes(id) ? card.labels.filter((x) => x !== id) : [...card.labels, id] })

  return (
    <div className="flex flex-wrap items-center gap-1">
      {applied.map((l) => <LabelPill key={l.id} label={l} />)}
      {!ro && (
        <Popover align="right" button={(toggle) => (
          <button className="btn btn-ghost h-6 px-2 text-xs text-muted" onClick={() => { setColour(LABEL_COLORS[labels.length % LABEL_COLORS.length]); toggle() }}>
            <Icon name={applied.length ? 'more' : 'plus'} size={12} /> {applied.length ? t('edit') : t('add')}
          </button>
        )}>
          {() => (
            <div className="w-72 p-1">
              {labels.length > 0 && (
                <ul className="mb-2 space-y-0.5">
                  {labels.map((l) => (
                    <li key={l.id}>
                      <div className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 hover:bg-raised">
                        <input type="checkbox" className="size-4 accent-[var(--data)]" checked={card.labels.includes(l.id)}
                          onChange={() => toggle(l.id)} aria-label={t('applyX', { name: l.name })} />
                        <button className="flex-1 text-left" onClick={() => toggle(l.id)}><LabelPill label={l} /></button>
                        <button aria-label={t('editX', { name: l.name })} aria-expanded={colouring === l.id} title={t('editLabelHint')}
                          onClick={() => setColouring(colouring === l.id ? null : l.id)}
                          className="rounded p-1 text-muted hover:bg-sunken hover:text-ink"><Icon name="more" size={14} /></button>
                      </div>
                      {colouring === l.id && (
                        <div className="space-y-2 px-1.5 pb-2 pt-1">
                          <input className="field h-8" defaultValue={l.name} aria-label={t('renameX', { name: l.name })}
                            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.name) updateLabel(l.id, { name: v }) }} />
                          <Swatches value={l.color} name={l.name} onPick={(c) => updateLabel(l.id, { color: c })} />
                          <button className="btn btn-ghost h-7 px-2 text-negative" onClick={() => {
                            const used = Object.values(state.cards).filter((c) => !c.deleted && c.labels.includes(l.id)).length
                            if (!confirm([t('deleteLabelQ', { name: l.name }), used ? tn('labelUsedOn', used) : '', t('staysInHistory')].filter(Boolean).join(' '))) return
                            updateLabel(l.id, { deleted: true })
                            setColouring(null)
                          }}><Icon name="trash" size={14} /> {t('deleteLabel')}</button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <form className="space-y-2 rounded-[6px] bg-raised p-2" onSubmit={async (e) => {
                e.preventDefault()
                const n = name.trim()
                if (!n) return
                setName('') // clear first: also blocks a double submit while the writes run
                await addNewLabel(card, n, colour)
              }}>
                <input className="field h-8" placeholder={t('newLabel')} value={name} onChange={(e) => setName(e.target.value)} aria-label={t('newLabelName')} />
                <Swatches value={colour} name={t('theNewLabel')} onPick={setColour} />
                <button className="btn btn-primary h-7 w-full justify-center" disabled={!name.trim()}>
                  {t('create')} {name.trim() && <LabelPill label={{ id: '', name: name.trim(), color: colour, deleted: false }} small />}
                </button>
              </form>
            </div>
          )}
        </Popover>
      )}
      {ro && applied.length === 0 && <span className="text-muted">{t('none')}</span>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="mb-1 text-xs font-medium text-muted">{label}</div>{children}</div>
}

function AttachmentTile({ att, card, ro, onOpen }: { att: Attachment; card: Card; ro: boolean; onOpen: () => void }) {
  const isImg = att.mime.startsWith('image/')
  const { url, pending } = useAttachmentUrl(isImg ? att : undefined)
  return (
    <div className="group overflow-hidden rounded-[6px] bg-raised">
      <button onClick={onOpen} className="block h-24 w-full bg-sunken">
        {isImg && url ? <img src={url} alt={att.name} className="h-full w-full object-cover" />
          : <span className="flex h-full items-center justify-center text-muted"><Icon name={isImg ? 'image' : 'file'} size={24} /></span>}
      </button>
      <div className="px-2 py-1.5 text-xs">
        <div className="truncate font-medium">{att.name}</div>
        <div className="flex items-center gap-2 text-muted">
          {fmtSize(att.size)}
          {pending && <span className="rounded-full bg-[var(--warning)]/15 px-1.5 text-warning">{t('pendingUpload')}</span>}
          {card.cover === att.id && <span>{t('coverTag')}</span>}
        </div>
        {!ro && (
          <div className="mt-1 flex gap-2 text-muted">
            {isImg && <button className="hover:text-ink" onClick={() => updateCard(card, { cover: card.cover === att.id ? null : att.id })}>{card.cover === att.id ? t('removeCover') : t('makeCover')}</button>}
            <button className="hover:text-negative" onClick={() => removeAttachment(card, att.id)}>{t('remove')}</button>
          </div>
        )}
      </div>
    </div>
  )
}

function Lightbox({ att, onClose }: { att: Attachment; card: Card; ro: boolean; onClose: () => void }) {
  const { url } = useAttachmentUrl(att)
  const pendingBlob = useLiveQuery(() => db.blobs.get(att.path), [att.path])
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/85 p-4" onClick={onClose}>
      <div className="flex items-center justify-between text-white" onClick={(e) => e.stopPropagation()}>
        <span className="truncate">{att.name} · {fmtSize(att.size)}{pendingBlob ? ` · ${t('pendingUpload')}` : ''}</span>
        <div className="flex gap-1">
          {url && <a className="btn btn-ghost text-white hover:bg-white/10" href={url} download={att.name}><Icon name="download" /> {t('download')}</a>}
          <button className="btn btn-ghost text-white hover:bg-white/10" onClick={onClose} aria-label={t('close')}><Icon name="x" /></button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        {!url ? <p className="text-white/70">{t('loading')}</p>
          : att.mime.startsWith('image/') ? <img src={url} alt={att.name} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
            : <a href={url} download={att.name} className="btn btn-quiet" onClick={(e) => e.stopPropagation()}><Icon name="download" /> {t('downloadX', { name: att.name })}</a>}
      </div>
    </div>
  )
}
