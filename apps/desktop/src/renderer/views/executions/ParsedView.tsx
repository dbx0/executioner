import type { JSX } from 'react'
import { cn } from '../../lib/utils.js'

/** Render one cell. Arrays are the common nested shape (whatweb's `string`,
 *  `module`), so they read as a comma list rather than as JSON noise. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(cellText).filter((t) => t !== '').join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** A one-line human summary of the first record, for the card preview. Finds
 *  that record without materializing the rest: this runs per card per render,
 *  and a node can parse thousands of rows. */
export function summarizeParsed(value: unknown): string {
  const first = firstRecord(value)
  if (first === undefined) return ''
  return Object.entries(first)
    .map(([k, v]) => [k, cellText(v)] as const)
    .filter(([, v]) => v !== '')
    .slice(0, 4)
    .map(([k, v]) => `${k}=${v}`)
    .join('  ')
}

/** Is this one of the record-shaped rows the views can render? */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The first record-shaped row, without copying the list. */
function firstRecord(value: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(value)) return isRecord(value) ? value : undefined
  for (const r of value) if (isRecord(r)) return r
  return undefined
}

/** Coerce whatever a node emitted into a list of records, or [] if it isn't. */
function asRecords(value: unknown): Array<Record<string, unknown>> {
  const list = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]
  return list.filter(isRecord)
}

/** Column order = first appearance across the rows, so the shape stays stable. */
function columnsOf(rows: Array<Record<string, unknown>>): string[] {
  const cols: string[] = []
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k)
  return cols
}

/** How many parsed rows the table puts in the DOM. A crawl or a port sweep can
 *  parse tens of thousands; building a row per record is a multi-second layout
 *  that lands on whichever click opened the view. */
const MAX_TABLE_ROWS = 500

function Empty(): JSX.Element {
  return <span className="text-tertiary-foreground">—</span>
}

/**
 * Parsed rows rendered as data rather than as JSON: a key/value list for a single
 * record (a screenshot, a trigger) and a table when a node emitted many (nmap's
 * ports, whatweb's fingerprints). Anything that isn't record-shaped falls back to
 * JSON, since inventing a layout for it would hide what it really is.
 */
export function ParsedView({ value }: { value: unknown }): JSX.Element {
  const rows = asRecords(value)

  if (rows.length === 0) {
    const list = Array.isArray(value) ? value : []
    if (list.length > 0) {
      // An array of plain values (hostnames, urls) reads best as a list.
      return (
        <ul className="flex flex-col gap-0.5 font-mono text-[12px]">
          {list.map((v, i) => (
            <li key={i} className="break-all text-foreground">
              {cellText(v)}
            </li>
          ))}
        </ul>
      )
    }
    return <pre className="whitespace-pre-wrap break-all font-mono text-[12px]">{JSON.stringify(value, null, 2)}</pre>
  }

  const cols = columnsOf(rows)
  const shown = rows.length > MAX_TABLE_ROWS ? rows.slice(0, MAX_TABLE_ROWS) : rows

  if (rows.length === 1) {
    const only = rows[0] as Record<string, unknown>
    return (
      <dl className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-6 gap-y-2 text-[12.5px]">
        {cols.map((c) => {
          const text = cellText(only[c])
          return (
            <div key={c} className="contents">
              <dt className="truncate font-mono text-muted-foreground">{c}</dt>
              <dd className="min-w-0 break-all font-mono text-foreground">{text === '' ? <Empty /> : text}</dd>
            </div>
          )
        })}
      </dl>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-border">
            {cols.map((c) => (
              <th
                key={c}
                className="whitespace-nowrap px-3 py-1.5 text-left font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground first:pl-0"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr
              key={i}
              className={cn('border-b border-border/40', i % 2 === 1 && 'bg-surface-1')}
            >
              {cols.map((c) => {
                const text = cellText(r[c])
                return (
                  <td key={c} className="max-w-[28rem] break-all px-3 py-1.5 align-top font-mono text-foreground first:pl-0">
                    {text === '' ? <Empty /> : text}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length < rows.length && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          Showing the first {String(MAX_TABLE_ROWS)} of {String(rows.length)} rows. Use Raw JSON (or Copy) for all of
          them.
        </p>
      )}
    </div>
  )
}
