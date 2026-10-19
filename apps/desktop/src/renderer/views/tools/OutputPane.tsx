import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Square, RotateCcw, Loader2, Maximize2 } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { cn } from '../../lib/utils.js'
import type { StandaloneRun } from '../../api/executions.js'
import type { SafeRow } from '../executions/row.js'
import { NodeOutputBody } from '../executions/NodeOutputBody.js'

/** The run the page is currently watching. */
export interface LiveRun {
  executionId: string
  nodeId: string
  /** 'running' until a done event arrives, then the engine's final status. */
  status: string
  startedAt: number
}

function statusDot(status: string): string {
  if (status === 'succeeded' || status === 'success') return 'bg-status-success'
  if (status === 'running') return 'bg-status-running animate-pulse'
  if (status === 'cancelled') return 'bg-muted-foreground'
  return 'bg-status-error'
}

const SIZE_KEY = 'exe.toolsOutputSize'
/** Side by side the handle sets the pane's width; stacked, its height. */
const WIDE = '(min-width: 1100px)'
const DEFAULT_SIZE = { width: 380, height: 480 }
const MIN_WIDTH = 300
const MIN_HEIGHT = 240
const STEP = 16

interface PaneSize {
  width: number
  height: number
}

function loadSize(): PaneSize {
  try {
    const raw = JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null') as Partial<PaneSize> | null
    if (raw !== null && typeof raw.width === 'number' && typeof raw.height === 'number') {
      return { width: Math.max(MIN_WIDTH, raw.width), height: Math.max(MIN_HEIGHT, raw.height) }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SIZE
}

function saveSize(size: PaneSize): void {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify(size))
  } catch {
    /* ignore */
  }
}

function isWide(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches
}

/** Keep the pane from swallowing the form beside or above it. */
function clampSize(size: PaneSize): PaneSize {
  return {
    width: Math.round(Math.min(Math.max(MIN_WIDTH, size.width), Math.max(MIN_WIDTH, window.innerWidth * 0.7))),
    height: Math.round(Math.min(Math.max(MIN_HEIGHT, size.height), Math.max(MIN_HEIGHT, window.innerHeight * 0.9))),
  }
}

