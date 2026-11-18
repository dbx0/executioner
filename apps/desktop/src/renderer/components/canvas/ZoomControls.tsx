import type { JSX, ReactNode } from 'react'
import { Maximize, Minus, Plus } from 'lucide-react'
import { useReactFlow, useStore } from 'reactflow'
import { Tip } from '../ui/tip.js'
import { cn } from '../../lib/utils.js'
import { CANVAS_CAPSULE } from './surface.js'

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }): JSX.Element {
  return (
    <Tip label={label} side="top">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex h-[26px] w-[30px] items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-glass-active hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {children}
      </button>
    </Tip>
  )
}

/**
 * The canvas zoom capsule: zoom out, the live zoom level, zoom in and fit to
 * view. It replaces the library's own control strip, and must render inside a
 * `ReactFlowProvider` so it can read and drive the viewport.
 */
export function ZoomControls({ className }: { className?: string }): JSX.Element {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const zoom = useStore((s) => s.transform[2])
  return (
    <div role="group" aria-label="Zoom" className={cn(CANVAS_CAPSULE, 'h-[34px] border border-glass-border', className)}>
      <ZoomButton label="Zoom out" onClick={() => zoomOut({ duration: 150 })}>
        <Minus aria-hidden className="size-3.5" strokeWidth={2} />
      </ZoomButton>
      <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
      <ZoomButton label="Zoom in" onClick={() => zoomIn({ duration: 150 })}>
        <Plus aria-hidden className="size-3.5" strokeWidth={2} />
      </ZoomButton>
      <ZoomButton label="Fit view" onClick={() => fitView({ padding: 0.2, duration: 250 })}>
        <Maximize aria-hidden className="size-3.5" strokeWidth={2} />
      </ZoomButton>
    </div>
  )
}
