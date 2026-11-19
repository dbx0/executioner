import type { JSX } from 'react'
import { Zap, Plus, Users } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { PageToolbar } from '../../components/ui/page.js'
import type { useApp } from '../../store.js'

export type HubTab = ReturnType<typeof useApp.getState>['hubTab']

const TITLES: Record<HubTab, string> = { workflows: 'Workflows', agents: 'Agents' }

/**
 * The hub's toolbar row; its actions depend on which tab is showing. The tab
 * itself is chosen from the sidebar, so the row only names it.
 */
export function HubHeader({
  tab,
  onCreateWorkflow,
  onOpenActions,
  onAddTeam,
  onAddAgent,
}: {
  tab: HubTab
  onCreateWorkflow: () => void
  onOpenActions: () => void
  onAddTeam: () => void
  onAddAgent: () => void
}): JSX.Element {
  return (
    <PageToolbar
      title={TITLES[tab]}
      actions={
        tab === 'workflows' ? (
          <>
            <Button variant="glass" size="sm" data-tour="workflows-schedules" onClick={onOpenActions}>
              <Zap className="size-3.5" strokeWidth={1.75} />
              Actions
            </Button>
            <Button size="sm" data-tour="workflows-create" onClick={onCreateWorkflow}>
              <Plus className="size-3.5" strokeWidth={2} />
              Create workflow
            </Button>
          </>
        ) : (
          <>
            <Button variant="glass" size="sm" data-tour="agents-add-team" onClick={onAddTeam}>
              <Users className="size-3.5" strokeWidth={1.75} />
              Add team
            </Button>
            <Button size="sm" data-tour="agents-add" onClick={onAddAgent}>
              <Plus className="size-3.5" strokeWidth={2} />
              Add agent
            </Button>
          </>
        )
      }
    />
  )
}
