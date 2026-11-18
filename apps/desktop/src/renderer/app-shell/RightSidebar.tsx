import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Files, Crosshair, Bot, Activity, GitBranch } from 'lucide-react'
import { useApp, type RightTab } from '../store.js'
import { cn } from '../lib/utils.js'
import { GlassPanel } from '../components/ui/glass-panel.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js'
import { WindowControls } from './WindowControls.js'
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
/** The tool column at the window's right edge: the 40px capsule with an 8px gutter each side. */
const RAIL_WIDTH = 56

function loadWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(raw) && raw >= MIN_WIDTH && raw <= MAX_WIDTH) return raw
  } catch {
    /* ignore */
  }
  return DEFAULT_WIDTH
}

/**
 * The far-right tool column, always visible: the window controls (Windows and
 * Linux only) over a floating capsule that switches the panel. Clicking the
 * active tab collapses the panel, so the capsule is also the panel toggle.
 */
function ActivityRail(): JSX.Element {
  const activeTab = useApp((s) => s.activeRightTab)
  const collapsed = useApp((s) => s.rightSidebarCollapsed)
  const setRightTab = useApp((s) => s.setRightTab)
  const toggleRightSidebar = useApp((s) => s.toggleRightSidebar)

  return (
    <div className="app-no-drag flex w-14 shrink-0 flex-col items-center gap-panel pb-panel pt-[10px]">
      <WindowControls />
      <div className="glass-panel flex w-10 flex-col items-center gap-1 rounded-control py-[5px]">
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
                    if (active) toggleRightSidebar()
                    else setRightTab(tab.id)
                  }}
                  className={cn(
                    'grid size-[30px] place-items-center rounded-full outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    active ? 'bg-glass-active text-foreground' : 'text-muted-foreground hover:bg-glass-strong hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" strokeWidth={active ? 2.1 : 1.75} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={10}>
                {tab.label}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
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
 * The right sidebar: the persistent tool column on the far right plus a
 * collapsible, resizable floating panel showing the active section. The page
 * beside it brings the gutter on the panel's left.
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
      // The panel sits left of the tool column; width = distance from the
      // column's left edge to the pointer.
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - e.clientX - RAIL_WIDTH))
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
    <div className="app-no-drag flex min-h-0 shrink-0">
      {!collapsed && (
        <div className="relative flex min-h-0 py-panel" style={{ width }}>
          {/* Resize handle on the panel's left edge. */}
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={onDown}
            className="absolute inset-y-panel -left-1 z-10 w-2 cursor-col-resize rounded-full transition-colors hover:bg-glass-active"
          />
          <GlassPanel className="flex min-h-0 w-full flex-col">
            <div className="min-h-0 flex-1 overflow-hidden">
              <ActivePanel tab={activeTab} />
            </div>
          </GlassPanel>
        </div>
      )}
      <ActivityRail />
    </div>
  )
}
