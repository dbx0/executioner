import type { JSX } from 'react'
import { Spinner } from '../../components/ui/spinner.js'
import { CANVAS_CAPSULE } from '../../components/canvas/surface.js'
import { cn } from '../../lib/utils.js'

/**
 * The capsule at the bottom of the canvas while a run is in flight. The engine
 * answers a run request only when the run ends, so this is the loader for that
 * wait; the result arrives as a toast.
 */
export function RunStatus(): JSX.Element {
  return (
    <div
      role="status"
      className={cn(
        CANVAS_CAPSULE,
        'absolute bottom-0 left-1/2 z-10 h-[38px] -translate-x-1/2 gap-2.5 border border-glass-border px-4 text-[13px]',
      )}
    >
      <Spinner size="sm" className="text-status-running" />
      Running workflow
    </div>
  )
}
