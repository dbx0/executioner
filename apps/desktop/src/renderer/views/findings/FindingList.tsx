import type { JSX } from 'react'
import type { Finding } from '../../api/findings.js'
import { ScrollArea } from '../../components/ui/scroll-area.js'
import { cn } from '../../lib/utils.js'
import { SeverityChip, SourceChip, StatusChip } from './chips.js'

/**
 * The findings list: worst severity first, as the engine returns them. Clicking
 * a title opens it — the title is the whole row's target, so there is nothing to
 * hunt for.
 */
export function FindingList({
  findings,
  selectedId,
  targetValues,
  newIds,
  onSelect,
}: {
  findings: Finding[]
  selectedId: string | null
  /** target id → value, so a row can name the asset rather than an id. */
  targetValues: Record<string, string>
  /** Findings that just arrived; they slide in and flash. */
  newIds: ReadonlySet<string>
  onSelect: (id: string) => void
}): JSX.Element {
  if (findings.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Nothing recorded yet. A workflow&apos;s <code className="font-mono">save_to_finding</code> node, an agent, or
        the New finding button puts things here.
      </p>
    )
  }

  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
      {findings.map((f) => (
        <button
          key={f.id}
          type="button"
          data-new={newIds.has(f.id) ? 'true' : undefined}
          onClick={() => onSelect(f.id)}
          className={cn(
            newIds.has(f.id) && 'motion-safe:animate-enter-down-flash-red',
            'flex w-full min-w-0 flex-col gap-1 border-b border-border/60 px-3 py-2.5 text-left',
            f.id === selectedId
              ? 'selected-surface'
              : 'hover:bg-surface-1',
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <SeverityChip severity={f.severity} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{f.title}</span>
            <StatusChip status={f.status} />
          </div>
          {f.description !== '' && (
            <span className="line-clamp-2 break-words text-[11.5px] text-muted-foreground">{f.description}</span>
          )}
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate font-mono">
              {f.targetId === null ? 'no target' : (targetValues[f.targetId] ?? f.targetId.slice(0, 8))}
            </span>
            <SourceChip source={f.source} />
          </div>
        </button>
      ))}
    </ScrollArea>
  )
}
