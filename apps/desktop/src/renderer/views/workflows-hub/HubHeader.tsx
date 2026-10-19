import type { JSX } from 'react'
import { CalendarClock, Plus, Users, Workflow } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import type { useApp } from '../../store.js'

export type HubTab = ReturnType<typeof useApp.getState>['hubTab']

/** The hub's title bar; its actions depend on which tab is showing. */
export function HubHeader({
  tab,
  onCreateWorkflow,
  onShowSchedules,
  onAddTeam,
  onAddAgent,
}: {
  tab: HubTab
  onCreateWorkflow: () => void
  onShowSchedules: () => void
  onAddTeam: () => void
  onAddAgent: () => void
}): JSX.Element {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
      <Workflow className="size-4 text-muted-foreground" strokeWidth={1.75} />
      <span className="text-sm font-medium capitalize">{tab}</span>
      {tab === 'workflows' ? (
        <>
          <Button variant="outline" size="sm" className="ml-auto" onClick={onShowSchedules}>
            <CalendarClock className="size-4" strokeWidth={1.75} />
            Schedules
          </Button>
          <Button size="sm" onClick={onCreateWorkflow}>
            <Plus className="size-4" strokeWidth={2} />
            Create workflow
          </Button>
        </>
      ) : (
        <>
          <Button variant="outline" size="sm" className="ml-auto" onClick={onAddTeam}>
            <Users className="size-4" strokeWidth={1.75} />
            Add team
          </Button>
          <Button size="sm" onClick={onAddAgent}>
            <Plus className="size-4" strokeWidth={2} />
            Add agent
          </Button>
        </>
      )}
    </div>
  )
}
