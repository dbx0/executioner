import type { JSX } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Bot, Boxes, KeyRound, Palette, Plug, ScrollText, SlidersHorizontal, Sparkles, Wrench } from 'lucide-react'
import { useApp } from '../store.js'
import { cn } from '../lib/utils.js'
import { AgentsSection } from './settings/AgentsSection.js'
import { NodesSection } from './settings/NodesSection.js'
import { ToolsSection } from './settings/tools/ToolsSection.js'
import { SkillsSection } from './settings/SkillsSection.js'
import { AppearanceSection } from './settings/AppearanceSection.js'
import { ConnectionsSection } from './settings/ConnectionsSection.js'
import { GeneralSection } from './settings/GeneralSection.js'
import { SecretsSectionPage } from './settings/SecretsSectionPage.js'
import { LogsSection } from './settings/LogsSection.js'

interface Section {
  id: string
  label: string
  icon: LucideIcon
  Component: () => JSX.Element
}

/** Adding a settings sub-page = one entry here + one component. */
const SECTIONS: Section[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, Component: GeneralSection },
  { id: 'appearance', label: 'Appearance', icon: Palette, Component: AppearanceSection },
  { id: 'connections', label: 'Connections', icon: Plug, Component: ConnectionsSection },
  { id: 'agents', label: 'Agents', icon: Bot, Component: AgentsSection },
  { id: 'nodes', label: 'Nodes', icon: Boxes, Component: NodesSection },
  { id: 'skills', label: 'Skills', icon: Sparkles, Component: SkillsSection },
  { id: 'tools', label: 'Tools', icon: Wrench, Component: ToolsSection },
  { id: 'secrets', label: 'Secrets', icon: KeyRound, Component: SecretsSectionPage },
  { id: 'logs', label: 'Logs', icon: ScrollText, Component: LogsSection },
]

/**
 * The full-page Settings screen: a left sub-navigation of sections and a content
 * pane. Reached from the bottom of the app sidebar (not the top NAV).
 */
export function SettingsView(): JSX.Element {
  const active = useApp((s) => s.settingsSection) ?? 'general'
  const setSettingsSection = useApp((s) => s.setSettingsSection)
  const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0]!
  const Body = current.Component

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center border-b border-border px-4 text-sm font-medium">Settings</div>
      <div className="flex min-h-0 flex-1">
        {/* Sub-navigation */}
        <nav data-tour="settings-nav" className="w-52 shrink-0 overflow-y-auto scrollbar-sleek border-r border-border p-2">
          {SECTIONS.map(({ id, label, icon: Icon }) => {
            const selected = id === active
            return (
              <button
                key={id}
                type="button"
                aria-current={selected ? 'page' : undefined}
                onClick={() => setSettingsSection(id)}
                className={cn(
                  'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors',
                  selected
                    ? 'selected-surface text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-surface-2 hover:text-sidebar-foreground',
                )}
              >
                <Icon className="size-4" strokeWidth={selected ? 2.25 : 1.75} />
                <span className="truncate">{label}</span>
              </button>
            )
          })}
        </nav>

        {/* Content pane */}
        <div className="min-w-0 flex-1 overflow-y-auto scrollbar-sleek">
          <div className="mx-auto w-full max-w-3xl px-6 pt-6 pb-16">
            <Body />
          </div>
        </div>
      </div>
    </div>
  )
}
