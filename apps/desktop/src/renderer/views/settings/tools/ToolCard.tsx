import type { JSX } from 'react'
import { Check, Download, Unplug, X } from 'lucide-react'
import { Button } from '../../../components/ui/button.js'
import { Spinner } from '../../../components/ui/spinner.js'
import { SettingsCard, StatusPill, VersionChip } from '../parts.js'
import type { ToolInfo } from '../../../api/tools.js'

/**
 * A tool's state on the connection being viewed. `unreachable` is distinct from
 * `missing`: the tool may well be installed, we just could not ask the host.
 */
export type CardState = 'checking' | 'installed' | 'missing' | 'unreachable'

/** The status badge: one consistent badge whose state is the card's state. */
export function StatusBadge({ state }: { state: CardState }): JSX.Element {
  if (state === 'checking') {
    return (
      <StatusPill tone="neutral" icon={<Spinner size="xs" />}>
        Checking
      </StatusPill>
    )
  }
  if (state === 'installed') {
    return (
      <StatusPill tone="success" icon={<Check className="size-3" strokeWidth={2.5} />}>
        Installed
      </StatusPill>
    )
  }
  if (state === 'unreachable') {
    return (
      <StatusPill tone="neutral" icon={<Unplug className="size-3" strokeWidth={2.5} />}>
        Unknown
      </StatusPill>
    )
  }
  return (
    <StatusPill tone="danger" icon={<X className="size-3" strokeWidth={2.5} />}>
      Missing
    </StatusPill>
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
    <SettingsCard className="p-3.5">
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
          <Button variant="glass" size="sm" className="shrink-0" onClick={onInstall}>
            <Download className="size-3.5" /> Install
          </Button>
        )}
      </div>
    </SettingsCard>
  )
}
