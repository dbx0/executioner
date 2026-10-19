import type { JSX } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Crosshair, Info, ShieldAlert, ShieldCheck, Workflow, Wrench, Bot } from 'lucide-react'
import { useApp, type ViewId, type HubTab } from '../../store.js'
import { cn } from '../../lib/utils.js'

// Terminals is no longer a nav item: the workspace is the default view, reached
// by clicking a session below (or by opening a file from the explorer).
// Settings is no longer a top-nav item: it opens as a full page from the
// dedicated button at the bottom of the sidebar (see SidebarFooter).

/**
 * One nav row. A `view` row switches the whole view; a `hub` row opens the
 * shared workflows view on its own tab. Both shapes live in the same list so a
 * section can mix them — Automation holds two hub rows, Engagement three views.
 */
export type NavItem =
  | { kind: 'view'; id: ViewId; label: string; icon: LucideIcon }
  | { kind: 'hub'; tab: HubTab; label: string; icon: LucideIcon }

export interface NavGroup {
  label: string
  items: NavItem[]
}

/** The sidebar nav, grouped: what we know about the engagement, then what runs
 *  against it. About leads the group: it is the summary the other three pages
 *  hold the detail for. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Engagement',
    items: [
      { kind: 'view', id: 'about', label: 'About', icon: Info },
      { kind: 'view', id: 'scope', label: 'Scope', icon: ShieldCheck },
      { kind: 'view', id: 'targets', label: 'Targets', icon: Crosshair },
      { kind: 'view', id: 'findings', label: 'Findings', icon: ShieldAlert },
    ],
  },
  {
    label: 'Automation',
    items: [
      { kind: 'hub', tab: 'workflows', label: 'Workflows', icon: Workflow },
      { kind: 'view', id: 'tools', label: 'Tools', icon: Wrench },
      { kind: 'hub', tab: 'agents', label: 'Agents', icon: Bot },
    ],
  },
]

/** Render whichever row kind an item is. */
export function NavItemRow({ item }: { item: NavItem }): JSX.Element {
  return item.kind === 'view' ? (
    <NavRow id={item.id} label={item.label} icon={item.icon} />
  ) : (
    <HubNavRow tab={item.tab} label={item.label} icon={item.icon} />
  )
}

export function NavRow({ id, label, icon: Icon }: { id: ViewId; label: string; icon: LucideIcon }): JSX.Element {
  const active = useApp((s) => s.activeView === id)
  const disabled = useApp((s) => s.connection === null)
  const setActiveView = useApp((s) => s.setActiveView)
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      onClick={() => setActiveView(id)}
      className={cn(
        'group flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors disabled:opacity-40',
        active
          ? 'selected-surface text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-surface-2 hover:text-sidebar-foreground',
      )}
    >
      <Icon className="size-4" strokeWidth={active ? 2.25 : 1.75} />
      <span className="truncate">{label}</span>
    </button>
  )
}

/** A hub nav row (Workflows / Agents): both open the workflows view but select
 *  their own tab, so only the matching row reads active. */
export function HubNavRow({ tab, label, icon: Icon }: { tab: HubTab; label: string; icon: LucideIcon }): JSX.Element {
  const active = useApp((s) => s.activeView === 'workflows' && s.hubTab === tab)
  const disabled = useApp((s) => s.connection === null)
  const openHub = useApp((s) => s.openHub)
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      onClick={() => openHub(tab)}
      className={cn(
        'group flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors disabled:opacity-40',
        active
          ? 'selected-surface text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-surface-2 hover:text-sidebar-foreground',
      )}
    >
      <Icon className="size-4" strokeWidth={active ? 2.25 : 1.75} />
      <span className="truncate">{label}</span>
    </button>
  )
}
