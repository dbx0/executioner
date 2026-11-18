import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { isDarwin } from './platform.js'

type WindowAction = 'minimize' | 'maximize' | 'close'

function ControlButton({
  action,
  label,
  className,
  children,
}: {
  action: WindowAction
  label: string
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => window.executioner.windowControl(action)}
      className={cn(
        'grid size-[30px] shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className ?? 'hover:bg-glass-active hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

/**
 * Minimize, maximize and close for Windows and Linux, where the window is
 * frameless and has no native buttons. It is a vertical capsule so it fits the
 * 56px tool column at the top-right of the window, close nearest the corner.
 * Renders nothing on macOS: the native traffic lights do this job there.
 */
export function WindowControls({ className }: { className?: string }): JSX.Element | null {
  const [maximized, setMaximized] = useState(false)
  const native = isDarwin()
  useEffect(() => {
    if (native) return
    return window.executioner.onMaximizedChange(setMaximized)
  }, [native])
  if (native) return null

  return (
    <div
      role="group"
      aria-label="Window"
      className={cn('glass-panel app-no-drag flex w-10 shrink-0 flex-col items-center gap-1 rounded-control py-[5px]', className)}
    >
      <ControlButton action="close" label="Close" className="hover:bg-destructive hover:text-destructive-foreground">
        <X className="size-4" strokeWidth={1.75} />
      </ControlButton>
      <ControlButton action="maximize" label={maximized ? 'Restore' : 'Maximize'}>
        {maximized ? (
          <Copy className="size-3.5 -scale-x-100" strokeWidth={1.75} />
        ) : (
          <Square className="size-3.5" strokeWidth={1.75} />
        )}
      </ControlButton>
      <ControlButton action="minimize" label="Minimize">
        <Minus className="size-4" strokeWidth={1.75} />
      </ControlButton>
    </div>
  )
}
