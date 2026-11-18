import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { groupByCategory, type CatalogEntry } from '../../lib/node-catalog.js'
import { POPOVER_SURFACE } from '../ui/surface.js'
import { cn } from '../../lib/utils.js'
import { CatalogGroups, CatalogSearch } from './CatalogList.js'

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
    function handleMouseDown(e: MouseEvent): void {
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

  return (
    <div
      data-node-picker
      // The anchor is a point computed from the canvas viewport at open time.
      style={{ left: x, top: y }}
      className={cn('fixed z-50 w-56 overflow-hidden', POPOVER_SURFACE)}
    >
      <div className="p-2">
        <CatalogSearch
          value={query}
          onChange={setQuery}
          inputRef={inputRef}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              onClose()
            }
          }}
        />
      </div>
      <div className="scrollbar-sleek max-h-64 overflow-y-auto px-2 pb-2">
        {groups.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">No nodes match</div>
        ) : (
          <CatalogGroups
            groups={groups}
            onPick={(entry) => {
              onPick(entry)
              onClose()
            }}
          />
        )}
      </div>
    </div>
  )
}
