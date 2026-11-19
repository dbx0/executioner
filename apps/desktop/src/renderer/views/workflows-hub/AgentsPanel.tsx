import type { JSX, ReactNode } from 'react'
import { ScrollArea } from '../../components/ui/scroll-area.js'
import type { SavedAgent } from '../../api/saved-agents.js'
import { AddTile, AgentCard, CardsSkeleton } from './cards.js'
import { SectionLabel } from './layout.js'

/** One titled, scrollable grid of agent cards led by its Add tile. */
function AgentGrid({
  title,
  tour,
  children,
}: {
  title: string
  /** The page-tour anchor for this section, when it has one. */
  tour?: string
  children: ReactNode
}): JSX.Element {
  return (
    <section data-tour={tour} className="flex min-h-0 flex-1 flex-col gap-2">
      <SectionLabel>{title}</SectionLabel>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-panel pb-1">{children}</div>
      </ScrollArea>
    </section>
  )
}

/** The Agents tab: split into Teams and Agents, each its own scrollable grid. */
export function AgentsPanel({
  teams,
  singleAgents,
  loading,
  deletingId,
  onAddTeam,
  onAddAgent,
  onRun,
  onEdit,
  onDelete,
}: {
  teams: SavedAgent[]
  singleAgents: SavedAgent[]
  /** First load still in flight: show placeholder tiles instead of empty grids. */
  loading: boolean
  /** The agent being deleted right now, if any. */
  deletingId: string | null
  onAddTeam: () => void
  onAddAgent: () => void
  onRun: (a: SavedAgent) => void
  onEdit: (a: SavedAgent) => void
  onDelete: (a: SavedAgent) => void
}): JSX.Element {
  const card = (a: SavedAgent): JSX.Element => (
    <AgentCard
      key={a.id}
      agent={a}
      deleting={deletingId === a.id}
      onRun={() => onRun(a)}
      onEdit={() => onEdit(a)}
      onDelete={() => onDelete(a)}
    />
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-1 pt-1">
      <AgentGrid title="Teams" tour="agents-teams">
        <AddTile label="Add team" onClick={onAddTeam} />
        {loading && <CardsSkeleton label="Loading teams" className="min-h-[104px]" />}
        {teams.map(card)}
      </AgentGrid>
      <AgentGrid title="Agents">
        <AddTile label="Add agent" onClick={onAddAgent} />
        {loading && <CardsSkeleton label="Loading agents" className="min-h-[104px]" />}
        {singleAgents.map(card)}
      </AgentGrid>
    </div>
  )
}
