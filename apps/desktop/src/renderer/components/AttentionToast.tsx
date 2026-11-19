import type { JSX } from 'react'
import { Button } from './ui/button.js'

/**
 * The notch an "agent needs you" toast shows. It hangs from the top edge of the window with no top
 * border, so it reads as part of the window: who is waiting, and a way to go there or put it off.
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
      className="app-no-drag mx-auto flex h-[34px] w-fit max-w-[calc(100vw-32px)] items-center gap-2.5 rounded-b-panel border border-t-0 border-glass-border bg-popover pl-4 pr-1.5 text-[13px] text-popover-foreground shadow-floating"
    >
      <span className="min-w-0 truncate">
        <span className="font-medium text-attention">{who}</span> {text}
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
