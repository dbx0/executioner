import type { JSX } from 'react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

export function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</div>
  )
}

/**
 * A vertical split of two panes with a draggable divider between them. The top
 * pane's share is a ratio persisted under `storageKey`; dragging the handle
 * resizes both. Each pane manages its own scrolling (min-h-0 lets it shrink).
 */
export function ResizableRows({
  storageKey,
  top,
  bottom,
}: {
  storageKey: string
  top: ReactNode
  bottom: ReactNode
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [ratio, setRatio] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(storageKey))
      if (Number.isFinite(v) && v >= 0.15 && v <= 0.85) return v
    } catch {
      /* ignore */
    }
    return 0.5
  })

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!dragging.current) return
      const el = containerRef.current
      if (el === null) return
      const rect = el.getBoundingClientRect()
      const r = Math.min(0.85, Math.max(0.15, (e.clientY - rect.top) / rect.height))
      setRatio(r)
    }
    const onUp = (): void => {
      if (!dragging.current) return
      dragging.current = false
      try {
        localStorage.setItem(storageKey, String(ratio))
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [ratio, storageKey])

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-col" style={{ flex: `${ratio} 1 0%` }}>
        {top}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        onMouseDown={(e) => {
          e.preventDefault()
          dragging.current = true
        }}
        className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
      >
        <div className="h-[3px] w-10 rounded-full bg-border transition-colors group-hover:bg-border-strong" />
      </div>
      <div className="flex min-h-0 flex-col" style={{ flex: `${1 - ratio} 1 0%` }}>
        {bottom}
      </div>
    </div>
  )
}
