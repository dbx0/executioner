import type { JSX } from 'react'
import { Check } from 'lucide-react'
import { cn } from '../../../lib/utils.js'
import { EngagementBadge } from '../../EngagementBadge.js'
import type { Recent } from '../../../store/types.js'

/** Keep the tail of a long path, where the engagement folder actually is. */
function shortPath(p: string): string {
  return p.length <= 44 ? p : `…${p.slice(-43)}`
}

/** "3h ago" / "2d ago" / a date once it is more than a week old. */
function lastOpened(at: number | undefined): string | null {
  if (at === undefined) return null
  const minutes = Math.floor((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(at).toLocaleDateString()
}

/** One remembered engagement: click to select it, double-click to open it. */
function RecentCard(props: {
  recent: Recent
  selected: boolean
  isOpen: boolean
  disabled: boolean
  onSelect: () => void
  onOpen: () => void
}): JSX.Element {
  const { recent } = props
  const when = lastOpened(recent.lastOpenedAt)
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      disabled={props.disabled}
      onClick={props.onSelect}
      onDoubleClick={props.onOpen}
      title={recent.root}
      className={cn(
        'group flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors disabled:opacity-50',
        props.selected
          ? 'border-ring bg-surface-2'
          : 'border-border hover:bg-surface-1',
      )}
    >
      <EngagementBadge
        name={recent.name}
        icon={recent.icon}
        photo={recent.photo}
        className="size-9 shrink-0 rounded-lg bg-secondary text-secondary-foreground"
        emojiClass="text-[18px]"
        initialsClass="text-[12px] font-semibold"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{recent.name}</span>
          {props.isOpen && (
            <span className="shrink-0 rounded border border-border px-1 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
              open
            </span>
          )}
        </span>
        <span className="block truncate text-[11.5px] text-muted-foreground">{shortPath(recent.root)}</span>
        {when !== null && <span className="block text-[11px] text-muted-foreground">{when}</span>}
      </span>
      {props.selected && <Check className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />}
    </button>
  )
}

/** The grid of previously opened engagements shown on the "Open existing" tab. */
export function RecentGrid(props: {
  recents: Recent[]
  openRoots: string[]
  selected: string | undefined
  disabled: boolean
  onSelect: (root: string) => void
  onOpen: (root: string) => void
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2">
      {props.recents.map((r) => (
        <RecentCard
          key={r.root}
          recent={r}
          selected={props.selected === r.root}
          isOpen={props.openRoots.includes(r.root)}
          disabled={props.disabled}
          onSelect={() => props.onSelect(r.root)}
          onOpen={() => props.onOpen(r.root)}
        />
      ))}
    </div>
  )
}
