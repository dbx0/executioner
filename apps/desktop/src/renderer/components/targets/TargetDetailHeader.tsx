import type { JSX } from 'react'
import { X } from 'lucide-react'
import type { TargetDetail } from '../../api/targets.js'
import { cn } from '../../lib/utils.js'
import { Button } from '../ui/button.js'
import { formatDate } from './fact-sections.js'
import { ScopeBadge } from './ScopeBadge.js'

/** Closes the detail pane. Shared by the header and by the states that have no header yet. */
export function CloseDetailButton({ onClose, className }: { onClose: () => void; className?: string }): JSX.Element {
  return (
    <Button variant="glass" size="icon-sm" className={cn('size-7 shrink-0', className)} onClick={onClose} aria-label="Close details">
      <X className="size-3.5" strokeWidth={2} />
    </Button>
  )
}

/** Who this asset is: kind, value, scope verdict and when it was seen. */
export function TargetDetailHeader({
  target,
  onClose,
}: {
  target: TargetDetail
  onClose?: (() => void) | undefined
}): JSX.Element {
  return (
    <header className="flex shrink-0 flex-col gap-1.5">
      <div className="flex items-start gap-3">
        <div className="flex min-h-7 min-w-0 flex-1 items-center gap-2.5">
          <h2 className="truncate font-mono text-[18px] font-medium">{target.value}</h2>
          {/* The tree stays quiet about in-scope rows; here there is one asset
              and room to state its verdict either way. */}
          {target.scopeStatus === 'in' ? (
            <span className="flex h-5 shrink-0 items-center rounded-control bg-[color-mix(in_srgb,var(--status-success)_15%,transparent)] px-2 text-[11px] font-semibold text-status-success">
              in scope
            </span>
          ) : (
            <ScopeBadge status={target.scopeStatus} reason={target.scopeReason} />
          )}
        </div>
        {onClose !== undefined && <CloseDetailButton onClose={onClose} />}
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="capitalize">{target.kind}</span>, first seen {formatDate(target.firstSeen)}, last seen{' '}
        {formatDate(target.lastSeen)}
      </p>
      {/* The verdict is spelled out only when it needs a decision; an in-scope
          asset would just be repeating what the absent badge already says. */}
      {target.scopeStatus !== 'in' && target.scopeReason !== '' && (
        <p className="text-xs text-muted-foreground">{target.scopeReason}</p>
      )}
    </header>
  )
}
