import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, type StoredEv } from '../lib/db'
import { sortByPos } from '../lib/frac'
import type { Attachment, Card, Label, State } from '../lib/model'
import { addComment, addNewLabel, attachFiles, moveCard, removeAttachment, updateCard, updateLabel } from '../lib/actions'
import { keyAt } from '../lib/frac'
import { describeRows } from '../lib/describe'
import { Icon, LABEL_COLORS, LabelPill, Markdown, Modal, Popover, PRIORITY, fmtSize, fmtTime, useAttachmentUrl } from './ui'

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
          <textarea rows={1} disabled={ro} defaultValue={card.title} aria-label="Title"
            className="field min-h-0 flex-1 resize-none border-transparent bg-transparent px-1 text-[20px] font-semibold leading-tight hover:border-line"
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== card.title) updateCard(card, { title: v }) }}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())} />
          <button onClick={onClose} aria-label="Close" className="rounded p-1.5 text-muted hover:bg-raised"><Icon name="x" size={18} /></button>
        </div>
        {card.deleted && (
          <div className="mt-3 flex items-center justify-between rounded-[6px] bg-raised px-3 py-2 text-sm">
            This card is deleted.
            {!readOnly && <button className="btn btn-quiet" onClick={() => updateCard(card, { deleted: false })}>Restore</button>}
          </div>
        )}

        <div className="mt-4 grid gap-6 md:grid-cols-[1fr_200px]">
          <div className="min-w-0 space-y-6">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold">Description</h3>
                {!ro && !editing && <button className="btn btn-ghost h-7 text-xs" onClick={() => { setDesc(card.description); setEditing(true) }}>Edit</button>}
              </div>
              {editing ? (
                <>
                  <textarea autoFocus rows={8} className="field font-[inherit]" value={desc} onChange={(e) => setDesc(e.target.value)}
                    placeholder="Markdown. Paste or drop an image to attach it." />
                  <div className="mt-2 flex gap-1">
                    <button className="btn btn-primary" onClick={() => { if (desc !== card.description) updateCard(card, { description: desc }); setEditing(false) }}>Save</button>
                    <button className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
                  </div>
                </>
              ) : card.description ? (
                <div onDoubleClick={() => !ro && (setDesc(card.description), setEditing(true))}><Markdown text={card.description} attachments={card.attachments} /></div>
              ) : (
                <p className="text-muted">No description.</p>
              )}
            </section>

            <section>
              <h3 className="mb-2 font-semibold">
                Checklist {card.checklist.length > 0 && <span className="font-normal text-muted">{card.checklist.filter((i) => i.done).length}/{card.checklist.length}</span>}
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
                      <button aria-label="Remove item" className="text-muted opacity-0 group-hover:opacity-100"
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
                  <input className="field" placeholder="Add an item" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
                </form>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold">Attachments</h3>
                {!ro && (
                  <label className="btn btn-ghost h-7 cursor-pointer text-xs">
                    <Icon name="clip" size={14} /> Attach
                    <input type="file" multiple className="hidden" onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
                  </label>
                )}
              </div>
              {atts.length ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {atts.map((a) => <AttachmentTile key={a.id} att={a} card={card} ro={ro} onOpen={() => setLightbox(a)} />)}
                </div>
              ) : <p className="text-muted">Paste, drop or attach files.</p>}
            </section>

            <section>
              <div className="mb-2 flex gap-1">
                {(['comments', 'timeline'] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} className={`btn h-7 ${tab === t ? 'btn-quiet' : 'btn-ghost text-muted'}`}>
                    {t === 'comments' ? `Comments ${card.comments.length || ''}` : 'Timeline'}
                  </button>
                ))}
              </div>
              {tab === 'comments' ? (
                <>
                  {!ro && (
                    <form onSubmit={(e) => { e.preventDefault(); if (comment.trim()) addComment(card, comment.trim()); setComment('') }}>
                      <textarea rows={2} className="field" placeholder="Write a comment" value={comment} onChange={(e) => setComment(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit() }} />
                      {comment && <button className="btn btn-primary mt-1.5">Comment</button>}
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
            <Field label="Column">
              <select disabled={ro} className="field" value={card.columnId} onChange={(e) => {
                const to = e.target.value
                const list = sortByPos(Object.values(state.cards).filter((c) => c.columnId === to && !c.deleted))
                moveCard(card, to, keyAt(list, 0))
              }}>
                {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select disabled={ro} className="field" value={card.priority} onChange={(e) => updateCard(card, { priority: e.target.value as Card['priority'] })}>
                {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Due date">
              <input type="date" disabled={ro} className="field" value={card.due ?? ''} onChange={(e) => updateCard(card, { due: e.target.value || null })} />
            </Field>
            <Field label="Labels">
              <LabelPicker card={card} state={state} ro={ro} />
            </Field>
            {card.completedAt && <Field label="Completed"><p>{fmtTime(card.completedAt)}</p></Field>}
            <Field label="Created"><p className="text-muted">{fmtTime(card.createdAt)}</p></Field>
            {!ro && (
              <button className="btn btn-ghost w-full justify-start text-negative" onClick={() => { updateCard(card, { deleted: true }); onClose() }}>
                <Icon name="trash" size={14} /> Delete card
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
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Colour for ${name}`}>
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
        <Popover align="right" button={(t) => (
          <button className="btn btn-ghost h-6 px-2 text-xs text-muted" onClick={() => { setColour(LABEL_COLORS[labels.length % LABEL_COLORS.length]); t() }}>
            <Icon name={applied.length ? 'more' : 'plus'} size={12} /> {applied.length ? 'Edit' : 'Add'}
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
                          onChange={() => toggle(l.id)} aria-label={`Apply ${l.name}`} />
                        <button className="flex-1 text-left" onClick={() => toggle(l.id)}><LabelPill label={l} /></button>
                        <button aria-label={`Edit ${l.name}`} aria-expanded={colouring === l.id} title="Rename, recolour or delete"
                          onClick={() => setColouring(colouring === l.id ? null : l.id)}
                          className="rounded p-1 text-muted hover:bg-sunken hover:text-ink"><Icon name="more" size={14} /></button>
                      </div>
                      {colouring === l.id && (
                        <div className="space-y-2 px-1.5 pb-2 pt-1">
                          <input className="field h-8" defaultValue={l.name} aria-label={`Rename ${l.name}`}
                            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.name) updateLabel(l.id, { name: v }) }} />
                          <Swatches value={l.color} name={l.name} onPick={(c) => updateLabel(l.id, { color: c })} />
                          <button className="btn btn-ghost h-7 px-2 text-negative" onClick={() => {
                            const used = Object.values(state.cards).filter((c) => !c.deleted && c.labels.includes(l.id)).length
                            if (!confirm(`Delete label "${l.name}"?${used ? ` It is on ${used} card${used > 1 ? 's' : ''}.` : ''} It stays in history.`)) return
                            updateLabel(l.id, { deleted: true })
                            setColouring(null)
                          }}><Icon name="trash" size={14} /> Delete label</button>
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
                <input className="field h-8" placeholder="New label" value={name} onChange={(e) => setName(e.target.value)} aria-label="New label name" />
                <Swatches value={colour} name="the new label" onPick={setColour} />
                <button className="btn btn-primary h-7 w-full justify-center" disabled={!name.trim()}>
                  Create {name.trim() && <LabelPill label={{ id: '', name: name.trim(), color: colour, deleted: false }} small />}
                </button>
              </form>
            </div>
          )}
        </Popover>
      )}
      {ro && applied.length === 0 && <span className="text-muted">None</span>}
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
          {pending && <span className="rounded-full bg-[var(--warning)]/15 px-1.5 text-warning">pending upload</span>}
          {card.cover === att.id && <span>cover</span>}
        </div>
        {!ro && (
          <div className="mt-1 flex gap-2 text-muted">
            {isImg && <button className="hover:text-ink" onClick={() => updateCard(card, { cover: card.cover === att.id ? null : att.id })}>{card.cover === att.id ? 'Remove cover' : 'Make cover'}</button>}
            <button className="hover:text-negative" onClick={() => removeAttachment(card, att.id)}>Remove</button>
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
        <span className="truncate">{att.name} · {fmtSize(att.size)}{pendingBlob ? ' · pending upload' : ''}</span>
        <div className="flex gap-1">
          {url && <a className="btn btn-ghost text-white hover:bg-white/10" href={url} download={att.name}><Icon name="download" /> Download</a>}
          <button className="btn btn-ghost text-white hover:bg-white/10" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        {!url ? <p className="text-white/70">Loading…</p>
          : att.mime.startsWith('image/') ? <img src={url} alt={att.name} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
            : <a href={url} download={att.name} className="btn btn-quiet" onClick={(e) => e.stopPropagation()}><Icon name="download" /> Download {att.name}</a>}
      </div>
    </div>
  )
}
