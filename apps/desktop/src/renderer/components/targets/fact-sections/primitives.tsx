import type { JSX } from 'react'
import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '../../../lib/utils.js'
import { Badge } from '../../ui/badge.js'

/** Coerce any value to a display string, showing an em-dash for missing values. */
export function str(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.map((x) => String(x)).join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Format an ISO timestamp for display, falling back to the raw string. */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

export function Section({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string
  count: number
  defaultOpen?: boolean
  children: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen ?? count > 0)
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 px-4 py-2.5 text-left',
          'hover:bg-surface-2',
        )}
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <Badge variant="muted" className="ml-1 shrink-0">
          {count}
        </Badge>
      </button>
      {open && (
        <div className="px-4 pb-4">
          {count === 0 ? (
            <p className="py-2 text-[12.5px] text-muted-foreground">No data collected yet</p>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RecordMeta
// ---------------------------------------------------------------------------

export function RecordMeta({
  collectedAt,
  nodeId,
  executionId,
}: {
  collectedAt: string
  nodeId: string | null
  executionId: string | null
}): JSX.Element {
  return (
    <div className="text-[11px] text-muted-foreground">
      {formatDate(collectedAt)} · node: {nodeId ?? '—'} · exec:{' '}
      {executionId !== null && executionId !== '' ? executionId.slice(0, 8) : '—'}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Table primitives (monochrome)
// ---------------------------------------------------------------------------

export function Table({ head, children }: { head: string[]; children: ReactNode }): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-left">
            {head.map((h) => (
              <th key={h} className="px-2 py-1.5 font-medium text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function KeyValueGrid({ entries }: { entries: [string, unknown][] }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="shrink-0 text-[12px] text-muted-foreground">{k}</span>
          <span className="truncate font-mono text-[12.5px]">{str(v)}</span>
        </div>
      ))}
    </div>
  )
}
