import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '../../lib/utils.js'

export interface GlassPanelProps extends React.HTMLAttributes<HTMLElement> {
  /** Render the child element as the panel (a `section`, an `aside`) instead of a `div`. */
  asChild?: boolean
  /** A pitch-black inset surface with a hairline border, for a terminal or an editor. */
  tone?: 'glass' | 'ink'
}

/**
 * A floating panel: the sidebar, a card, a side panel. Every panel in the app
 * is one of these, so the surface, border and radius come from one place.
 */
export const GlassPanel = React.forwardRef<HTMLElement, GlassPanelProps>(
  ({ className, asChild = false, tone = 'glass', ...props }, ref) => {
    const Comp = asChild ? Slot : 'div'
    return (
      <Comp
        ref={ref as React.Ref<HTMLDivElement>}
        className={cn(
          tone === 'glass' ? 'glass-panel' : 'rounded-panel border border-glass-border bg-background',
          'overflow-hidden',
          className,
        )}
        {...props}
      />
    )
  },
)
GlassPanel.displayName = 'GlassPanel'
