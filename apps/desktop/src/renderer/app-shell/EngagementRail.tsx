import type { JSX } from 'react'
import { Plus, X } from 'lucide-react'
import { useApp } from '../store.js'
import { cn } from '../lib/utils.js'
import { EngagementBadge } from '../components/EngagementBadge.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js'

/** The square every rail entry shares, so the badges and the "+" line up. */
const SQUARE = 'flex size-[34px] items-center justify-center rounded-[11px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50'

const ASK_HINT = 'An agent needs you in the browser'

/**
 * The open engagements, as a column inside the sidebar panel. The active one
 * is the solid square; a small marker at the panel edge repeats that, because a
 * photo badge covers the square's own fill.
 */
export function EngagementRail(): JSX.Element {
  const open = useApp((s) => s.open)
  const activeRoot = useApp((s) => s.activeRoot)
  const switchEngagement = useApp((s) => s.switchEngagement)
  const closeEngagement = useApp((s) => s.closeEngagement)
  const openNewEngagement = useApp((s) => s.openNewEngagement)
  const setActiveView = useApp((s) => s.setActiveView)

  return (
    <div className="flex w-[52px] shrink-0 flex-col items-center gap-2 border-r border-glass-border pb-3 pt-1">
      {open.map((e) => {
        const active = e.root === activeRoot
        const asking = Object.keys(e.browserAsks).length > 0
        return (
          <div key={e.root} className="group relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => {
                    switchEngagement(e.root)
                    setActiveView('terminals')
                  }}
                  className={cn(
                    SQUARE,
                    'overflow-hidden',
                    active ? 'bg-primary text-primary-foreground' : 'bg-glass-strong text-foreground hover:bg-glass-active',
                  )}
                >
                  <EngagementBadge name={e.name} icon={e.icon} photo={e.photo} className="size-full" emojiClass="text-[17px]" initialsClass="text-[12px] font-semibold" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {e.name}
                {asking && <span className="block text-attention">{ASK_HINT}</span>}
              </TooltipContent>
            </Tooltip>
            {active && (
              <span aria-hidden className="absolute -left-[9px] top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-foreground" />
            )}
            {asking && (
              <span
                data-engagement-ask
                role="img"
                aria-label={ASK_HINT}
                className="pointer-events-none absolute -bottom-0.5 -left-0.5 size-2.5 animate-pulse rounded-full border border-background bg-attention"
              />
            )}
            <button
              type="button"
              onClick={() => closeEngagement(e.root)}
              className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full border border-glass-border bg-popover text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 group-focus-within:flex group-hover:flex"
              aria-label={`Close ${e.name}`}
            >
              <X className="size-2.5" />
            </button>
          </div>
        )
      })}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => openNewEngagement()}
            aria-label="New engagement"
            className={cn(SQUARE, 'border border-dashed border-border-strong text-muted-foreground hover:bg-glass-strong hover:text-foreground')}
          >
            <Plus className="size-4" strokeWidth={1.75} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">New engagement</TooltipContent>
      </Tooltip>
    </div>
  )
}
