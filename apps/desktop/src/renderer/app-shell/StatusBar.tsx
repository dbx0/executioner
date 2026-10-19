import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store.js'
import { ClaudeLogo } from '../components/brand/ClaudeLogo.js'
import { usageLimitsApi, type ProviderLimits, type UsageLimits } from '../api/usage-limits.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js'
import { clampPercent, formatResetDuration, meterFillColor, providerMaxPercent, UsagePanel } from './UsagePanel.js'

/** Poll cadence for account rate limits, in ms. Limits move slowly. */
const POLL_MS = 60_000

/** The " · "-joined strip segments: "9% used 4h 34m · 49% used 19h 4m · 0% used Fable". */
function stripSegments(p: ProviderLimits, now: number): string[] {
  const seg = (percent: number, label: string): string => `${Math.round(percent)}% used ${label}`
  const windowLabel = (resetsAt: number | null, fallback: string): string =>
    resetsAt !== null ? formatResetDuration(resetsAt - now) : fallback
  const out: string[] = []
  if (p.five_hour) out.push(seg(p.five_hour.percent, windowLabel(p.five_hour.resetsAt, '5h')))
  if (p.weekly) out.push(seg(p.weekly.percent, windowLabel(p.weekly.resetsAt, 'wk')))
  if (p.fable) out.push(seg(p.fable.percent, 'Fable'))
  return out
}

/**
 * The bottom status strip, an account rate-limit bar: the Claude
 * mark + a usage meter, then "9% used 4h 34m · 49% used 19h 4m · 0% used Fable"
 * from the fetched five-hour / weekly / Fable windows. Clicking the strip opens
 * the Detailed usage popover (Claude + Codex rows, transcript history, accounts).
 * Polls the account limits slowly (60s) with a manual refresh in the panel.
 */
export function StatusBar(): JSX.Element {
  const client = useApp((s) => s.client)
  const api = useMemo(() => (client === null ? null : usageLimitsApi(client)), [client])

  const [limits, setLimits] = useState<UsageLimits | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (api === null) {
      setLimits(null)
      return
    }
    let cancelled = false
    const load = (): void => {
      setIsFetching(true)
      api
        .get()
        .then((l) => {
          if (!cancelled) setLimits(l)
        })
        .catch(() => {
          /* engine restarting or older build: keep the last value */
        })
        .finally(() => {
          if (!cancelled) setIsFetching(false)
        })
    }
    load()
    const timer = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [api, reloadKey])

  const now = Date.now()
  const claude = limits?.claude ?? null
  const segments = claude !== null && claude.error === null ? stripSegments(claude, now) : []
  const maxPercent = claude !== null ? providerMaxPercent(claude) : 0

  return (
    <footer className="flex h-6 shrink-0 items-center border-t border-border/60 bg-background text-[11px] text-muted-foreground select-none">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-full min-w-0 items-center gap-2 px-3 outline-none hover:bg-surface-1"
            title="Account usage & rate limits"
          >
            <ClaudeLogo className="size-3.5 shrink-0" />
            <span className="relative block h-[5px] w-14 shrink-0 overflow-hidden rounded-full bg-muted">
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${clampPercent(maxPercent)}%`, backgroundColor: meterFillColor(maxPercent) }}
              />
            </span>
            {claude === null ? (
              <span className="text-tertiary-foreground">Loading usage…</span>
            ) : claude.error !== null ? (
              <span className="text-muted-foreground">Usage unavailable</span>
            ) : segments.length === 0 ? (
              <span className="text-tertiary-foreground">No account limits</span>
            ) : (
              <span className="truncate tabular-nums">{segments.join(' · ')}</span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="p-1">
          <UsagePanel limits={limits} isFetching={isFetching} onRefresh={() => setReloadKey((k) => k + 1)} />
        </DropdownMenuContent>
      </DropdownMenu>
    </footer>
  )
}
