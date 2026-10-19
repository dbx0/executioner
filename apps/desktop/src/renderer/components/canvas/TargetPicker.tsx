import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { cn } from '../../lib/utils.js'

/** Never render more than this many rows at once — an engagement can hold tens
 *  of thousands of targets (subdomain enumeration), and a plain <select> that
 *  materializes every one freezes the app. */
const MAX_ROWS = 100

/**
 * A searchable target picker for the run dialog. Filters in-memory by substring
 * and renders at most MAX_ROWS rows, so it stays instant even with 25k+ targets
 * (where a full Radix <Select> would lock the UI rendering every option).
 */
export function TargetPicker({
  targets,
  value,
  onChange,
}: {
  targets: { id: string; value: string }[]
  value: string | undefined
  onChange: (id: string) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = targets.find((t) => t.id === value)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q === '' ? targets : targets.filter((t) => t.value.toLowerCase().includes(q))
    return matched.slice(0, MAX_ROWS)
  }, [targets, query])

  return (
    <div className="relative">
      <input
        value={open ? query : (selected?.value ?? '')}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        // Delay close so a row's mousedown registers first.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={targets.length === 0 ? 'No targets — add one first' : `Search ${targets.length} targets…`}
        className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      {open && results.length > 0 && (
        <div className="scrollbar-sleek absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-floating">
          {results.map((t) => (
            <button
              key={t.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(t.id)
                setOpen(false)
                setQuery('')
              }}
              className={cn(
                'flex w-full items-center rounded px-2 py-1.5 text-left text-[13px] hover:bg-surface-2',
                t.id === value && 'font-medium',
              )}
            >
              <span className="truncate font-mono text-[12px]">{t.value}</span>
            </button>
          ))}
          {targets.length > results.length && (
            <div className="px-2 py-1 text-[11px] text-muted-foreground">
              Showing first {results.length} of {targets.length} — type to narrow.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
