import { useEffect, useMemo, useRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { db } from '../lib/db'
import type { Attachment } from '../lib/model'
import { attachmentUrl } from './ui'

// Links leave the app in a new tab: inside an installed PWA a same-tab link strands you with no back button.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') ?? '')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export default function Markdown({ text, attachments }: { text: string; attachments: Record<string, Attachment> }) {
  const html = useMemo(
    // att:<id> would be stripped by the sanitizer; carry it as a fragment and resolve after render.
    () => DOMPurify.sanitize(marked.parse(text.replace(/\(att:([\w-]+)\)/g, '(#att:$1)'), { async: false }) as string),
    [text],
  )
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLImageElement>('img[src^="#att:"]').forEach(async (img) => {
      const id = img.getAttribute('src')!.slice(5)
      const att = attachments[id]
      if (!att) return
      try {
        const pending = await db.blobs.get(att.path)
        if (pending) {
          img.src = URL.createObjectURL(pending.data)
          img.onload = () => URL.revokeObjectURL(img.src)
        } else img.src = await attachmentUrl(att)
      } catch { /* offline or locked: leave the alt text */ }
    })
  }, [html, attachments])
  return <div ref={ref} className="md" dangerouslySetInnerHTML={{ __html: html }} />
}
