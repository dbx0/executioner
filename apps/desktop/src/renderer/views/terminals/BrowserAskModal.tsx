import type { JSX } from 'react'
import { useState } from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../../components/ui/dialog.js'
import { Textarea } from '../../components/ui/textarea.js'

/**
 * The full view of what an agent asked the operator for. The pane's amber bar is only a
 * trigger: it truncates, so the whole message (which can run to several paragraphs) and the
 * reply box live here. The dialog mounts on the body, outside any pane, so it counts as an
 * overlay and parks the native browser views that would otherwise draw over it.
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
  return (
    <Dialog onClose={onClose} label="Agent needs you in the browser">
      <DialogHeader
        icon={<MessageCircleQuestion className="size-4 shrink-0 text-attention" strokeWidth={1.75} />}
        title={
          <>
            <span className="text-attention">{who}</span> needs you in the browser
          </>
        }
      />
      <DialogBody>
        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground">{message}</p>
      </DialogBody>
      <DialogFooter className="flex-col items-stretch gap-2.5">
        <Textarea
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
          className="max-h-32 min-h-[2.75rem] text-[13px]"
        />
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Answer later
          </Button>
          <Button size="sm" onClick={submit}>
            Submit
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}
