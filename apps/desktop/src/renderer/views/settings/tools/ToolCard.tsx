import type { JSX } from 'react'
import { Check, Download, Loader2, Unplug, X } from 'lucide-react'
import { Button } from '../../../components/ui/button.js'
import type { ToolInfo } from '../../../api/tools.js'

/**
 * A tool's state on the connection being viewed. `unreachable` is distinct from
 * `missing`: the tool may well be installed, we just could not ask the host.
 */
export type CardState = 'checking' | 'installed' | 'missing' | 'unreachable'

/** The status badge — one consistent badge whose state is the card's state. */
export function StatusBadge({ state }: { state: CardState }): JSX.Element {
  if (state === 'checking') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Checking
      </span>
    )
  }
  if (state === 'installed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--status-success)_16%,transparent)] px-2 py-0.5 text-[11px] font-medium text-status-success">
        <Check className="size-3" strokeWidth={2.5} /> Installed
      </span>
    )
  }
  if (state === 'unreachable') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <Unplug className="size-3" strokeWidth={2.5} /> Unknown
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--destructive)_16%,transparent)] px-2 py-0.5 text-[11px] font-medium text-destructive">
      <X className="size-3" strokeWidth={2.5} /> Missing
    </span>
  )
}

/** The version chip — a separate badge, shown only when a version is known. */
export function VersionChip({ version }: { version: string }): JSX.Element {
  return (
    <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
      {version}
    </span>
  )
}

/** The list of node names using a program, truncated to a "+N more" tail. */
export function UsedBy({ names }: { names: string[] }): JSX.Element {
  const shown = names.slice(0, 4)
  const extra = names.length - shown.length
  const text = extra > 0 ? `${shown.join(', ')} +${extra} more` : shown.join(', ')
  return <div className="mt-1 truncate text-[11px] text-muted-foreground">Used by {text}</div>
}

/** One tool card: program name (mono), used-by nodes, status + version, Install. */
export function ToolCard({
  tool,
  state,
  version,
  onInstall,
}: {
  tool: ToolInfo
  state: CardState
  version: string | null
  onInstall: () => void
}): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13.5px] font-semibold">{tool.program}</span>
            <StatusBadge state={state} />
            {state === 'installed' && version != null && <VersionChip version={version} />}
          </div>
          <UsedBy names={tool.usedBy} />
        </div>
        {state === 'missing' && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={onInstall}>
            <Download className="mr-1.5 size-3.5" /> Install
          </Button>
        )}
      </div>
    </div>
  )
}
