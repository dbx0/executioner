import type { StandaloneRun } from '../../api/executions.js'

/** The dot colour for a run's status. */
export function statusDot(status: string): string {
  if (status === 'succeeded' || status === 'success') return 'bg-status-success'
  if (status === 'running') return 'bg-status-running animate-pulse'
  if (status === 'cancelled') return 'bg-muted-foreground'
  return 'bg-status-error'
}

/** How long ago an instant was, in the largest unit that fits. */
function ago(iso: string, now: number): string {
  const secs = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** A duration between two instants, as "42s" or "3m 5s". */
export function elapsed(from: number, to: number): string {
  const secs = Math.max(0, Math.round((to - from) / 1000))
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

/** When a run started and how long it took, for its line in the history. */
export function runTiming(run: StandaloneRun, now: number): string | null {
  if (run.startedAt === null) return null
  const when = ago(run.startedAt, now)
  const end = run.finishedAt === null ? (run.status === 'running' ? now : null) : Date.parse(run.finishedAt)
  return end === null ? when : `${when} · ${elapsed(Date.parse(run.startedAt), end)}`
}
