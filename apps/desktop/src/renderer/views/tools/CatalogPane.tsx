import type { JSX, RefObject } from 'react'
import { useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { Checkbox } from '../../components/ui/checkbox.js'
import type { NodeListing } from '../../api/nodes.js'

/** Whether a tool's binary is present on the connection in view. */
export type InstallState = 'installed' | 'missing' | 'unknown'

/** The install dot: the three states the Settings page uses, in one glyph. */
function InstallDot({ state }: { state: InstallState }): JSX.Element {
  const title =
    state === 'installed' ? 'Installed' : state === 'missing' ? 'Not installed here' : 'Not checked'
  return (
    <span
      title={title}
      aria-hidden="true"
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        state === 'installed' && 'bg-status-success',
        state === 'missing' && 'bg-destructive',
        state === 'unknown' && 'bg-border-strong',
      )}
    />
  )
}

/**
 * The tool catalog: every node, grouped by category and filtered by a search
 * box. Install state is per connection, so a tool missing on the selected
 * connection sorts below the installed ones in its group rather than
 * disappearing — you may still want to read its params or install it.
 */
export function CatalogPane({
  nodes,
  query,
  onQuery,
  selectedId,
  onSelect,
  installState,
  searchRef,
}: {
  nodes: NodeListing[]
  query: string
  onQuery: (v: string) => void
  selectedId: string | null
  onSelect: (id: string) => void
  installState: (node: NodeListing) => InstallState
  /** The search box, so the page can focus it with "/". */
  searchRef?: RefObject<HTMLInputElement | null>
}): JSX.Element {
  const list = useRef<HTMLDivElement>(null)
  // Hides only tools known to be missing: a tool we could not check may well
  // be there, so it stays.
  const [installedOnly, setInstalledOnly] = useState(false)
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matched =
      needle === ''
        ? nodes
        : nodes.filter(
            (n) =>
              n.name.toLowerCase().includes(needle) ||
              n.id.toLowerCase().includes(needle) ||
              n.description.toLowerCase().includes(needle),
          )
    const byCategory = new Map<string, NodeListing[]>()
    for (const node of matched) {
      if (installedOnly && installState(node) === 'missing') continue
      const list = byCategory.get(node.category) ?? []
      list.push(node)
      byCategory.set(node.category, list)
    }
    const rank = (n: NodeListing): number => (installState(n) === 'missing' ? 1 : 0)
    return [...byCategory.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([category, list]) => ({
        category,
        list: [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)),
      }))
  }, [nodes, query, installState, installedOnly])
  const missingCount = useMemo(() => nodes.filter((n) => installState(n) === 'missing').length, [nodes, installState])

  // Up and down walk the tools in the order shown and pick each one, so the
  // form follows the keyboard the way it follows a click.
  const tools = (): HTMLButtonElement[] => [...(list.current?.querySelectorAll<HTMLButtonElement>('button[data-tool]') ?? [])]
  const step = (from: HTMLElement | null, delta: 1 | -1): void => {
    const all = tools()
    if (all.length === 0) return
    const at = from === null ? -1 : all.indexOf(from as HTMLButtonElement)
    const next = all[at === -1 ? (delta === 1 ? 0 : all.length - 1) : Math.min(all.length - 1, Math.max(0, at + delta))]
    if (next === undefined) return
    next.focus()
    onSelect(next.dataset.tool!)
  }
  const onListKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    step(document.activeElement as HTMLElement | null, e.key === 'ArrowDown' ? 1 : -1)
  }

  return (
    <div className="flex h-[260px] w-full shrink-0 flex-col border-b border-border min-[1100px]:h-full min-[1100px]:w-[260px] min-[1100px]:border-b-0 min-[1100px]:border-r">
      <div className="relative shrink-0 border-b border-border p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown') return
            e.preventDefault()
            step(null, 1)
          }}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search tools"
          aria-label="Search tools"
          className="peer h-8 w-full rounded-md border border-input bg-transparent pl-7 pr-7 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rounded border border-border px-1 font-mono text-[10px] text-muted-foreground peer-focus:hidden"
        >
          /
        </kbd>
      </div>

      <label className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-[12px] text-muted-foreground">
        <Checkbox
          className="size-3.5"
          checked={installedOnly}
          onChange={(e) => setInstalledOnly(e.target.checked)}
        />
        <span className="flex-1">Installed only</span>
        {missingCount > 0 && (
          <span className="text-[11px]">{installedOnly ? `${missingCount} hidden` : `${missingCount} missing`}</span>
        )}
      </label>
      <div ref={list} onKeyDown={onListKey} className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek p-1.5">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">No tool matches that.</p>
        ) : (
          groups.map((group) => (
            <div key={group.category} className="mb-2">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.category}
              </div>
              {group.list.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  data-tool={node.id}
                  onClick={() => onSelect(node.id)}
                  aria-current={selectedId === node.id ? 'true' : undefined}
                  // The dot is decorative, so the state belongs in the tooltip;
                  // the accessible name stays just the tool's name.
                  title={`${node.name}: ${installState(node)}`}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]',
                    selectedId === node.id
                      ? 'selected-surface text-sidebar-accent-foreground'
                      : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
                  )}
                >
                  <InstallDot state={installState(node)} />
                  <span className="truncate">{node.name}</span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
