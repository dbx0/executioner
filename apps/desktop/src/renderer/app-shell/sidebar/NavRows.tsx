import type { JSX } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Crosshair, Info, ShieldAlert, ShieldCheck, Workflow, Wrench, Bot, Zap } from 'lucide-react'
import { useApp, type ViewId, type HubTab } from '../../store.js'
import { SidebarRow } from './SidebarRow.js'

// Terminals is no longer a nav item: the workspace is the default view, reached
// by clicking a session below (or by opening a file from the explorer).
// Settings is no longer a top-nav item: it opens as a full page from the
// dedicated button at the bottom of the sidebar (see SidebarFooter).

/**
 * One nav row. A `view` row switches the whole view; a `hub` row opens the
 * shared workflows view on its own tab. Both shapes live in the same list so a
 * section can mix them — Automation holds two hub rows and two views, Engagement four views.
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
      { kind: 'view', id: 'actions', label: 'Actions', icon: Zap },
      { kind: 'hub', tab: 'workflows', label: 'Workflows', icon: Workflow },
      { kind: 'view', id: 'tools', label: 'Tools', icon: Wrench },
      { kind: 'hub', tab: 'agents', label: 'Agents', icon: Bot },
    ],
  },
]

/**
 * One nav row, whichever kind it is. A hub row reads active only on its own
 * tab, since both hub rows open the same view.
 */
export function NavItemRow({ item }: { item: NavItem }): JSX.Element {
  const active = useApp((s) =>
    item.kind === 'view' ? s.activeView === item.id : s.activeView === 'workflows' && s.hubTab === item.tab,
  )
  const disabled = useApp((s) => s.connection === null)
  const setActiveView = useApp((s) => s.setActiveView)
  const openHub = useApp((s) => s.openHub)
  const Icon = item.icon
  return (
    <SidebarRow
      active={active}
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      onClick={() => (item.kind === 'view' ? setActiveView(item.id) : openHub(item.tab))}
    >
      <Icon className="size-4 shrink-0" strokeWidth={active ? 2.1 : 1.75} />
      <span className="truncate">{item.label}</span>
    </SidebarRow>
  )
}
