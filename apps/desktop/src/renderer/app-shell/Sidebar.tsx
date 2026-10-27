import type { JSX } from 'react'
import { Search } from 'lucide-react'
import { useApp } from '../store.js'
import { ScrollArea } from '../components/ui/scroll-area.js'
import { NAV_GROUPS, NavItemRow } from './sidebar/NavRows.js'
import { SectionLabel } from './sidebar/SectionLabel.js'
import { SessionsSection } from './sidebar/SessionsSection.js'
import { RunsSection } from './sidebar/RunsSection.js'
import { SidebarFooter } from './sidebar/SidebarFooter.js'

export function Sidebar(): JSX.Element {
  const hasEngagement = useApp((s) => s.connection !== null)
  const setPalette = useApp((s) => s.setPalette)

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <ScrollArea className="min-h-0 flex-1 px-2 pb-2 pt-2">
        <button
          type="button"
          data-tour="search"
          onClick={() => setPalette(true)}
          // Deliberately muted: the palette opener sits distinctly quieter than
          // the nav items (which are sidebar-foreground/65). Its own opacity-60
          // guarantees it reads dimmer even where --muted-foreground resolves
          // close to --sidebar-foreground. Hover lifts only the background.
          className="mb-1 flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-muted-foreground opacity-60 transition-[background-color,opacity] hover:bg-surface-2"
        >
          <Search className="size-4" strokeWidth={1.75} />
          <span>Search</span>
          <kbd className="ml-auto rounded border border-border px-1 text-[10px]">⌘K</kbd>
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
    </aside>
  )
}
