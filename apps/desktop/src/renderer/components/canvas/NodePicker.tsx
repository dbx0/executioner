import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { categoryColor, groupByCategory, type CatalogEntry } from '../../lib/node-catalog.js'

export interface NodePickerProps {
  entries: CatalogEntry[]
  x: number
  y: number
  onPick: (entry: CatalogEntry) => void
  onClose: () => void
}

/**
 * Floating popover listing catalog entries grouped by category. Reused for both
 * insert-between (on an edge) and append (off a node). Trigger nodes are excluded
 * since they can only be workflow entry points, never inserted mid-graph.
 */
export function NodePicker({ entries, x, y, onPick, onClose }: NodePickerProps): JSX.Element {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Element | null
      if (!target?.closest('[data-node-picker]')) onClose()
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [onClose])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = entries.filter((e) => {
      if (e.category === 'trigger') return false
      if (q === '') return true
      return e.label.toLowerCase().includes(q) || e.type.toLowerCase().includes(q)
    })
    return groupByCategory(filtered)
  }, [entries, query])

  const isEmpty = groups.length === 0

  return (
    <div
      data-node-picker
      style={{ left: x, top: y, position: 'fixed' }}
      className="z-50 w-52 overflow-hidden rounded-md border border-border bg-popover text-foreground shadow-floating"
    >
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                onClose()
              }
            }}
            placeholder="Search nodes…"
            className="h-8 w-full rounded-md border border-border bg-transparent pl-7 pr-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto scrollbar-sleek py-1">
        {isEmpty ? (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">No nodes match</div>
        ) : (
          groups.map(([category, catEntries]) => (
            <div key={category} className="mb-1">
              <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="size-2 rounded-full" style={{ background: categoryColor(category) }} />
                {category}
              </div>
              <div className="flex flex-col gap-0.5 px-1">
                {catEntries.map((entry) => (
                  <button
                    key={entry.type}
                    type="button"
                    title={entry.description}
                    onClick={() => {
                      onPick(entry)
                      onClose()
                    }}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: categoryColor(entry.category) }} />
                    <span className="truncate">{entry.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
