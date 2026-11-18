import type { JSX } from 'react'
import { Container, Laptop, Server } from 'lucide-react'
import { cn } from '../../../lib/utils.js'
import { segmentClass } from '../../../components/ui/segmented.js'
import { Skeleton } from '../../../components/ui/skeleton.js'
import type { BackendKind } from '../../../api/backends.js'
import { SettingsCard } from '../parts.js'

/** One tab: the engine host, or a saved connection. */
export interface Tab {
  id: string
  label: string
  kind: BackendKind
  /** A one-line description of where this tab probes, for the install modal. */
  where: string
}

function kindIcon(kind: BackendKind): typeof Laptop {
  return kind === 'docker' ? Container : kind === 'ssh' ? Server : Laptop
}

/** The tab strip. Only rendered when there is more than one connection to show. */
export function TabStrip({
  tabs,
  active,
  onSelect,
  missingFor,
}: {
  tabs: Tab[]
  active: string
  onSelect: (id: string) => void
  missingFor: (id: string) => number | null
}): JSX.Element {
  return (
    <div role="tablist" aria-label="Connection" className="glass-capsule mb-3 inline-flex max-w-full flex-wrap items-center gap-0.5 p-[3px]">
      {tabs.map((tab) => {
        const Icon = kindIcon(tab.kind)
        const missing = missingFor(tab.id)
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => onSelect(tab.id)}
            className={cn(segmentClass(active === tab.id), 'h-[26px] px-3 text-xs')}
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
            {tab.label}
            {missing !== null && missing > 0 && <span className="tabular-nums text-destructive">{missing}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** The tool cards while the catalog itself is still loading, in the card shape it resolves to. */
export function ToolListSkeleton(): JSX.Element {
  return (
    <div role="status" aria-label="Loading tools" className="flex flex-col gap-3">
      {[0, 1, 2, 3].map((i) => (
        <SettingsCard key={i} className="flex flex-col gap-2 p-3.5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-2/3" />
        </SettingsCard>
      ))}
    </div>
  )
}
