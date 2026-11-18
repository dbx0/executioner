import type { JSX } from 'react'
import { StepForward, FastForward } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Spinner } from '../../components/ui/spinner.js'
import { CANVAS_CAPSULE } from '../../components/canvas/surface.js'
import { cn } from '../../lib/utils.js'

/** Step-through control bar, shown while a stepped execution is in flight. */
export function StepControlBar({
  onNext,
  onResume,
  stepping = false,
}: {
  onNext: () => void
  onResume: () => void
  /** A Next request is on its way to the engine. */
  stepping?: boolean
}): JSX.Element {
  return (
    <div className={cn(CANVAS_CAPSULE, 'absolute bottom-0 left-1/2 z-20 h-10 -translate-x-1/2 gap-2 border border-glass-border pl-4 pr-1.5')}>
      <span className="text-[13px] font-medium text-status-running">Stepping</span>
      <Button size="xs" className="h-7" disabled={stepping} onClick={onNext}>
        {stepping ? <Spinner size="xs" /> : <StepForward className="size-3.5" strokeWidth={2} />}
        Next
      </Button>
      <Button variant="glass" size="xs" className="h-7" onClick={onResume}>
        <FastForward className="size-3.5" strokeWidth={2} />
        Resume
      </Button>
    </div>
  )
}
