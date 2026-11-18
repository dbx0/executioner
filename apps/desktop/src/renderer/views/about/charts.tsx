import type { JSX, ReactNode } from 'react'
import { cn } from '../../lib/utils.js'
import { stagger } from '../../lib/motion.js'
import { CardEmpty } from './Card.js'
import { Hint } from './Hint.js'

/**
 * The About page's chart vocabulary. Everything here is a plain div: three
 * shapes (ranked bars, one stacked bar, a day-by-day column chart) carry every
 * number on the page, so a reader learns the vocabulary once. There is no chart
 * library, because at this size one would cost more than it explains. Every
 * color is a theme token class, so the charts follow all six themes.
 */

export interface Slice {
  key: string
  label: string
  value: number
  /** A background utility class, so the bar and its legend swatch always agree. */
  tone: string
}

/** The unfilled part of every bar. */
const TRACK = 'bg-glass-strong'

/** A legend entry: swatch, label, and whatever figures follow it. */
function LegendItem({ tone, label, children }: { tone: string; label: string; children?: ReactNode }): JSX.Element {
  return (
    <li className="flex items-center gap-1.5 text-[11.5px]">
      <span className={cn('size-2 shrink-0 rounded-full', tone)} />
      <span className="text-muted-foreground">{label}</span>
      {children}
    </li>
  )
}

/** One row of a ranked chart: label, bar scaled against the widest row, count. */
function BarRow({ slice, max, index }: { slice: Slice; max: number; index: number }): JSX.Element {
  return (
    <li className="flex items-center gap-2.5">
      <span className="w-20 shrink-0 truncate text-[11.5px] text-muted-foreground">{slice.label}</span>
      <div className={cn('h-2 min-w-0 flex-1 overflow-hidden rounded-full', TRACK)}>
        <div
          className={cn('h-full origin-left rounded-full motion-safe:animate-grow-x', slice.tone)}
          style={{
            width: `${slice.value === 0 ? 0 : Math.max(3, (slice.value / max) * 100)}%`,
            ...stagger(index, 40, 600),
          }}
        />
      </div>
      <span className="w-7 shrink-0 text-right text-xs tabular-nums">{slice.value}</span>
    </li>
  )
}

/** Ranked horizontal bars, widest value setting the scale. Zero rows stay visible
 *  so an empty severity still reads as a row of the same table. */
export function RankedBars({ slices, empty }: { slices: Slice[]; empty?: string }): JSX.Element {
  const max = Math.max(1, ...slices.map((s) => s.value))
  const total = slices.reduce((a, s) => a + s.value, 0)
  if (total === 0 && empty !== undefined) return <CardEmpty>{empty}</CardEmpty>
  return (
    <ul className="flex flex-col gap-2">
      {slices.map((s, i) => (
        <BarRow key={s.key} slice={s} max={max} index={i} />
      ))}
    </ul>
  )
}

/** One proportional bar plus a legend: for a whole that splits into parts. */
export function StackedBar({ slices, empty }: { slices: Slice[]; empty: string }): JSX.Element {
  const total = slices.reduce((a, s) => a + s.value, 0)
  if (total === 0) return <CardEmpty>{empty}</CardEmpty>
  return (
    <div>
      <div className="flex h-2.5 w-full gap-[3px]">
        {slices
          .filter((s) => s.value > 0)
          .map((s, i) => (
            <Hint key={s.key} label={`${s.label}: ${s.value}`}>
              <div
                className={cn('min-w-1 origin-left rounded-full motion-safe:animate-grow-x', s.tone)}
                style={{ width: `${(s.value / total) * 100}%`, ...stagger(i, 50, 800) }}
              />
            </Hint>
          ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {slices.map((s) => (
          <LegendItem key={s.key} tone={s.tone} label={s.label}>
            <span className="tabular-nums">{s.value}</span>
            <span className="text-muted-foreground">({Math.round((s.value / total) * 100)}%)</span>
          </LegendItem>
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

/** Which color is which series, for the header of the activity card. */
export function ActivityLegend(): JSX.Element {
  return (
    <ul className="flex flex-wrap justify-end gap-x-3 gap-y-1">
      {SERIES.map((s) => (
        <LegendItem key={s.key} tone={s.tone} label={s.label} />
      ))}
    </ul>
  )
}

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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-20 flex-1 items-end gap-[3px] border-b border-glass-border">
        {days.map((d, di) => (
          <Hint key={d.date} label={`${d.date}: ${d.targets} targets · ${d.runs} runs · ${d.findings} findings`}>
            <div className="flex h-full min-w-0 flex-1 items-end justify-center gap-[2px]">
              {SERIES.map((s) => (
                <div
                  key={s.key}
                  className={cn(
                    'w-full max-w-[6px] origin-bottom rounded-t-full motion-safe:animate-grow-y',
                    d[s.key] === 0 ? TRACK : s.tone,
                  )}
                  style={{
                    height: d[s.key] === 0 ? '2px' : `${Math.max(6, (d[s.key] / max) * 100)}%`,
                    ...stagger(di, 15, 1000),
                  }}
                />
              ))}
            </div>
          </Hint>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10.5px] tabular-nums text-muted-foreground">
        <span>{label(days[0]?.date ?? '')}</span>
        <span>{label(days[days.length - 1]?.date ?? '')}</span>
      </div>
      {busiest === 0 && <CardEmpty>Nothing recorded in this window yet.</CardEmpty>}
    </div>
  )
}
