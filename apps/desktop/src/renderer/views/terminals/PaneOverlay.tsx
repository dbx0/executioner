import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { dividers, ITEM_DRAG_TYPE, itemKey, leaves, rects, type ItemRef, type PaneNode, type Rect } from '../../lib/pane-tree.js'
import { useApp } from '../../store.js'
import { cn } from '../../lib/utils.js'
import type { Layout } from '../../store/types.js'
import { PanePicker } from './PanePicker.js'
import { TabMenuItem, TabMenuSeparator } from './TabMenu.js'

const pct = (n: number): string => `${n * 100}%`

const place = (r: Rect): { left: string; top: string; width: string; height: string } => ({
  left: pct(r.x),
  top: pct(r.y),
  width: pct(r.w),
  height: pct(r.h),
})

type Edge = 'left' | 'right' | 'top' | 'bottom'

/** The quarter-width / quarter-height band of a pane that a drop on `edge` targets. */
const EDGE_BAND: Record<Edge, { left: string; top: string; width: string; height: string }> = {
  left: { left: '0%', top: '0%', width: '25%', height: '100%' },
  right: { left: '75%', top: '0%', width: '25%', height: '100%' },
  top: { left: '25%', top: '0%', width: '50%', height: '25%' },
  bottom: { left: '25%', top: '75%', width: '50%', height: '25%' },
}

const hasItemDrag = (e: { dataTransfer: DataTransfer | null }): boolean =>
  e.dataTransfer?.types.includes(ITEM_DRAG_TYPE) === true

function parseItem(raw: string): ItemRef | null {
  try {
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null) return null
    const { kind, id } = v as { kind?: unknown; id?: unknown }
    return typeof kind === 'string' && typeof id === 'string' ? { kind, id } : null
  } catch {
    return null
  }
}

function lastLeafId(node: PaneNode): string {
  return node.type === 'leaf' ? node.id : lastLeafId(node.b)
}

