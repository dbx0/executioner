import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Files, Crosshair, Bot, Activity, GitBranch } from 'lucide-react'
import { useApp, type RightTab } from '../store.js'
import { cn } from '../lib/utils.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js'
import { FileExplorer } from '../components/right-sidebar/FileExplorer.js'
import { TargetsPanel } from '../components/right-sidebar/TargetsPanel.js'
import { SessionHistory } from '../components/right-sidebar/SessionHistory.js'
import { ExecutionHistory } from '../components/right-sidebar/ExecutionHistory.js'
import { SourceControl } from '../components/right-sidebar/SourceControl.js'

const TABS: { id: RightTab; label: string; icon: LucideIcon }[] = [
  { id: 'explorer', label: 'Explorer', icon: Files },
  { id: 'targets', label: 'Targets', icon: Crosshair },
  { id: 'sessions', label: 'Agent Sessions', icon: Bot },
  { id: 'executions', label: 'Executions', icon: Activity },
  { id: 'git', label: 'Source Control', icon: GitBranch },
]

const WIDTH_KEY = 'exe.rightSidebarWidth'
const MIN_WIDTH = 240
const MAX_WIDTH = 560
const DEFAULT_WIDTH = 320

function loadWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(raw) && raw >= MIN_WIDTH && raw <= MAX_WIDTH) return raw
  } catch {
    /* ignore */
  }
  return DEFAULT_WIDTH
}

/** The far-right activity rail: always visible, switches/toggles the panel. */
function ActivityRail(): JSX.Element {
  const activeTab = useApp((s) => s.activeRightTab)
  const collapsed = useApp((s) => s.rightSidebarCollapsed)
  const setRightTab = useApp((s) => s.setRightTab)
  const toggleRightSidebar = useApp((s) => s.toggleRightSidebar)

  return (
    <div className="app-no-drag flex w-10 shrink-0 flex-col items-center gap-1 border-l border-sidebar-border bg-sidebar py-2">
      {TABS.map((tab) => {
        const Icon = tab.icon
        const active = !collapsed && tab.id === activeTab
        return (
          <Tooltip key={tab.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-current={active ? 'page' : undefined}
                aria-label={tab.label}
                onClick={() => {
                  if (!collapsed && tab.id === activeTab) toggleRightSidebar()
                  else setRightTab(tab.id)
                }}
                className={cn(
                  'relative flex size-8 items-center justify-center rounded-md transition-colors',
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
                )}
              >
                <Icon className="size-[18px]" strokeWidth={active ? 2.1 : 1.75} />
                {active && (
                  <span className="absolute right-0 top-1/4 bottom-1/4 w-[2px] rounded-l bg-foreground" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" sideOffset={6}>
              {tab.label}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

function ActivePanel({ tab }: { tab: RightTab }): JSX.Element {
  switch (tab) {
    case 'explorer':
      return <FileExplorer />
    case 'targets':
      return <TargetsPanel />
    case 'sessions':
      return <SessionHistory />
    case 'executions':
      return <ExecutionHistory />
    case 'git':
      return <SourceControl />
  }
}

/**
 * The right sidebar: a persistent activity rail on the far right plus a
 * collapsible, resizable panel showing the active section. Owns only its own
 * layout — the rest of the Shell is untouched.
 */
export function RightSidebar(): JSX.Element {
  const collapsed = useApp((s) => s.rightSidebarCollapsed)
  const activeTab = useApp((s) => s.activeRightTab)
  const [width, setWidth] = useState<number>(loadWidth)
  const draggingRef = useRef(false)

  const onDown = useCallback((e: React.MouseEvent): void => {
    e.preventDefault()
    draggingRef.current = true
  }, [])

  useEffect(() => {
    if (collapsed) return
    const onMove = (e: MouseEvent): void => {
      if (!draggingRef.current) return
      // The panel sits left of the 40px rail; width = distance from the rail's
      // left edge to the pointer.
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - e.clientX - 40))
      setWidth(next)
    }
    const onUp = (): void => {
      if (!draggingRef.current) return
      draggingRef.current = false
      try {
        localStorage.setItem(WIDTH_KEY, String(width))
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
  }, [collapsed, width])

  return (
    <div className="flex min-h-0 shrink-0">
      {!collapsed && (
        <div className="relative flex min-h-0" style={{ width }}>
          {/* Resize handle on the panel's left edge. */}
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={onDown}
            className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-border-strong"
          />
          <div className="flex min-h-0 w-full flex-col border-l border-sidebar-border bg-sidebar">
            <div className="min-h-0 flex-1 overflow-hidden">
              <ActivePanel tab={activeTab} />
            </div>
          </div>
        </div>
      )}
      <ActivityRail />
    </div>
  )
}
