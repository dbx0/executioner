import type { JSX, ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils.js'

const SIZES = {
  sm: 'w-[420px]',
  md: 'w-[520px]',
  lg: 'w-[680px]',
  xl: 'w-[860px]',
} as const

export interface DialogProps {
  /** Defaults to open: most modals are mounted only while they show. */
  open?: boolean
  /** Escape, a click outside, or the header close button. */
  onClose: () => void
  /**
   * The accessible name, when it should differ from the visible `DialogHeader`
   * title or when there is no header. Without it the header title names the dialog.
   */
  label?: string
  size?: keyof typeof SIZES
  /** False while work is in flight (or for a step the user must finish): Escape and outside clicks do nothing. */
  dismissable?: boolean
  /** Stack above another dialog: a confirm raised from inside a modal. */
  raised?: boolean
  className?: string
  children: ReactNode
}

/**
 * The one modal shell: a dimmed ground and a floating popover surface with
 * header, body and footer slots. Built on Radix Dialog, so focus is trapped
 * and restored, Escape closes, and the rest of the app is inert while it shows.
 *
 * Compose it as `<Dialog><DialogHeader /><DialogBody /><DialogFooter /></Dialog>`.
 * A dialog with no `DialogHeader` must pass `label`.
 */
export function Dialog({
  open = true,
  onClose,
  label,
  size = 'md',
  dismissable = true,
  raised = false,
  className,
  children,
}: DialogProps): JSX.Element {
  const z = raised ? 'z-[75]' : 'z-[60]'
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && dismissable && onClose()}>
      <DialogPrimitive.Portal>
        {/* The overlay is also the centering frame. Centering the content with a
            transform would make it the containing block of every fixed
            descendant (a picker's click-away backdrop), so it is laid out here. */}
        <DialogPrimitive.Overlay
          className={cn('fixed inset-0 grid animate-fade-in place-items-center bg-black/55 p-6 backdrop-blur-[2px]', z)}
        >
          <DialogPrimitive.Content
            // A label replaces the title as the name; Radix would otherwise point
            // aria-labelledby at a title that says something else (or is absent).
            {...(label === undefined ? {} : { 'aria-label': label, 'aria-labelledby': undefined })}
            aria-describedby={undefined}
            className={cn(
              'flex max-h-[88vh] max-w-full flex-col overflow-hidden',
              'rounded-panel border border-glass-border bg-popover text-popover-foreground shadow-floating outline-none',
              SIZES[size],
              className,
            )}
          >
            {children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export interface DialogHeaderProps {
  title: ReactNode
  /** One quiet line under the title. */
  description?: ReactNode
  /** A leading icon or avatar. */
  icon?: ReactNode
  /** Controls on the right, before the close button. */
  actions?: ReactNode
  /** Show the close button. The dialog still closes on Escape without it. */
  closeButton?: boolean
  className?: string
}

/** The title row. Its title is what names the dialog for assistive tech. */
export function DialogHeader({
  title,
  description,
  icon,
  actions,
  closeButton = false,
  className,
}: DialogHeaderProps): JSX.Element {
  return (
    <div className={cn('flex shrink-0 items-center gap-3 border-b border-glass-border px-5 py-3.5', className)}>
      {icon}
      <div className="min-w-0 flex-1">
        <DialogPrimitive.Title className="truncate text-[14px] font-semibold tracking-[-0.01em]">{title}</DialogPrimitive.Title>
        {description !== undefined && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>}
      </div>
      {actions}
      {closeButton && (
        <DialogPrimitive.Close
          aria-label="Close"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-glass-strong hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <X aria-hidden className="size-4" strokeWidth={1.75} />
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

/** A title for a dialog that draws its own heading (or none): pass `className="sr-only"` to hide it. */
export const DialogTitle = DialogPrimitive.Title

/** The scrolling middle of the dialog. */
export function DialogBody({ className, children }: { className?: string; children: ReactNode }): JSX.Element {
  return <div className={cn('scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-5 py-4', className)}>{children}</div>
}

/** The action row: secondary pills first, the primary pill last. */
export function DialogFooter({ className, children }: { className?: string; children: ReactNode }): JSX.Element {
  return (
    <div className={cn('flex shrink-0 items-center justify-end gap-2 border-t border-glass-border px-5 py-3.5', className)}>
      {children}
    </div>
  )
}
