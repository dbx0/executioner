import type { JSX } from 'react'
import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { TargetFact } from '../../../api/targets.js'
import { cn } from '../../../lib/utils.js'
import { LoadingState, Spinner } from '../../ui/spinner.js'

/** What a cell shows when the value was never collected. */
export const MISSING = '-'

/** Coerce any value to a display string, showing a placeholder for missing values. */
export function str(v: unknown): string {
  if (v === null || v === undefined || v === '') return MISSING
  if (Array.isArray(v)) return v.length === 0 ? MISSING : v.map((x) => String(x)).join(', ')
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
// Section card
// ---------------------------------------------------------------------------

/** The dark inset every section body and record sits on. */
const INSET = 'rounded-xl bg-[color-mix(in_srgb,var(--background)_40%,transparent)]'

/**
 * The header every section shares: a disclosure row with the section name and
 * how many records it holds. Kept apart from `Section` so a block that owns its
 * open state elsewhere can still wear the same header.
 */
export function SectionHeader({
  title,
  count,
  open,
  onToggle,
  controls,
  loading = false,
}: {
  title: string
  count: number
  open: boolean
  onToggle: () => void
  /** Id of the body this header discloses. */
  controls?: string
  /** The records are still being fetched: a spinner stands in for the count. */
  loading?: boolean
}): JSX.Element {
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <h3 className="flex">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controls}
        onClick={onToggle}
        className={cn(
          'flex items-center gap-1.5 rounded-control text-left text-xs font-semibold text-muted-foreground outline-none transition-colors',
          'hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
        )}
      >
        <span>{title}</span>
        {loading ? (
          <Spinner size="xs" />
        ) : (
          <span className="font-normal tabular-nums text-tertiary-foreground">{count}</span>
        )}
        <Chevron className="size-3 shrink-0 text-tertiary-foreground" />
      </button>
    </h3>
  )
}

/** One collapsible block of the target detail: findings, a fact kind, screenshots. */
export function Section({
  title,
  count,
  defaultOpen,
  loading = false,
  children,
}: {
  title: string
  count: number
  defaultOpen?: boolean
  /** The records are still being fetched; the body says so instead of "no data". */
  loading?: boolean
  children: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen ?? count > 0)
  const bodyId = useId()
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader
        title={title}
        count={count}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        controls={bodyId}
        loading={loading}
      />
      {open && (
        <div id={bodyId} className={cn(INSET, 'px-3.5 py-2.5')}>
          {loading ? (
            <LoadingState label={`Loading ${title.toLowerCase()}`} className="min-h-16" />
          ) : count === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">No data collected yet</p>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Records
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
      {formatDate(collectedAt)} · node: {nodeId ?? MISSING} · exec:{' '}
      {executionId !== null && executionId !== '' ? executionId.slice(0, 8) : MISSING}
    </div>
  )
}

/** A list of free-form records, one `RecordCard` each. */
export function RecordList({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex flex-col">{children}</div>
}

/** One free-form record with where and when it was collected underneath, ruled off from the next. */
export function RecordCard({ fact, children }: { fact: TargetFact; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-2 border-b border-glass-border py-2 first:pt-0 last:border-b-0 last:pb-0">
      {children}
      <RecordMeta collectedAt={fact.collectedAt} nodeId={fact.nodeId} executionId={fact.executionId} />
    </div>
  )
}

/** Raw JSON or tool output, on the same black inset the terminals use. */
export function CodeBlock({ children }: { children: ReactNode }): JSX.Element {
  return (
    <pre className="scrollbar-sleek max-h-64 overflow-auto rounded-lg border border-glass-border bg-background p-2.5 font-mono text-[11px]">
      {children}
    </pre>
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

// ---------------------------------------------------------------------------
// Table primitives (monochrome)
// ---------------------------------------------------------------------------

export function Table({ head, children }: { head: string[]; children: ReactNode }): JSX.Element {
  return (
    <div className="scrollbar-sleek overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-glass-border text-left">
            {head.map((h) => (
              <th key={h} className="py-1.5 pr-3 text-[12px] font-normal text-tertiary-foreground last:pr-0">
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

/** A body row: hairline between rows, none under the last. */
export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>): JSX.Element {
  return <tr className={cn('border-b border-glass-border align-top last:border-b-0', className)} {...props} />
}

export interface TdProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  /** Machine values (ports, names, addresses) read in the mono face. */
  mono?: boolean
  /** Secondary columns, such as the node that collected the row. */
  muted?: boolean
}

export function Td({ mono = false, muted = false, className, ...props }: TdProps): JSX.Element {
  return (
    <td className={cn('py-1.5 pr-3 last:pr-0', mono && 'font-mono', muted && 'text-muted-foreground', className)} {...props} />
  )
}
