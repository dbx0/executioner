import type { JSX } from 'react'
import { ClaudeLogo } from '../../components/brand/ClaudeLogo.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../../components/ui/dropdown-menu.js'
import { Spinner } from '../../components/ui/spinner.js'
import type { LimitWindow, ProviderLimits } from '../../api/usage-limits.js'
import { formatResetDuration, MeterBar, UsagePanel } from '../UsagePanel.js'
import { useUsageLimits } from '../useUsageLimits.js'

export interface UsageLine {
  percent: number
  /** "18% used" */
  used: string
  /** "resets 4h 12m", or the window's name when its reset time is unknown. */
  detail: string
}

/**
 * The one window worth a line in the footer: the most consumed. The popover
 * carries all of them; the sidebar has room for one.
 */
export function tightestWindow(p: ProviderLimits, now: number = Date.now()): UsageLine | null {
  const detail = (w: LimitWindow, name: string): string =>
    w.resetsAt !== null ? `resets ${formatResetDuration(w.resetsAt - now)}` : name
  const windows: { percent: number; detail: string }[] = []
  if (p.five_hour) windows.push({ percent: p.five_hour.percent, detail: detail(p.five_hour, '5 hour window') })
  if (p.weekly) windows.push({ percent: p.weekly.percent, detail: detail(p.weekly, 'weekly') })
  if (p.fable) windows.push({ percent: p.fable.percent, detail: 'Fable' })
  const finite = windows.filter((w) => Number.isFinite(w.percent))
  if (finite.length === 0) return null
  const top = finite.reduce((a, b) => (b.percent > a.percent ? b : a))
  return { percent: top.percent, used: `${Math.round(top.percent)}% used`, detail: top.detail }
}

/**
 * Account usage in the sidebar footer: the Claude mark over one short line and
 * a meter of the most consumed window. Clicking it opens the detailed usage
 * popover (Claude and Codex rows, with a manual refresh).
 */
export function UsageMeter(): JSX.Element {
  const { limits, isFetching, isLoading, refresh } = useUsageLimits()
  const claude = limits?.claude ?? null
  const healthy = claude !== null && claude.error === null
  const line = healthy ? tightestWindow(claude) : null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account usage and rate limits"
          aria-busy={isLoading}
          className="flex min-w-0 flex-1 select-none items-center gap-2.5 rounded-[10px] text-left text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ClaudeLogo className="size-4 shrink-0" />
          {isLoading ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <Spinner size="xs" />
              <span className="truncate">Checking usage</span>
            </span>
          ) : (
            <span className="flex min-w-0 flex-1 flex-col gap-[5px]">
              <span className="flex justify-between gap-2 tabular-nums">
                {line !== null ? (
                  <>
                    <span className="shrink-0">{line.used}</span>
                    <span className="truncate">{line.detail}</span>
                  </>
                ) : (
                  <span className="truncate">{healthy ? 'No account limits' : 'Usage unavailable'}</span>
                )}
              </span>
              <MeterBar percent={line?.percent ?? 0} className="h-1" />
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={14} className="rounded-panel border-glass-border p-1">
        <UsagePanel limits={limits} isFetching={isFetching} onRefresh={refresh} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
