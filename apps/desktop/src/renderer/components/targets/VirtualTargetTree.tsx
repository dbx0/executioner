import type { JSX } from 'react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Globe, Network, Link2, Boxes } from 'lucide-react'
import type { TargetNode } from '../../api/targets.js'
import { cn } from '../../lib/utils.js'
import { ScrollArea } from '../ui/scroll-area.js'
import { Badge } from '../ui/badge.js'
import { useNewIds } from '../../lib/motion.js'
import { ScopeBadge } from './ScopeBadge.js'

/** Row pitch: a 32px row plus the 1px that keeps neighbouring rows apart. */
const ROW_HEIGHT = 33
const INDENT = 18
const OVERSCAN = 8
/** How long a new row keeps its highlight; after that a row scrolling into view does not replay it. */
const FLASH_MS = 1000
const NO_IDS: ReadonlySet<string> = new Set<string>()

const KIND_ICON: Record<string, typeof Globe> = {
  domain: Globe,
  subdomain: Globe,
  ip: Network,
  cidr: Boxes,
  url: Link2,
}

export interface FlatRow {
  node: TargetNode
  depth: number
  hasChildren: boolean
  expanded: boolean
}

/**
 * Pure tree walk. Emits one row per node, recursing into a node's children
 * only when that node's id is present in `expanded`.
 */
export function flattenTree(nodes: TargetNode[], expanded: Set<string>): FlatRow[] {
  const out: FlatRow[] = []
  const walk = (list: TargetNode[], depth: number): void => {
    for (const node of list) {
      const hasChildren = node.children.length > 0
      const isExpanded = hasChildren && expanded.has(node.id)
      out.push({ node, depth, hasChildren, expanded: isExpanded })
      if (isExpanded) walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return out
}

/** Collect every node id in the (already-pruned) tree. */
function collectAllIds(nodes: TargetNode[], into: Set<string>): Set<string> {
  for (const n of nodes) {
    into.add(n.id)
    collectAllIds(n.children, into)
  }
  return into
}

/**
 * Ids of rows that appeared since the last load, kept for durationMs (FLASH_MS by default) and then
 * dropped. The set is computed from the data rather than per mounted row, so a
 * virtualized row that scrolls into view later does not animate again. `ready`
 * says the ids are this resetKey's loaded data (see useNewIds).
 */
export function useFlashIds(
  ids: readonly string[],
  resetKey: unknown,
  ready = ids.length > 0,
  durationMs = FLASH_MS,
): ReadonlySet<string> {
  const fresh = useNewIds(ids, resetKey, ready)
  const [state, setState] = useState({ resetKey, fresh, active: NO_IDS })
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  // Folded in while rendering, so a new row is flagged on the very render that adds it.
  // A different engagement starts clean: nothing from the old one lingers.
  let active = state.active
  const reset = !Object.is(state.resetKey, resetKey)
  if (reset || fresh !== state.fresh) {
    active = reset ? NO_IDS : state.active
    if (fresh.size > 0) active = new Set([...active, ...fresh])
    setState({ resetKey, fresh, active })
  }

  useEffect(() => {
    if (fresh.size === 0) return
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setState((prev) => {
        const next = new Set(prev.active)
        for (const id of fresh) next.delete(id)
        return { ...prev, active: next }
      })
    }, durationMs)
    timers.current.add(timer)
  }, [fresh, durationMs])

  // Pending expiries die with the engagement and with the component.
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const t of pending) clearTimeout(t)
      pending.clear()
    }
  }, [resetKey])

  return active
}

export interface VirtualTargetTreeProps {
  nodes: TargetNode[]
  selectedId: string | null
  onSelect: (node: TargetNode) => void
  filter: string
  /** Rows to highlight as freshly arrived. */
  newIds?: ReadonlySet<string>
  /**
   * Wraps each row, so a caller can put a context menu around it. The menu owns
   * the right-click itself: the tree only decides what a row looks like.
   */
  renderRow?: (node: TargetNode, row: JSX.Element) => JSX.Element
}

export function VirtualTargetTree({
  nodes,
  selectedId,
  onSelect,
  filter,
  newIds,
  renderRow,
}: VirtualTargetTreeProps): JSX.Element {
  // Track collapsed ids so nodes are expanded by default (matches prior UX).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const filtering = filter.trim() !== ''

  // Effective expanded set: when filtering, force every surviving node open so
  // matches are visible; otherwise everything is open except explicitly collapsed.
  const expanded = useMemo(() => {
    const all = collectAllIds(nodes, new Set<string>())
    if (filtering) return all
    for (const id of collapsed) all.delete(id)
    return all
  }, [nodes, collapsed, filtering])

  const rows = useMemo(() => flattenTree(nodes, expanded), [nodes, expanded])

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Measure viewport height on mount and on resize.
  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const measure = (): void => setViewportHeight(el.clientHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const total = rows.length
  // Fallback keeps rows painted before the container is measured (0 in jsdom).
  const effectiveHeight = viewportHeight > 0 ? viewportHeight : ROW_HEIGHT * 20
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(effectiveHeight / ROW_HEIGHT) + OVERSCAN * 2
  const last = Math.min(total, Math.max(first + visibleCount, first + OVERSCAN))
  const slice = rows.slice(first, last)

  const onRowActivate = useCallback(
    (row: FlatRow) => {
      onSelect(row.node)
      if (row.hasChildren && !filtering) toggle(row.node.id)
    },
    [onSelect, toggle, filtering],
  )

  return (
    <ScrollArea
      ref={scrollRef}
      className="min-h-0 flex-1 p-2"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      {/* Virtualized: the spacer height, each row's offset and its indent are
          computed per render, so they stay inline styles. */}
      <div role="tree" className="relative" style={{ height: `${total * ROW_HEIGHT}px` }}>
        {slice.map((row, i) => {
          const { node, depth, hasChildren, expanded: isOpen } = row
          const index = first + i
          const Icon = KIND_ICON[node.kind] ?? Globe
          const selected = node.id === selectedId
          const isNew = newIds?.has(node.id) === true
          const rowEl = (
            <div
              role="treeitem"
              aria-selected={selected}
              aria-expanded={hasChildren ? isOpen : undefined}
              data-new={isNew ? 'true' : undefined}
              tabIndex={-1}
              onClick={() => onRowActivate(row)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onRowActivate(row)
                } else if (e.key === 'ArrowRight' && hasChildren && !isOpen && !filtering) {
                  toggle(node.id)
                } else if (e.key === 'ArrowLeft' && hasChildren && isOpen && !filtering) {
                  toggle(node.id)
                }
              }}
              style={{ top: `${index * ROW_HEIGHT}px`, paddingLeft: `${depth * INDENT + 10}px` }}
              className={cn(
                'group absolute inset-x-0 flex h-8 cursor-pointer items-center gap-2 rounded-lg pr-2 text-[13px]',
                'outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50',
                isNew && 'motion-safe:animate-enter-flash-amber',
                selected ? 'bg-glass-active' : 'hover:bg-glass-strong',
              )}
            >
              {hasChildren ? (
                isOpen ? (
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                )
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <span className={cn('truncate font-mono text-[12px]', depth === 0 && 'font-medium')}>{node.value}</span>
              <span className="ml-auto flex shrink-0 items-center gap-2">
                <ScopeBadge status={node.scopeStatus} reason={node.scopeReason} />
                <Badge variant="muted">{node.source}</Badge>
              </span>
            </div>
          )

          return <Fragment key={node.id}>{renderRow === undefined ? rowEl : renderRow(node, rowEl)}</Fragment>
        })}
      </div>
    </ScrollArea>
  )
}
