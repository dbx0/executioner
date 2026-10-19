import type { JSX } from 'react'
import { Loader2, RefreshCw, Zap } from 'lucide-react'
import { ClaudeLogo } from '../components/brand/ClaudeLogo.js'
import { CodexLogo } from '../components/brand/CodexLogo.js'
import type { LimitWindow, ProviderLimits, UsageLimits } from '../api/usage-limits.js'

/**
 * Compact human duration, flooring to whole units: "47m", "4h 34m", "6d 7h".
 * Returns "now" for a non-positive delta.
 */
export function formatResetDuration(ms: number): string {
  if (ms <= 0) return 'now'
  const totalMins = Math.floor(ms / 60_000)
  if (totalMins < 60) return `${totalMins}m`
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remHours = hours % 24
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

/** "Resets in 4h 34m" / "Resets now" for a window, or null when unknown. */
export function formatResetCountdown(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null) return null
  const d = formatResetDuration(resetsAt - now)
  return d === 'now' ? 'Resets now' : `Resets in ${d}`
}

/** Clamp any input to a finite 0–100 percentage (undefined/NaN → 0). */
export function clampPercent(percent: number): number {
  return Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0
}

/**
 * The most-consumed window's percent, for the collapsed strip meter. Only finite
 * window percents count — an absent/NaN window must not poison Math.max into NaN
 * (which renders as a 0%-wide bar even while the numeric label shows a value).
 */
export function providerMaxPercent(p: ProviderLimits): number {
  const pcts = [p.five_hour, p.weekly, p.fable]
    .filter((w): w is LimitWindow => w !== null && w !== undefined && Number.isFinite(w.percent))
    .map((w) => w.percent)
  return pcts.length === 0 ? 0 : Math.max(...pcts)
}

/**
 * The meter fill colour, deepening as usage climbs. Returned as an inline
 * `color-mix` value rather than a `bg-foreground/NN` class on purpose: the theme
 * tokens are hex (`--foreground: #0a0a0a`), so Tailwind's `/opacity` modifier
 * compiles to an invalid colour and paints nothing (which is why the whole app
 * hand-writes color-mix). This keeps the bar visible at every tier.
 */
export function meterFillColor(percent: number): string {
  const mix = percent >= 90 ? 100 : percent >= 70 ? 85 : 70
  return `color-mix(in srgb, var(--foreground) ${mix}%, transparent)`
}

/**
 * A single labeled meter chip: a thin bar + "{label} {percent}%". The fill is
 * absolutely positioned so it always paints its 4px height regardless of the
 * track's flex/inline context (an `h-full` child collapses when the track's own
 * height isn't established — which left the bar looking empty).
 */
function Meter({ label, percent }: { label: string; percent: number }): JSX.Element {
  const width = clampPercent(percent)
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="relative block h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
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

function ProviderMark({ provider }: { provider: ProviderLimits['provider'] }): JSX.Element {
  const Mark = provider === 'codex' ? CodexLogo : ClaudeLogo
  return <Mark className="size-4 shrink-0" />
}

const PROVIDER_NAME: Record<ProviderLimits['provider'], string> = {
  claude: 'Claude',
  codex: 'Codex',
}

/**
 * One provider row: brand mark + name, a burst-icon reset countdown (or
 * "Refresh failed" when the provider errored), and the 5h / wk / Fable meters.
 */
function ProviderRow({ p, now }: { p: ProviderLimits; now: number }): JSX.Element {
  const failed = p.error !== null
  const reset = formatResetCountdown(p.five_hour?.resetsAt ?? null, now)
  const meters = [
    p.five_hour ? { key: '5h', label: '5h', percent: p.five_hour.percent } : null,
    p.weekly ? { key: 'wk', label: 'wk', percent: p.weekly.percent } : null,
    p.fable ? { key: 'fable', label: 'Fable', percent: p.fable.percent } : null,
  ].filter((m): m is { key: string; label: string; percent: number } => m !== null)

  return (
    <div className="flex flex-col gap-1.5 rounded-md px-2 py-1.5">
      <div className="flex items-center gap-2">
        <ProviderMark provider={p.provider} />
        <span className="text-[12px] font-medium text-foreground">{PROVIDER_NAME[p.provider]}</span>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          {failed ? (
            <span className="text-muted-foreground">Refresh failed</span>
          ) : reset !== null ? (
            <>
              <Zap className="size-3" />
              <span className="tabular-nums">{reset}</span>
            </>
          ) : (
            <span className="text-muted-foreground">No limits</span>
          )}
        </span>
      </div>
      {meters.length > 0 ? (
        <div className="flex items-center gap-3 pl-6">
          {meters.map((m) => (
            <Meter key={m.key} label={m.label} percent={m.percent} />
          ))}
        </div>
      ) : failed ? (
        <div className="pl-6 text-[10px] text-muted-foreground">Sign in to Claude Code to see usage.</div>
      ) : null}
    </div>
  )
}

/**
 * The "Detailed" usage panel: a header plus per-provider rate-limit
 * rows (Claude + Codex). Detailed layout only — no Compact tab.
 */
export function UsagePanel({
  limits,
  isFetching,
  onRefresh,
}: {
  limits: UsageLimits | null
  isFetching: boolean
  onRefresh: () => void
}): JSX.Element {
  const now = Date.now()

  return (
    <div className="w-72 select-none text-foreground">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="text-[12px] font-semibold">Usage</span>
        <span className="ml-auto text-[10px] text-muted-foreground">all agents</span>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh usage"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-surface-2 hover:text-foreground"
        >
          {isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        </button>
      </div>

      <div className="h-px bg-border" />

      <div className={`flex flex-col py-1 ${isFetching ? 'animate-pulse' : ''}`}>
        {limits !== null ? (
          <>
            <ProviderRow p={limits.claude} now={now} />
            <ProviderRow p={limits.codex} now={now} />
          </>
        ) : (
          <div className="px-2 py-3 text-[11px] text-muted-foreground">Loading usage…</div>
        )}
      </div>
    </div>
  )
}
