import type { JSX, ReactNode } from 'react'
import { POPOVER_SEPARATOR, POPOVER_SURFACE } from '../../components/ui/surface.js'
import { cn } from '../../lib/utils.js'

/**
 * The floating surface of a tab or pane context menu, at a pointer position,
 * over a full-window catcher that dismisses it on any outside click or second
 * right-click.
 */
export function TabMenuSurface({
  x,
  y,
  onClose,
  children,
}: {
  x: number
  y: number
  onClose: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <div
      className="app-no-drag pointer-events-auto fixed inset-0 z-[70] cursor-default"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div
        role="menu"
        // The position is the pointer's, which no class can name.
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
        className={cn(POPOVER_SURFACE, 'fixed z-[71] min-w-[200px] p-1 text-[13px] font-normal')}
      >
        {children}
      </div>
    </div>
  )
}

export function TabMenuItem({
  onClick,
  disabled = false,
  icon,
  shortcut,
  children,
}: {
  onClick: () => void
  disabled?: boolean | undefined
  icon?: JSX.Element | undefined
  shortcut?: string | undefined
  children: ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-left outline-none transition-colors',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        disabled ? 'cursor-not-allowed text-tertiary-foreground' : 'hover:bg-glass-strong',
      )}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {shortcut !== undefined && <span className="ml-auto text-[11px] tracking-wide text-muted-foreground">{shortcut}</span>}
    </button>
  )
}

export function TabMenuSeparator(): JSX.Element {
  return <div aria-hidden className={POPOVER_SEPARATOR} />
}
