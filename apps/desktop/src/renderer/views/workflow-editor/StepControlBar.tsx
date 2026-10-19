import type { JSX } from 'react'
import { StepForward, FastForward } from 'lucide-react'
import { Button } from '../../components/ui/button.js'

/** Step-through control bar, shown while a stepped execution is in flight. */
export function StepControlBar({
  onNext,
  onResume,
}: {
  onNext: () => void
  onResume: () => void
}): JSX.Element {
  return (
    <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-popover px-3 py-2 shadow-floating">
      <span className="text-[13px] font-medium text-status-running">Stepping</span>
      <span className="h-4 w-px bg-border" />
      <Button size="xs" onClick={onNext}>
        <StepForward className="size-3.5" strokeWidth={2} />
        Next
      </Button>
      <Button variant="outline" size="xs" onClick={onResume}>
        <FastForward className="size-3.5" strokeWidth={2} />
        Resume
      </Button>
    </div>
  )
}
