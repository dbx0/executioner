import type { JSX } from 'react'
import { Settings } from 'lucide-react'
import { useApp } from '../../store.js'
import { cn } from '../../lib/utils.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip.js'

/**
 * The sidebar footer: a compact rail of icon-only buttons. Just Settings today
 * (opens the full-page Settings screen — it is no longer a top-nav item); more
 * icons will sit alongside it here.
 */
export function SidebarFooter(): JSX.Element {
  const active = useApp((s) => s.activeView === 'settings')
  const disabled = useApp((s) => s.connection === null)
  const setActiveView = useApp((s) => s.setActiveView)
  return (
    <div className="flex items-center gap-0.5 border-t border-sidebar-border px-2 py-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-current={active ? 'page' : undefined}
            aria-label="Settings"
            disabled={disabled}
            onClick={() => setActiveView('settings')}
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-md transition-colors disabled:opacity-40',
              active
                ? 'selected-surface text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-surface-2 hover:text-sidebar-foreground',
            )}
          >
            <Settings className="size-4" strokeWidth={active ? 2.25 : 1.75} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Settings</TooltipContent>
      </Tooltip>
    </div>
  )
}
