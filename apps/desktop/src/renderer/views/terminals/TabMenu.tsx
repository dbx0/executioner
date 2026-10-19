import type { JSX } from 'react'
import { cn } from '../../lib/utils.js'

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
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1 text-left',
        disabled
          ? 'cursor-not-allowed text-tertiary-foreground'
          : 'hover:bg-surface-3',
      )}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {shortcut !== undefined && (
        <span className="ml-auto text-[11px] tracking-wide text-muted-foreground">{shortcut}</span>
      )}
    </button>
  )
}

export function TabMenuSeparator(): JSX.Element {
  return <div className="-mx-1 my-1 h-px bg-border" />
}
