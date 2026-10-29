import type { CSSProperties } from 'react'

/** Edge stroke while the node it leaves has succeeded in the current run. */
export function edgeRunStyle(sourceStatus: string | undefined): CSSProperties | undefined {
  if (sourceStatus !== 'success') return undefined
  return {
    stroke: 'var(--status-success)',
    strokeWidth: 1.8,
    opacity: 1,
    transition: 'stroke .3s, stroke-width .3s, opacity .3s',
  }
}