/** How long ago an instant was, in the largest unit that fits. */
function ago(iso: string, now: number): string {
  const secs = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** When a run started and how long it took, for its line in the history. */
function runTiming(run: StandaloneRun, now: number): string | null {
  if (run.startedAt === null) return null
  const when = ago(run.startedAt, now)
  const end = run.finishedAt === null ? (run.status === 'running' ? now : null) : Date.parse(run.finishedAt)
  return end === null ? when : `${when} · ${elapsed(Date.parse(run.startedAt), end)}`
}

function elapsed(from: number, to: number): string {
  const secs = Math.max(0, Math.round((to - from) / 1000))
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

/**
 * The output pane: the watched run on top, the recent standalone runs below it.
 * While a run is live its stream scrolls by raw; once it settles the pane shows
 * what the engine saved, as the same stdout / stderr / parsed tabs a workflow
 * node's output gets. Selecting a recent run reloads the form that produced it
 * and shows that run's output, so a run is repeatable without retyping params.
 */
export function OutputPane({
  live,
  lines,
  result,
  onExpand,
  now,
  stopping,
  onStop,
  recent,
  selectedNodeId,
  watchingId,
  connectionLabel,
  nodeName,
  onReplay,
}: {
  live: LiveRun | null
  lines: string[]
  /** The settled run's saved output: undefined while it loads, null when the
   *  engine has none for it. Ignored while the run is live. */
  result: SafeRow | null | undefined
  /** Open the saved output in the full-size dialog. */
  onExpand: () => void
  /** A ticking clock, so the elapsed time advances while a run is live. */
  now: number
  stopping: boolean
  onStop: () => void
  recent: StandaloneRun[]
  /** The tool picked in the form; the history can narrow to its runs. */
  selectedNodeId: string | null
  /** The run shown above, marked in the history so it is clear which one it is. */
  watchingId: string | null
  /** Where a run executed, in words: its connection's name when known. */
  connectionLabel: (run: StandaloneRun) => string
  /** Resolve a node id to its display name; falls back to the id. */
  nodeName: (id: string) => string
  onReplay: (run: StandaloneRun) => void
}): JSX.Element {
  const bottom = useRef<HTMLDivElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<PaneSize>(loadSize)
  // The history narrows to the picked tool by default: its earlier runs are
  // what you compare against. "All" is one click away.
  const [onlyTool, setOnlyTool] = useState(true)
  const narrowed = onlyTool && selectedNodeId !== null
  const history = narrowed ? recent.filter((r) => r.nodeId === selectedNodeId) : recent
  const [wide, setWide] = useState(isWide)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(WIDE)
    const onChange = (): void => setWide(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Dragging the handle sizes the pane from its far edge to the pointer, so the
  // edge follows the cursor. Pointer capture keeps the drag alive off the handle.
  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const box = pane.current?.getBoundingClientRect()
    if (box === undefined) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    let latest = size
    const onMove = (ev: PointerEvent): void => {
      latest = clampSize(
        wide ? { ...latest, width: box.right - ev.clientX } : { ...latest, height: box.bottom - ev.clientY },
      )
      setSize(latest)
    }
    const handle = e.currentTarget
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      saveSize(latest)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  // Arrow keys grow or shrink the pane; double-click puts it back.
  const onHandleKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const grow = { ArrowLeft: STEP, ArrowUp: STEP, ArrowRight: -STEP, ArrowDown: -STEP }[e.key]
    if (grow === undefined) return
    e.preventDefault()
    const next = clampSize(wide ? { ...size, width: size.width + grow } : { ...size, height: size.height + grow })
    setSize(next)
    saveSize(next)
  }

  const resetSize = (): void => {
    setSize(DEFAULT_SIZE)
    saveSize(DEFAULT_SIZE)
  }
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [lines.length])

  return (
    <div
      ref={pane}
      style={{ '--output-w': `${size.width}px`, '--output-h': `${size.height}px` } as React.CSSProperties}
      className="relative flex h-[var(--output-h)] w-full shrink-0 flex-col border-t border-border min-[1100px]:h-full min-[1100px]:w-[var(--output-w)] min-[1100px]:border-l min-[1100px]:border-t-0"
    >
      <div
        role="separator"
        aria-label="Resize output"
        aria-orientation={wide ? 'vertical' : 'horizontal'}
        tabIndex={0}
        title="Drag to resize, double-click to reset"
        onPointerDown={onHandleDown}
        onKeyDown={onHandleKey}
        onDoubleClick={resetSize}
        className="absolute inset-x-0 -top-0.5 z-10 h-1.5 cursor-row-resize touch-none outline-none hover:bg-border-strong focus-visible:bg-ring/50 min-[1100px]:inset-x-auto min-[1100px]:inset-y-0 min-[1100px]:-left-0.5 min-[1100px]:top-0 min-[1100px]:h-full min-[1100px]:w-1.5 min-[1100px]:cursor-col-resize"
      />
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="text-[13px] font-medium">Output</span>
        {live !== null && (
          <>
            <span className={cn('size-1.5 rounded-full', statusDot(live.status))} />
            <span className="text-[11.5px] text-muted-foreground">
              {live.status === 'running' ? elapsed(live.startedAt, now) : live.status}
            </span>
            {live.status === 'running' && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Stop run"
                className="ml-auto"
                disabled={stopping}
                onClick={onStop}
              >
                {stopping ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
              </Button>
            )}
            {live.status !== 'running' && result != null && (
              <Button variant="ghost" size="icon-xs" aria-label="Expand output" className="ml-auto" onClick={onExpand}>
                <Maximize2 className="size-3.5" />
              </Button>
            )}
          </>
        )}
      </div>

      {live !== null && live.status !== 'running' ? (
        result === undefined ? (
          <p className="min-h-0 flex-1 bg-surface-1 p-3 text-[12.5px] text-muted-foreground">Loading output…</p>
        ) : result === null ? (
          <p className="min-h-0 flex-1 bg-surface-1 p-3 text-[12.5px] text-muted-foreground">
            No output was saved for this run.
          </p>
        ) : (
          // Keyed by run so switching runs resets the tab to that run's own default.
          <NodeOutputBody
            key={live.executionId}
            row={result}
            preferParsed
            subject="run"
            className="[--output-gutter:0.75rem]"
          />
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek bg-surface-1 p-3">
          {live === null ? (
            <p className="text-[12.5px] text-muted-foreground">Run a tool and its output lands here.</p>
          ) : lines.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">Waiting for output…</p>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed">
              {lines.join('')}
              <div ref={bottom} />
            </pre>
          )}
        </div>
      )}

      <div className="flex max-h-[45%] shrink-0 flex-col border-t border-border">
        <div className="flex shrink-0 items-center gap-2 px-3 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent runs</span>
          {selectedNodeId !== null && (
            <div role="group" aria-label="Show runs of" className="ml-auto flex items-center gap-0.5">
              {([
                [true, nodeName(selectedNodeId)],
                [false, 'All'],
              ] as const).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={onlyTool === value}
                  aria-label={value ? `Runs of ${label}` : 'All runs'}
                  onClick={() => setOnlyTool(value)}
                  className={cn(
                    'max-w-32 truncate rounded px-1.5 py-0.5 text-[11px]',
                    onlyTool === value ? 'selected-surface' : 'text-muted-foreground hover:bg-surface-2',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek px-1.5 pb-1.5">
          {history.length === 0 ? (
            <p className="px-1.5 pb-2 text-[12px] text-muted-foreground">
              {narrowed ? `No runs of ${nodeName(selectedNodeId)} yet.` : 'Nothing yet.'}
            </p>
          ) : (
            history.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => onReplay(run)}
                aria-label={`Load ${nodeName(run.nodeId)} run against ${run.targetValue ?? 'a removed target'}`}
                aria-current={run.id === watchingId ? 'true' : undefined}
                className={cn(
                  'group flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left',
                  run.id === watchingId ? 'selected-surface' : 'hover:bg-surface-2',
                )}
              >
                <span className={cn('size-1.5 shrink-0 rounded-full', statusDot(run.status))} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">{nodeName(run.nodeId)}</span>
                    {runTiming(run, now) !== null && (
                      <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                        {runTiming(run, now)}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {run.targetValue ?? 'target removed'} · {connectionLabel(run)}
                  </span>
                </span>
                <RotateCcw className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
