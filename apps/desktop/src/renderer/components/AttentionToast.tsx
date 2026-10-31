import type { JSX } from 'react'
import { Button } from './ui/button.js'

/**
 * The notch an "agent needs you" toast shows. It hangs from the titlebar in the titlebar's own
 * colour, so it reads as part of the window: who is waiting, and a way to go there or put it off.
 * The ask itself is on the browser's yellow bar, so the notch only carries it as a tooltip.
 */
export function AttentionToast({
  who,
  text,
  description,
  actionLabel,
  onAction,
  onDismiss,
}: {
  who: string
  text: string
  description?: string | undefined
  actionLabel: string
  onAction: () => void
  onDismiss: () => void
}): JSX.Element {
  return (
    <div
      role="alert"
      title={description !== undefined && description !== '' ? description : undefined}
      className="app-no-drag mx-auto flex h-[34px] w-fit max-w-[calc(100vw-32px)] items-center gap-2.5 rounded-b-xl border border-t-0 border-border bg-card pl-3.5 pr-1.5 text-[13px] text-foreground"
    >
      <span className="min-w-0 truncate">
        <span className="font-medium text-amber-600 dark:text-amber-400">{who}</span> {text}
      </span>
      <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={onDismiss}>
        Later
      </Button>
      <Button
        size="xs"
        className="shrink-0"
        onClick={() => {
          onAction()
          onDismiss()
        }}
      >
        {actionLabel}
      </Button>
    </div>
  )
}
