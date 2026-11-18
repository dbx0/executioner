import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { buildCatalog, groupByCategory, type CatalogEntry } from '../../lib/node-catalog.js'
import type { NodeListing } from '../../api/nodes.js'
import { ScrollArea } from '../ui/scroll-area.js'
import { Spinner } from '../ui/spinner.js'
import { CatalogGroups, CatalogSearch } from './CatalogList.js'
import { FloatingPanel } from './surface.js'

/**
 * The node palette floating at the left of the canvas: every node the engine
 * offers, grouped by category. A row is clicked to add it or dragged onto the
 * canvas to place it.
 */
export function Palette({
  listings,
  onAdd,
  loading = false,
}: {
  listings: NodeListing[]
  onAdd: (entry: CatalogEntry) => void
  /** The engine has not answered for its tool list yet; only the built-in nodes are showing. */
  loading?: boolean
}): JSX.Element {
  const [q, setQ] = useState('')
  const catalog = useMemo(() => buildCatalog(listings), [listings])
  const groups = useMemo(() => {
    const filtered =
      q.trim() === ''
        ? catalog
        : catalog.filter((e) => e.label.toLowerCase().includes(q.toLowerCase()) || e.type.includes(q.toLowerCase()))
    return groupByCategory(filtered)
  }, [catalog, q])

  return (
    <FloatingPanel asChild className="flex w-56 shrink-0 flex-col">
      <aside aria-label="Node palette">
        <div className="p-2">
          <CatalogSearch value={q} onChange={setQ} />
        </div>
        <ScrollArea className="min-h-0 flex-1 px-2 pb-2">
          <CatalogGroups groups={groups} onPick={onAdd} draggable />
          {groups.length === 0 && !loading && (
            <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">No nodes match</p>
          )}
          {loading && (
            <div role="status" className="flex items-center gap-2 px-2 py-2 text-[11px] text-muted-foreground">
              <Spinner size="xs" />
              Loading tools
            </div>
          )}
        </ScrollArea>
      </aside>
    </FloatingPanel>
  )
}
