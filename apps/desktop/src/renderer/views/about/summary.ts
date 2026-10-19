import type { Overview } from '../../api/overview.js'
import type { Slice } from './charts.js'

/** "3m ago" for a timestamp the page keeps re-rendering, or a dash for never. */
export function relativeSince(iso: string | null, now: number = Date.now()): string {
  if (iso === null || iso === '') return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'never'
  const secs = Math.max(0, Math.floor((now - then) / 1000))
  if (secs < 45) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`
}

/** The engagement's start, and which day of it today is (the first day is 1). */
export function engagementAge(createdAt: string, now: number = Date.now()): { started: string; day: number } {
  const start = new Date(createdAt)
  if (Number.isNaN(start.getTime())) return { started: 'unknown', day: 1 }
  const started = start.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const day = Math.max(1, Math.floor((now - start.getTime()) / 86_400_000) + 1)
  return { started, day }
}

/**
 * Tailwind cannot put an opacity modifier on this theme's colours: they are plain
 * `var(--token)` values, so `bg-status-error/60` compiles to nothing at all and
 * the bar paints as an empty track. Lighter shades are mixed explicitly instead,
 * the same arbitrary-value idiom ScopeBadge uses.
 */
const GREY = 'bg-[color-mix(in_srgb,var(--muted-foreground)_60%,transparent)]'
const PALE_AMBER = 'bg-[color-mix(in_srgb,var(--activity)_55%,var(--surface-3))]'

/**
 * Worst first, and always all five: a missing severity is information too.
 *
 * The ramp is red to grey through the theme's own accents, and every step is a
 * solid colour a reader can tell from its neighbour — severity is the one scale
 * on this page where telling two bars apart is the whole point.
 */
export const SEVERITY_SLICES: { key: string; label: string; tone: string }[] = [
  { key: 'critical', label: 'Critical', tone: 'bg-status-error' },
  { key: 'high', label: 'High', tone: 'bg-attention' },
  { key: 'medium', label: 'Medium', tone: 'bg-activity' },
  { key: 'low', label: 'Low', tone: PALE_AMBER },
  { key: 'info', label: 'Info', tone: GREY },
]

export function severitySlices(bySeverity: Record<string, number>): Slice[] {
  return SEVERITY_SLICES.map((s) => ({ ...s, value: bySeverity[s.key] ?? 0 }))
}

export function statusSlices(byStatus: Record<string, number>): Slice[] {
  return [
    { key: 'open', label: 'Open', tone: 'bg-attention', value: byStatus.open ?? 0 },
    { key: 'confirmed', label: 'Confirmed', tone: 'bg-status-error', value: byStatus.confirmed ?? 0 },
    { key: 'fixed', label: 'Fixed', tone: 'bg-status-success', value: byStatus.fixed ?? 0 },
    { key: 'false_positive', label: 'False positive', tone: GREY, value: byStatus.false_positive ?? 0 },
    { key: 'discarded', label: 'Discarded', tone: PALE_AMBER, value: byStatus.discarded ?? 0 },
  ]
}

export function scopeSlices(byScope: Overview['targets']['byScope']): Slice[] {
  return [
    { key: 'in', label: 'In scope', tone: 'bg-status-success', value: byScope.in },
    { key: 'unknown', label: 'Unscoped', tone: 'bg-attention', value: byScope.unknown },
    { key: 'out', label: 'Out of scope', tone: 'bg-destructive', value: byScope.out },
  ]
}

/** How far the in-scope surface has actually been worked, not just listed. */
export function coverageSlices(coverage: Overview['targets']['coverage']): Slice[] {
  return [
    { key: 'findings', label: 'Has findings', tone: 'bg-status-error', value: coverage.withFindings },
    { key: 'recon', label: 'Recon only', tone: 'bg-status-running', value: coverage.reconOnly },
    { key: 'untouched', label: 'Untouched', tone: GREY, value: coverage.untouched },
  ]
}

const KIND_LABELS: Record<string, string> = {
  domain: 'Domains',
  subdomain: 'Subdomains',
  ip: 'IPs',
  cidr: 'Networks',
  url: 'URLs',
}

export function kindSlices(byKind: Record<string, number>): Slice[] {
  return Object.entries(byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({ key, label: KIND_LABELS[key] ?? key, value, tone: 'bg-activity' }))
}

/** What the engagement's agents are doing right now, from the live session state. */
export function agentActivity(
  sessions: { id: string }[],
  sessionState: Record<string, 'idle' | 'working'>,
  subagents: Record<string, { state: 'working' | 'done' }[]>,
): { working: number; open: number; subagents: number } {
  const working = sessions.filter((s) => sessionState[s.id] === 'working').length
  const subs = Object.values(subagents)
    .flat()
    .filter((s) => s.state === 'working').length
  return { working, open: sessions.length, subagents: subs }
}
