import type { JSX } from 'react'
import { PanelLeft } from 'lucide-react'
import { useApp } from '../store.js'
import { cn } from '../lib/utils.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js'

/**
 * The show/hide sidebar button. It lives in the sidebar header, and floats
 * over the page corner as a glass capsule while the sidebar is hidden so there
 * is always a way back (the shortcut is Cmd/Ctrl+B).
 */
export function SidebarToggle({ floating = false, className }: { floating?: boolean; className?: string }): JSX.Element {
  const collapsed = useApp((s) => s.sidebarCollapsed)
  const toggleSidebar = useApp((s) => s.toggleSidebar)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
          aria-expanded={!collapsed}
          className={cn(
            'app-no-drag grid size-[30px] shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
            floating ? 'glass-panel rounded-control hover:bg-glass-active' : 'hover:bg-glass-strong',
            className,
          )}
        >
          <PanelLeft className="size-4" strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{collapsed ? 'Show sidebar' : 'Hide sidebar'}</TooltipContent>
    </Tooltip>
  )
}
