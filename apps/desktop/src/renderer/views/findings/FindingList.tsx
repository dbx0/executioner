import type { JSX } from 'react'
import type { Finding } from '../../api/findings.js'
import { ScrollArea } from '../../components/ui/scroll-area.js'
import { cn } from '../../lib/utils.js'
import { SeverityDot, StatusChip, severityLabel, severityTextClass } from './chips.js'

/** The shape one list row takes, shared with the skeleton so loaded rows land in place. */
export const FINDING_ROW_CLASS = 'flex w-full min-w-0 shrink-0 flex-col gap-[5px] rounded-xl px-3 py-2.5 text-left'

/** The padded column the rows sit in, inside the list panel. */
export const FINDING_ROWS_CLASS = 'flex min-w-0 flex-col gap-0.5 p-2'

/**
 * The findings list: worst severity first, as the engine returns them. A row is
 * two lines: severity dot, title and status, then the asset with the severity
 * and the source that filed it. The whole row opens the finding.
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
  /** target id to value, so a row can name the asset rather than an id. */
  targetValues: Record<string, string>
  /** Findings that just arrived; they slide in and flash. */
  newIds: ReadonlySet<string>
  onSelect: (id: string) => void
}): JSX.Element {
  if (findings.length === 0) {
    return (
      <p className="p-4 text-[13px] leading-relaxed text-muted-foreground">
        Nothing recorded yet. A workflow&apos;s <code className="font-mono">save_to_finding</code> node, an agent, or
        the New finding button puts things here.
      </p>
    )
  }

  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
      <div className={FINDING_ROWS_CLASS}>
        {findings.map((f) => {
          const selected = f.id === selectedId
          return (
            <button
              key={f.id}
              type="button"
              data-new={newIds.has(f.id) ? 'true' : undefined}
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelect(f.id)}
              className={cn(
                newIds.has(f.id) && 'motion-safe:animate-enter-down-flash-red',
                FINDING_ROW_CLASS,
                'outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                selected ? 'bg-glass-active' : 'hover:bg-glass-strong',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <SeverityDot severity={f.severity} className="size-2" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{f.title}</span>
                <StatusChip status={f.status} />
              </span>
              {/* Indented past the dot, so the second line reads as belonging to the title. */}
              <span className="flex min-w-0 justify-between gap-2 pl-4 text-[11px] text-muted-foreground">
                <span className="min-w-0 truncate font-mono">
                  {f.targetId === null ? 'no target' : (targetValues[f.targetId] ?? f.targetId.slice(0, 8))}
                </span>
                <span className="shrink-0">
                  <span className={cn('font-semibold', severityTextClass(f.severity))}>{severityLabel(f.severity)}</span>,{' '}
                  {f.source}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </ScrollArea>
  )
}
