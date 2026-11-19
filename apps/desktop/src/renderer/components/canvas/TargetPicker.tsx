import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { Input } from '../ui/input.js'
import { POPOVER_SURFACE } from '../ui/surface.js'
import { cn } from '../../lib/utils.js'

/** Never render more than this many rows at once: an engagement can hold tens
 *  of thousands of targets (subdomain enumeration), and a list that
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
      <Input
        role="combobox"
        aria-label="Target"
        aria-expanded={open && results.length > 0}
        aria-autocomplete="list"
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
        placeholder={targets.length === 0 ? 'No targets. Add one first' : `Search ${targets.length} targets…`}
        className="text-[13px]"
      />
      {open && results.length > 0 && (
        <div role="listbox" className={cn('scrollbar-sleek absolute z-20 mt-1 max-h-56 w-full overflow-auto p-1', POPOVER_SURFACE)}>
          {results.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={t.id === value}
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(t.id)
                setOpen(false)
                setQuery('')
              }}
              className={cn(
                'flex w-full items-center rounded-[9px] px-2.5 py-1.5 text-left text-[13px] hover:bg-glass-strong',
                t.id === value && 'bg-glass-active font-medium',
              )}
            >
              <span className="truncate font-mono text-[12px]">{t.value}</span>
            </button>
          ))}
          {targets.length > results.length && (
            <div className="px-2.5 py-1 text-[11px] text-muted-foreground">
              Showing first {results.length} of {targets.length}. Type to narrow.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
