import type { JSX, RefObject } from 'react'
import type { LogLevel, LogLine } from '@exe/protocol'
import { GlassPanel } from '../../components/ui/glass-panel.js'
import { LoadingState } from '../../components/ui/spinner.js'
import { cn } from '../../lib/utils.js'

export const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: 'text-tertiary-foreground',
  info: 'text-muted-foreground',
  warn: 'text-status-warning',
  error: 'text-status-error',
}

/**
 * The log lines, on an ink card like every other terminal-like surface. A line
 * that carries structured data is a button that unfolds it.
 */
export function LogList({
  listRef,
  onScroll,
  loading,
  lines,
  visible,
  expanded,
  onToggle,
}: {
  listRef: RefObject<HTMLDivElement | null>
  onScroll: (el: HTMLDivElement) => void
  /** The selected session has not been read yet. */
  loading: boolean
  /** Every line of the session: a line's index here is its stable key. */
  lines: LogLine[]
  /** The lines that pass the level and source filters. */
  visible: LogLine[]
  expanded: Set<number>
  onToggle: (key: number) => void
}): JSX.Element {
  return (
    <GlassPanel
      tone="ink"
      ref={listRef as RefObject<HTMLDivElement>}
      onScroll={(e) => onScroll(e.currentTarget as HTMLDivElement)}
      className="scrollbar-sleek mt-3 min-h-0 flex-1 overflow-auto rounded-[14px] p-2 font-mono text-[12px] leading-relaxed"
    >
      {loading ? (
        <LoadingState label="Loading log" className="font-sans" />
      ) : visible.length === 0 ? (
        <span className="text-muted-foreground">No log lines match.</span>
      ) : (
        visible.map((l, i) => {
          const key = lines.indexOf(l)
          const open = expanded.has(key)
          const hasData = l.data !== undefined
          return (
            <div key={key} className="border-b border-glass-border last:border-0">
              <div
                role={hasData ? 'button' : undefined}
                tabIndex={hasData ? 0 : undefined}
                onClick={hasData ? () => onToggle(key) : undefined}
                onKeyDown={
                  hasData
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') onToggle(key)
                      }
                    : undefined
                }
                className={cn(
                  'flex gap-2 rounded-md px-1 py-0.5 outline-none',
                  hasData && 'cursor-pointer hover:bg-glass-strong focus-visible:ring-[3px] focus-visible:ring-ring/50',
                )}
                data-index={i}
              >
                <span className="shrink-0 text-tertiary-foreground">{l.t.slice(11, 23)}</span>
                <span className={cn('w-10 shrink-0 uppercase', LEVEL_COLOR[l.lvl])}>{l.lvl}</span>
                <span className="w-28 shrink-0 truncate text-muted-foreground" title={l.src}>
                  {l.src}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{l.msg}</span>
              </div>
              {open && hasData && (
                <pre className="scrollbar-sleek mb-1 ml-6 overflow-auto rounded-md bg-glass-strong p-2 text-[11.5px]">
                  {JSON.stringify(l.data, null, 2)}
                </pre>
              )}
            </div>
          )
        })
      )}
    </GlassPanel>
  )
}
