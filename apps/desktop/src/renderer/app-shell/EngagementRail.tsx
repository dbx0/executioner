import type { JSX } from 'react'
import { Plus, X } from 'lucide-react'
import { useApp } from '../store.js'
import { cn } from '../lib/utils.js'
import { Button } from '../components/ui/button.js'
import { EngagementBadge } from '../components/EngagementBadge.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js'

export function EngagementRail(): JSX.Element {
  const open = useApp((s) => s.open)
  const activeRoot = useApp((s) => s.activeRoot)
  const switchEngagement = useApp((s) => s.switchEngagement)
  const closeEngagement = useApp((s) => s.closeEngagement)
  const openNewEngagement = useApp((s) => s.openNewEngagement)
  const setActiveView = useApp((s) => s.setActiveView)

  return (
    <div className="flex w-14 shrink-0 flex-col items-center gap-1.5 border-r border-sidebar-border bg-surface-1 py-2.5">
      {open.map((e) => {
        const active = e.root === activeRoot
        return (
          <div key={e.root} className="group relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    switchEngagement(e.root)
                    setActiveView('terminals')
                  }}
                  className={cn(
                    'flex size-10 items-center justify-center overflow-hidden rounded-xl transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground hover:bg-surface-3',
                  )}
                >
                  <EngagementBadge name={e.name} icon={e.icon} photo={e.photo} className="size-full" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{e.name}</TooltipContent>
            </Tooltip>
            {active && <span className="absolute -right-2.5 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-foreground" />}
            <button
              type="button"
              onClick={() => closeEngagement(e.root)}
              className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground group-hover:flex hover:text-foreground"
              aria-label={`Close ${e.name}`}
            >
              <X className="size-2.5" />
            </button>
          </div>
        )
      })}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-10 rounded-xl text-muted-foreground"
            onClick={() => openNewEngagement()}
            aria-label="New engagement"
          >
            <Plus className="size-5" strokeWidth={1.75} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">New engagement</TooltipContent>
      </Tooltip>
    </div>
  )
}
