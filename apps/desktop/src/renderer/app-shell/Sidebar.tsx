import type { JSX } from 'react'
import { Search } from 'lucide-react'
import { useApp } from '../store.js'
import { cn } from '../lib/utils.js'
import { GlassPanel } from '../components/ui/glass-panel.js'
import { ScrollArea } from '../components/ui/scroll-area.js'
import { EngagementRail } from './EngagementRail.js'
import { SidebarToggle } from './SidebarToggle.js'
import { isDarwin } from './platform.js'
import { NAV_GROUPS, NavItemRow } from './sidebar/NavRows.js'
import { SectionLabel } from './sidebar/SectionLabel.js'
import { SessionsSection } from './sidebar/SessionsSection.js'
import { RunsSection } from './sidebar/RunsSection.js'
import { SidebarFooter } from './sidebar/SidebarFooter.js'

/**
 * The top row of the sidebar. There is no title bar, so this row drags the
 * window and, on macOS, leaves its left end to the native traffic lights
 * (they sit at x 22 to 74 of the window, see `trafficLightPosition` in the main
 * process; the panel itself starts 8px in).
 */
function SidebarHeader(): JSX.Element {
  const engagementName = useApp((s) => s.engagementName)
  return (
    <div className={cn('app-drag flex h-11 shrink-0 items-center gap-2 pr-2.5', isDarwin() ? 'pl-[70px]' : 'pl-3.5')}>
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.01em]">
        {engagementName ?? 'Executioner'}
      </span>
      <SidebarToggle className="size-7" />
    </div>
  )
}

/**
 * The sidebar: one floating glass panel holding the header row, the engagement
 * rail (only once an engagement is open) and the nav column. With its 8px
 * inset it takes 312px of the window, 260px without the rail.
 */
export function Sidebar(): JSX.Element {
  const hasEngagement = useApp((s) => s.connection !== null)
  const hasRail = useApp((s) => s.open.length > 0)
  const setPalette = useApp((s) => s.setPalette)

  return (
    <div className="flex shrink-0 p-panel">
      <GlassPanel asChild>
        <aside className={cn('flex flex-col', hasRail ? 'w-[296px]' : 'w-[244px]')}>
          <SidebarHeader />
          <div className="flex min-h-0 flex-1">
            {hasRail && <EngagementRail />}
            <div className="flex min-w-0 flex-1 flex-col">
              <ScrollArea className="min-h-0 flex-1 px-2.5 pb-2 pt-0.5">
                <button
                  type="button"
                  data-tour="search"
                  onClick={() => setPalette(true)}
                  className="glass-capsule flex h-8 w-full items-center gap-2 px-3 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-glass-active hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Search className="size-3.5 shrink-0" strokeWidth={2} />
                  <span>Search</span>
                  <kbd className="ml-auto font-sans text-[11px] text-tertiary-foreground">⌘K</kbd>
                </button>

                <div data-tour="nav">
                  {NAV_GROUPS.map((group) => (
                    <nav key={group.label} className="flex flex-col gap-0.5">
                      <SectionLabel>{group.label}</SectionLabel>
                      {group.items.map((item) => (
                        <NavItemRow key={item.kind === 'view' ? item.id : item.tab} item={item} />
                      ))}
                    </nav>
                  ))}
                </div>

                {hasEngagement && <SessionsSection />}
              </ScrollArea>

              {/* Runs is pinned to the bottom of the sidebar (below the scrolling nav,
                  above the footer) so it stays put as the agent list grows. */}
              {hasEngagement && <RunsSection />}

              <SidebarFooter />
            </div>
          </div>
        </aside>
      </GlassPanel>
    </div>
  )
}
