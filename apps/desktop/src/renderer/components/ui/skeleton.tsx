import type { JSX } from 'react'
import * as React from 'react'
import { cn } from '../../lib/utils.js'

/**
 * A placeholder bar for content that has not arrived yet. Compose these into a
 * shape that matches the real rows, so the list does not jump when data lands.
 *
 * Presentational only: it carries no role of its own. Give the *group* of bars a
 * `role="status"` with a label ("Loading findings"), so a screen reader hears one
 * announcement instead of one per bar.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn(
        'animate-pulse rounded bg-surface-3',
        className,
      )}
      {...props}
    />
  )
}
