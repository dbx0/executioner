import type { JSX } from 'react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageCircleQuestion } from 'lucide-react'
import { Button } from '../../components/ui/button.js'

/**
 * The full view of what an agent asked the operator for. The pane's amber bar is only a
 * trigger: it truncates, so the whole message (which can run to several paragraphs) and the
 * reply box live here. Rendered through a portal to the body so it counts as an overlay and
 * parks the native browser views that would otherwise draw over it.
 *
 * "Submit" answers the agent (its browser_ask_operator call is blocked until then) and takes
 * an optional reply, for example an MFA code to type. "Answer later" just closes this view and
 * leaves the ask pending, so the bar stays and the operator can come back to it.
 */
export function BrowserAskModal({
  who,
  message,
  onSubmit,
  onClose,
}: {
  who: string
  message: string
  onSubmit: (reply: string | undefined) => void
  onClose: () => void
}): JSX.Element {
  const [reply, setReply] = useState('')
  const submit = (): void => {
    const text = reply.trim()
    onSubmit(text === '' ? undefined : text)
  }
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Agent needs you in the browser"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        className="flex max-h-[80vh] w-[520px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <MessageCircleQuestion className="size-4 shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={1.75} />
          <span className="text-[14px] font-medium">
            <span className="text-amber-600 dark:text-amber-400">{who}</span> needs you in the browser
          </span>
        </div>
        <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground">{message}</p>
        </div>
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
          <textarea
            aria-label="Reply to the agent"
            placeholder="Reply (optional), for example a code to type"
            spellCheck={false}
            autoFocus
            rows={2}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            className="scrollbar-sleek max-h-32 min-h-[2.25rem] w-full resize-none rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-border-strong"
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Answer later
            </Button>
            <Button size="sm" onClick={submit}>
              Submit
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
