import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { buildCatalog, categoryColor, groupByCategory, type CatalogEntry } from '../../lib/node-catalog.js'
import type { NodeListing } from '../../api/nodes.js'
import { Input } from '../ui/input.js'
import { ScrollArea } from '../ui/scroll-area.js'

export function Palette({
  listings,
  onAdd,
}: {
  listings: NodeListing[]
  onAdd: (entry: CatalogEntry) => void
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
    <div className="flex w-56 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search nodes…"
            className="h-8 pl-7 text-[13px]"
          />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
        {groups.map(([category, entries]) => (
          <div key={category} className="mb-3">
            <div className="flex items-center gap-1.5 px-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: categoryColor(category) }} />
              {category}
            </div>
            <div className="flex flex-col gap-0.5">
              {entries.map((e) => (
                <button
                  key={e.type}
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      'application/exe-node',
                      JSON.stringify({ type: e.type, label: e.label, kind: e.kind, category: e.category }),
                    )
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  onClick={() => onAdd(e)}
                  title={e.description}
                  className="flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-surface-2 active:cursor-grabbing"
                >
                  <span className="size-1.5 rounded-full" style={{ background: categoryColor(e.category) }} />
                  <span className="truncate">{e.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </ScrollArea>
    </div>
  )
}
