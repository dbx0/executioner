import type { JSX } from 'react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils.js'

/**
 * The About page's chart vocabulary. Everything here is a plain div or an inline
 * SVG: three shapes (ranked bars, one stacked bar, a day-by-day column chart)
 * carry every number on the page, so a reader learns the vocabulary once. No
 * chart library — at this size one would cost more than it explains.
 */

export interface Slice {
  key: string
  label: string
  value: number
  /** A background utility class, so the bar and its legend swatch always agree. */
  tone: string
}

/** A panel with a title, an optional right-hand note, and a body. */
export function Panel({
  title,
  note,
  children,
  className,
}: {
  title: string
  note?: ReactNode
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <section className={cn('rounded-lg border border-border bg-card p-3.5', className)}>
      <header className="mb-3 flex items-baseline gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        {note !== undefined && <span className="ml-auto text-[11px] text-muted-foreground">{note}</span>}
      </header>
      {children}
    </section>
  )
}

/** One headline number with a label above and a quiet sub-line under it. */
export function StatTile({
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  label: string
  value: number | string
  sub?: string
  tone?: string | undefined
  onClick?: (() => void) | undefined
}): JSX.Element {
  const body = (
    <>
      <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-[24px] font-semibold leading-none tabular-nums', tone)}>{value}</div>
      <div className="mt-1 truncate text-[11.5px] text-muted-foreground">{sub ?? ''}</div>
    </>
  )
  return onClick === undefined ? (
    <div data-stat={label} className="rounded-lg border border-border bg-card px-3 py-2.5">
      {body}
    </div>
  ) : (
    <button
      type="button"
      data-stat={label}
      onClick={onClick}
      className="rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-1"
    >
      {body}
    </button>
  )
}

/** Ranked horizontal bars, widest value setting the scale. Zero rows stay visible
 *  so an empty severity still reads as a row of the same table. */
export function RankedBars({ slices, empty }: { slices: Slice[]; empty?: string }): JSX.Element {
  const max = Math.max(1, ...slices.map((s) => s.value))
  const total = slices.reduce((a, s) => a + s.value, 0)
  if (total === 0 && empty !== undefined) {
    return <p className="py-2 text-[12px] text-muted-foreground">{empty}</p>
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {slices.map((s) => (
        <li key={s.key} className="flex items-center gap-2.5">
          <span className="w-[68px] shrink-0 truncate text-[11.5px] text-muted-foreground">{s.label}</span>
          <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn('h-full rounded-full', s.tone)}
              style={{ width: `${s.value === 0 ? 0 : Math.max(3, (s.value / max) * 100)}%` }}
            />
          </div>
          <span className="w-7 shrink-0 text-right text-[12px] tabular-nums">{s.value}</span>
        </li>
      ))}
    </ul>
  )
}

/** One proportional bar plus a legend: for a whole that splits into parts. */
export function StackedBar({ slices, empty }: { slices: Slice[]; empty: string }): JSX.Element {
  const total = slices.reduce((a, s) => a + s.value, 0)
  if (total === 0) return <p className="py-2 text-[12px] text-muted-foreground">{empty}</p>
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
        {slices
          .filter((s) => s.value > 0)
          .map((s) => (
            <div
              key={s.key}
              className={s.tone}
              style={{ width: `${(s.value / total) * 100}%` }}
              title={`${s.label}: ${s.value}`}
            />
          ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-[11.5px]">
            <span className={cn('size-2 shrink-0 rounded-sm', s.tone)} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="tabular-nums">{s.value}</span>
            <span className="text-muted-foreground">({Math.round((s.value / total) * 100)}%)</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface ActivityPoint {
  date: string
  findings: number
  runs: number
  targets: number
}

const SERIES = [
  { key: 'targets' as const, label: 'Targets found', tone: 'bg-activity' },
  { key: 'runs' as const, label: 'Runs', tone: 'bg-status-running' },
  { key: 'findings' as const, label: 'Findings', tone: 'bg-status-error' },
]

/**
 * A day per column, three thin bars per day. Absolute counts share one scale so
 * the three series stay comparable; a quiet day is an empty column rather than a
 * gap, which is the point of the chart.
 */
export function ActivityChart({ days }: { days: ActivityPoint[] }): JSX.Element {
  const max = Math.max(1, ...days.flatMap((d) => [d.findings, d.runs, d.targets]))
  const busiest = days.reduce((a, d) => a + d.findings + d.runs + d.targets, 0)
  const label = (iso: string): string => iso.slice(5).replace('-', '/')

  return (
    <div>
      <div className="flex h-20 items-end gap-[3px]">
        {days.map((d) => (
          <div
            key={d.date}
            className="flex h-full min-w-0 flex-1 items-end justify-center gap-[2px]"
            title={`${d.date}: ${d.targets} targets · ${d.runs} runs · ${d.findings} findings`}
          >
            {SERIES.map((s) => (
              <div
                key={s.key}
                className={cn('w-full max-w-[6px] rounded-sm', d[s.key] === 0 ? 'bg-surface-2' : s.tone)}
                style={{ height: d[s.key] === 0 ? '2px' : `${Math.max(6, (d[s.key] / max) * 100)}%` }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10.5px] tabular-nums text-muted-foreground">
        <span>{label(days[0]?.date ?? '')}</span>
        <span>{label(days[days.length - 1]?.date ?? '')}</span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <span className={cn('size-2 rounded-sm', s.tone)} />
            {s.label}
          </li>
        ))}
      </ul>
      {busiest === 0 && <p className="mt-2 text-[11.5px] text-muted-foreground">Nothing recorded in this window yet.</p>}
    </div>
  )
}
