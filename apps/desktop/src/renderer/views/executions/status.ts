/** How a run's status reads: its text tone, its dot, and the short id used in labels. */

export function statusColor(status: string): string {
  if (status === 'succeeded' || status === 'success') return 'text-status-success'
  if (status === 'running') return 'text-status-running'
  // A run you stopped yourself is not a failure, so it doesn't read as one.
  if (status === 'cancelled') return 'text-muted-foreground'
  return 'text-status-error'
}

export function statusDot(status: string): string {
  if (status === 'succeeded' || status === 'success') return 'bg-status-success'
  if (status === 'running') return 'bg-status-running animate-pulse'
  if (status === 'cancelled') return 'bg-muted-foreground'
  return 'bg-status-error'
}

export function shortId(id: string): string {
  return id.slice(0, 8)
}
