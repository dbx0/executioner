import type { JSX } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Bot, Boxes, KeyRound, Palette, Plug, ScrollText, SlidersHorizontal, Sparkles, Wrench } from 'lucide-react'
import { useApp } from '../store.js'
import { cn } from '../lib/utils.js'
import { GlassPanel } from '../components/ui/glass-panel.js'
import { Page, PageBody, PageToolbar } from '../components/ui/page.js'
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
    <Page>
      <PageToolbar title="Settings" />
      <PageBody>
        {/* Sub-navigation */}
        <GlassPanel asChild className="w-52 shrink-0">
          <nav data-tour="settings-nav" className="scrollbar-sleek flex flex-col gap-0.5 overflow-y-auto p-2">
            {SECTIONS.map(({ id, label, icon: Icon }) => {
              const selected = id === active
              return (
                <button
                  key={id}
                  type="button"
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => setSettingsSection(id)}
                  className={cn(
                    'flex h-8 w-full shrink-0 items-center gap-2.5 rounded-control px-3 text-[13px] outline-none transition-colors',
                    'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    selected
                      ? 'bg-glass-active font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-glass-strong hover:text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" strokeWidth={selected ? 2.25 : 1.75} />
                  <span className="truncate">{label}</span>
                </button>
              )
            })}
          </nav>
        </GlassPanel>

        {/* Content pane */}
        <GlassPanel className="scrollbar-sleek min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-6">
            <Body />
          </div>
        </GlassPanel>
      </PageBody>
    </Page>
  )
}
