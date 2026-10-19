import type { JSX } from 'react'
import type { SessionState } from '../../store.js'
import { cn } from '../../lib/utils.js'

export function AgentStatusDot({ state, className }: { state: SessionState; className?: string }): JSX.Element {
  if (state === 'working') {
    return (
      <span
        className={cn('size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-activity border-t-transparent', className)}
        aria-label="working"
      />
    )
  }
  return <span className={cn('size-2 shrink-0 rounded-full bg-status-success', className)} aria-label="idle" />
}
