import type { JSX } from 'react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Globe, Network, Link2, Boxes } from 'lucide-react'
import type { TargetNode } from '../../api/targets.js'
import { cn } from '../../lib/utils.js'
import { ScrollArea } from '../ui/scroll-area.js'
import { Badge } from '../ui/badge.js'
import { ScopeBadge } from './ScopeBadge.js'

const ROW_HEIGHT = 32
const OVERSCAN = 8

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

export interface VirtualTargetTreeProps {
  nodes: TargetNode[]
  selectedId: string | null
  onSelect: (node: TargetNode) => void
  filter: string
  /**
   * Wraps each row, so a caller can put a context menu around it. The menu owns
   * the right-click itself — the tree only decides what a row looks like.
   */
  renderRow?: (node: TargetNode, row: JSX.Element) => JSX.Element
}

export function VirtualTargetTree({
  nodes,
  selectedId,
  onSelect,
  filter,
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
      className="min-h-0 flex-1 px-2 py-2"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div role="tree" style={{ position: 'relative', height: `${total * ROW_HEIGHT}px` }}>
        {slice.map((row, i) => {
          const { node, depth, hasChildren, expanded: isOpen } = row
          const index = first + i
          const Icon = KIND_ICON[node.kind] ?? Globe
          const selected = node.id === selectedId
          const rowEl = (
            <div
              role="treeitem"
              aria-selected={selected}
              aria-expanded={hasChildren ? isOpen : undefined}
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
              style={{
                position: 'absolute',
                top: `${index * ROW_HEIGHT}px`,
                left: 0,
                right: 0,
                height: `${ROW_HEIGHT}px`,
                paddingLeft: `${depth * 16 + 8}px`,
              }}
              className={cn(
                'group flex items-center gap-2 rounded-md pr-2 text-[13px]',
                'cursor-pointer',
                selected
                  ? 'bg-surface-3'
                  : 'hover:bg-surface-2',
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
              <span className="truncate font-mono text-[12.5px]">{node.value}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
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
