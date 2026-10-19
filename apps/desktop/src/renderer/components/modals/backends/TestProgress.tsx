import type { JSX } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import type { BackendTestResult, SshEnrollResult } from '../../../api/backends.js'
import { cn } from '../../../lib/utils.js'

/** Live test progress: a spinner per pending step, then check/✗ + detail. */
export function TestProgress({
  testing,
  pending,
  result,
}: {
  testing: boolean
  pending: string[]
  result: BackendTestResult | SshEnrollResult | null
}): JSX.Element | null {
  if (!testing && result === null) return null
  const rows = testing
    ? pending.map((name) => ({ name, ok: null as boolean | null, detail: undefined as string | undefined }))
    : (result?.steps ?? []).map((s) => ({ name: s.name, ok: s.ok, detail: s.detail }))
  // A missing workdir on a reachable host isn't a connection failure — say so.
  const missing = result !== null && 'missingWorkdir' in result && result.missingWorkdir !== undefined
  const heading = testing
    ? 'Testing connection…'
    : result?.ok
      ? 'Connection ok'
      : missing
        ? 'Host reachable — directory missing'
        : 'Connection failed'

  return (
    <div className="mt-3 rounded-md border border-border p-2.5">
      <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">{heading}</div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r, i) => (
          <li key={`${r.name}-${i}`} className="flex items-center gap-2 text-[12px]">
            {r.ok === null ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : r.ok ? (
              <Check className="size-3.5 shrink-0 text-status-success" />
            ) : (
              <X className="size-3.5 shrink-0 text-status-error" />
            )}
            <span className={cn('shrink-0', r.ok === false && 'text-status-error')}>{r.name}</span>
            {r.detail !== undefined && r.detail !== '' && (
              <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={r.detail}>
                {r.detail}
              </span>
            )}
          </li>
        ))}
      </ul>
      {result !== null && !result.ok && result.error !== undefined && (
        <p className="mt-2 text-[12px] text-status-error">{result.error}</p>
      )}
    </div>
  )
}