/** The rect of the split whose divider sits after `leafIdInA`, as the union of its panes. */
function splitRect(root: PaneNode, leafIdInA: string): Rect | null {
  const all = rects(root)
  const find = (node: PaneNode): PaneNode | null => {
    if (node.type === 'leaf') return null
    if (lastLeafId(node.a) === leafIdInA) return node
    return find(node.a) ?? find(node.b)
  }
  const split = find(root)
  if (split === null) return null
  const panes = leaves(split).map((p) => all.get(p.id))
  const found = panes.filter((r): r is Rect => r !== undefined)
  if (found.length === 0) return null
  const x0 = Math.min(...found.map((r) => r.x))
  const y0 = Math.min(...found.map((r) => r.y))
  const x1 = Math.max(...found.map((r) => r.x + r.w))
  const y1 = Math.max(...found.map((r) => r.y + r.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** The right-click menu of a pane of the active layout. */
export function PaneMenu({
  x,
  y,
  leafId,
  onClose,
}: {
  x: number
  y: number
  leafId: string
  onClose: () => void
}): JSX.Element {
  const splitPane = useApp((s) => s.splitPane)
  const movePaneToNewTab = useApp((s) => s.movePaneToNewTab)
  const closePane = useApp((s) => s.closePane)
  const layout = useApp((s) => s.layouts.find((l) => l.id === s.activeLayoutId))
  const pinned = useApp((s) => s.activeLayoutId !== null && s.tabMeta[s.activeLayoutId]?.pinned === true)
  const multi = layout !== undefined && leaves(layout.root).length >= 2
  const run = (fn: () => void) => (): void => {
    onClose()
    fn()
  }
  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[70]"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
        className="fixed z-[71] min-w-[192px] rounded-md border border-border bg-popover p-1 text-[13px] text-foreground shadow-floating"
      >
        <TabMenuItem onClick={run(() => splitPane(leafId, 'row'))}>Split right</TabMenuItem>
        <TabMenuItem onClick={run(() => splitPane(leafId, 'col'))}>Split down</TabMenuItem>
        {multi && <TabMenuItem onClick={run(() => movePaneToNewTab(leafId))}>Move pane to new tab</TabMenuItem>}
        <TabMenuSeparator />
        <TabMenuItem disabled={pinned} onClick={run(() => closePane(leafId))}>
          Close pane
        </TabMenuItem>
      </div>
    </div>
  )
}

/**
 * Drawn over the pane bodies of the active layout: the draggable dividers, the focus ring
 * (only once there are two panes) and the picker slot of each empty pane. Dragging posts at
 * most one ratio per frame, so the terminals refit once per frame instead of once per event.
 */
export function PaneOverlay({ layout }: { layout: Layout }): JSX.Element {
  const focusPane = useApp((s) => s.focusPane)
  const setPaneRatio = useApp((s) => s.setPaneRatio)
  const splitPane = useApp((s) => s.splitPane)
  const hostRef = useRef<HTMLDivElement>(null)
  const stopDrag = useRef<(() => void) | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; leafId: string } | null>(null)
  // A tab is being dragged over the window: the edge drop zones show until it is dropped or cancelled.
  const [dragging, setDragging] = useState(false)
  const [overZone, setOverZone] = useState<string | null>(null)

  useEffect(() => {
    const enter = (e: DragEvent): void => {
      if (hasItemDrag(e)) setDragging(true)
    }
    const end = (): void => {
      setDragging(false)
      setOverZone(null)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', end)
    }
  }, [])

  // A drag in flight when the layout goes away must not keep listening.
  useEffect(() => () => stopDrag.current?.(), [])

  const panes = leaves(layout.root)
  const all = rects(layout.root)
  const multi = panes.length >= 2

  const startDrag = (e: ReactPointerEvent, leafIdInA: string, dir: 'row' | 'col'): void => {
    const host = hostRef.current
    const split = splitRect(layout.root, leafIdInA)
    if (host === null || split === null) return
    e.preventDefault()
    const box = host.getBoundingClientRect()
    let pending: number | null = null
    let frame = 0
    const onMove = (ev: PointerEvent): void => {
      const size = dir === 'row' ? box.width : box.height
      if (size === 0) return
      const frac = (dir === 'row' ? ev.clientX - box.left : ev.clientY - box.top) / size
      const start = dir === 'row' ? split.x : split.y
      const span = dir === 'row' ? split.w : split.h
      pending = (frac - start) / span
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (pending !== null) setPaneRatio(leafIdInA, pending)
      })
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      if (frame !== 0) cancelAnimationFrame(frame)
      if (pending !== null) setPaneRatio(leafIdInA, pending)
      stopDrag.current = null
    }
    stopDrag.current?.()
    stopDrag.current = stop
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0">
      {panes.map((p) => {
        const r = all.get(p.id)
        if (r === undefined) return null
        if (p.item === null) {
          return (
            <div
              key={p.id}
              data-testid={`empty-pane-${p.id}`}
              data-pane-leaf={p.id}
              className="pointer-events-auto absolute bg-card p-px"
              style={place(r)}
              onMouseDownCapture={() => focusPane(layout.id, p.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, leafId: p.id })
              }}
            >
              <PanePicker leafId={p.id} />
            </div>
          )
        }
        return null
      })}
      {multi &&
        panes.map((p) => {
          const r = all.get(p.id)
          if (r === undefined || p.id !== layout.focusedLeafId) return null
          return (
            <div
              key={`ring-${p.id}`}
              data-testid="focus-ring"
              className="absolute rounded-[2px] ring-1 ring-inset ring-border-strong"
              style={place(r)}
            />
          )
        })}
      {dividers(layout.root).map((d) => (
        <div
          key={`div-${d.leafIdInA}`}
          role="separator"
          aria-orientation={d.dir === 'row' ? 'vertical' : 'horizontal'}
          className="pointer-events-none absolute"
          style={place(d.rect)}
        >
          {/* The visible 1px line on the seam; the wider hit area below only catches the drag. */}
          <div
            data-testid="divider-line"
            className={
              d.dir === 'row'
                ? 'pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border'
                : 'pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border'
            }
          />
          <div
            className={
              d.dir === 'row'
                ? 'pointer-events-auto absolute inset-y-0 -inset-x-[3px] cursor-col-resize touch-none hover:bg-border-strong/60'
                : 'pointer-events-auto absolute inset-x-0 -inset-y-[3px] cursor-row-resize touch-none hover:bg-border-strong/60'
            }
            onPointerDown={(e) => startDrag(e, d.leafIdInA, d.dir)}
          />
        </div>
      ))}
      {dragging &&
        panes.map((p) => {
          const r = all.get(p.id)
          if (r === undefined) return null
          return (
            <div key={`drop-${p.id}`} className="pointer-events-none absolute" style={place(r)}>
              {(Object.keys(EDGE_BAND) as Edge[]).map((edge) => {
                const zone = `${p.id}:${edge}`
                return (
                  <div
                    key={edge}
                    data-testid={`drop-${edge}-${p.id}`}
                    className={cn(
                      'pointer-events-auto absolute border-2 transition-colors',
                      overZone === zone ? 'border-border-strong bg-surface-3' : 'border-transparent',
                    )}
                    style={EDGE_BAND[edge]}
                    onDragOver={(e) => {
                      if (!hasItemDrag(e)) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      setOverZone(zone)
                    }}
                    onDragLeave={() => setOverZone((z) => (z === zone ? null : z))}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragging(false)
                      setOverZone(null)
                      const item = parseItem(e.dataTransfer.getData(ITEM_DRAG_TYPE))
                      // Dropping an item onto its own pane would split it away from itself.
                      if (item === null || (p.item !== null && itemKey(p.item) === itemKey(item))) return
                      splitPane(p.id, edge === 'left' || edge === 'right' ? 'row' : 'col', item, edge === 'left' || edge === 'top')
                    }}
                  />
                )
              })}
            </div>
          )
        })}
      {menu !== null && <PaneMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
