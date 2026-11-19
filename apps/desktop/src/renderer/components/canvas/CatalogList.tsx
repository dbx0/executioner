import type { JSX } from 'react'
import { Search } from 'lucide-react'
import { categoryColor, type CatalogEntry } from '../../lib/node-catalog.js'
import { Input } from '../ui/input.js'
import { Tip } from '../ui/tip.js'
import { cn } from '../../lib/utils.js'
import { SectionTitle } from './surface.js'

/** A category dot. The colour is catalog data, so it cannot be a utility class. */
function CategoryDot({ category, className }: { category: string; className?: string }): JSX.Element {
  return <span aria-hidden className={cn('shrink-0 rounded-full', className)} style={{ background: categoryColor(category) }} />
}

/** The search field over a node list, shared by the palette and the node picker. */
export function CatalogSearch({
  value,
  onChange,
  inputRef,
  onKeyDown,
}: {
  value: string
  onChange: (value: string) => void
  inputRef?: React.Ref<HTMLInputElement>
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}): JSX.Element {
  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search nodes…"
        aria-label="Search nodes"
        className="h-8 pl-8 text-[13px]"
      />
    </div>
  )
}

/**
 * Catalog entries grouped under their category heading. The palette makes each
 * row draggable onto the canvas; the node picker only needs the click.
 */
export function CatalogGroups({
  groups,
  onPick,
  draggable = false,
}: {
  groups: [string, CatalogEntry[]][]
  onPick: (entry: CatalogEntry) => void
  draggable?: boolean
}): JSX.Element {
  return (
    <>
      {groups.map(([category, entries]) => (
        <div key={category} className="mb-2.5 last:mb-0">
          <SectionTitle className="flex items-center gap-1.5 px-2 py-1">
            <CategoryDot category={category} className="size-2" />
            {category}
          </SectionTitle>
          <div className="flex flex-col gap-px">
            {entries.map((entry) => {
              const row = (
                <button
                  key={entry.type}
                  type="button"
                  draggable={draggable}
                  onDragStart={
                    draggable
                      ? (event) => {
                          event.dataTransfer.setData(
                            'application/exe-node',
                            JSON.stringify({ type: entry.type, label: entry.label, kind: entry.kind, category: entry.category }),
                          )
                          event.dataTransfer.effectAllowed = 'move'
                        }
                      : undefined
                  }
                  onClick={() => onPick(entry)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[13px] outline-none transition-colors',
                    'hover:bg-glass-strong focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    draggable && 'cursor-grab active:cursor-grabbing',
                  )}
                >
                  <CategoryDot category={entry.category} className="size-1.5" />
                  <span className="truncate">{entry.label}</span>
                </button>
              )
              return entry.description === undefined ? (
                row
              ) : (
                <Tip key={entry.type} label={<span className="block max-w-56">{entry.description}</span>} side="right">
                  {row}
                </Tip>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}
