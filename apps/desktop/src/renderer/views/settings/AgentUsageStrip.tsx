import type { JSX } from 'react'
import { RefreshCw, Zap } from 'lucide-react'
import { Spinner } from '../../components/ui/spinner.js'
import type { ProviderLimits } from '../../api/usage-limits.js'
import { clampPercent, meterFillColor, formatResetCountdown } from '../../app-shell/UsagePanel.js'

/** A single labeled usage meter (color-mix fill: tokens are hex). */
function Meter({ label, percent }: { label: string; percent: number }): JSX.Element {
  const width = clampPercent(percent)
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="relative block h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-glass-strong">
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${width}%`, backgroundColor: meterFillColor(percent) }}
        />
      </span>
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {label} {Math.round(percent)}%
      </span>
    </div>
  )
}

/** The account-usage strip inside the Claude/Codex cards. */
export function UsageStrip({ p, onRetry, retrying }: { p: ProviderLimits; onRetry: () => void; retrying: boolean }): JSX.Element {
  const now = Date.now()
  const meters = [
    p.five_hour ? { key: '5h', label: '5h', percent: p.five_hour.percent } : null,
    p.weekly ? { key: 'wk', label: 'wk', percent: p.weekly.percent } : null,
    p.fable ? { key: 'fable', label: 'Fable', percent: p.fable.percent } : null,
  ].filter((m): m is { key: string; label: string; percent: number } => m !== null)
  // The engine serves the last-known numbers on a transient failure, so meters
  // may be present even with an error set: show the numbers, note the error.
  const reset = formatResetCountdown(p.five_hour?.resetsAt ?? null, now)

  return (
    <div className="mt-3 flex flex-col gap-1.5 rounded-[10px] border border-glass-border bg-glass px-3 py-2">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Account usage
        {reset !== null && (
          <span className="ml-auto flex items-center gap-1 normal-case tracking-normal text-muted-foreground">
            <Zap className="size-3" /> {reset}
          </span>
        )}
      </div>
      {meters.length > 0 ? (
        <div className="flex items-center gap-3">
          {meters.map((m) => (
            <Meter key={m.key} label={m.label} percent={m.percent} />
          ))}
        </div>
      ) : null}
      {p.error !== null && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{p.error}</span>
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-muted-foreground outline-none transition-colors hover:bg-glass-strong hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
          >
            {retrying ? <Spinner size="xs" /> : <RefreshCw className="size-3" />} Retry
          </button>
        </div>
      )}
    </div>
  )
}
