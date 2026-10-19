import type { JSX } from 'react'
import { PanelLeft, PanelRight, PanelRightClose } from 'lucide-react'
import { useApp, type ViewId } from '../store.js'
import { Button } from '../components/ui/button.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js'

const VIEW_TITLES: Record<ViewId, string> = {
  about: 'About',
  scope: 'Scope',
  targets: 'Targets',
  findings: 'Findings',
  workflows: 'Workflows',
  tools: 'Tools',
  terminals: 'Terminals',
  settings: 'Settings',
}

export function Titlebar(): JSX.Element {
  const engagementName = useApp((s) => s.engagementName)
  const activeView = useApp((s) => s.activeView)
  const hubTab = useApp((s) => s.hubTab)
  // The workflows view hosts both the Workflows and Agents tabs, so the title
  // tracks the active tab there.
  const title = activeView === 'workflows' && hubTab === 'agents' ? 'Agents' : VIEW_TITLES[activeView]
  const rightCollapsed = useApp((s) => s.rightSidebarCollapsed)
  const toggleRightSidebar = useApp((s) => s.toggleRightSidebar)
  const toggleSidebar = useApp((s) => s.toggleSidebar)

  return (
    <header className="app-drag flex h-9 shrink-0 items-center gap-1 border-b border-border bg-card px-2 pl-[76px] text-[13px]">
      <Button
        variant="ghost"
        size="icon-xs"
        className="app-no-drag text-muted-foreground"
        onClick={toggleSidebar}
        aria-label="Toggle sidebar"
      >
        <PanelLeft className="size-4" strokeWidth={1.75} />
      </Button>

      <div className="flex min-w-0 items-center gap-1.5 font-medium">
        <span className="truncate text-foreground">
          {engagementName ?? 'Executioner'}
        </span>
        {engagementName !== null && (
          <>
            <span className="text-tertiary-foreground">/</span>
            <span className="truncate text-muted-foreground">{title}</span>
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="app-no-drag text-muted-foreground"
              onClick={toggleRightSidebar}
              aria-label={rightCollapsed ? 'Show panel' : 'Hide panel'}
            >
              {rightCollapsed ? <PanelRight className="size-4" strokeWidth={1.75} /> : <PanelRightClose className="size-4" strokeWidth={1.75} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{rightCollapsed ? 'Show panel' : 'Hide panel'}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
