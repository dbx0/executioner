import type { JSX } from 'react'
import { ScrollArea } from '../../components/ui/scroll-area.js'
import type { SavedAgent } from '../../api/saved-agents.js'
import { AddTile, AgentCard } from './cards.js'
import { SectionLabel } from './layout.js'

/** The Agents tab: split into Teams and Agents, each its own scrollable grid. */
export function AgentsPanel({
  teams,
  singleAgents,
  onAddTeam,
  onAddAgent,
  onEdit,
  onDelete,
}: {
  teams: SavedAgent[]
  singleAgents: SavedAgent[]
  onAddTeam: () => void
  onAddAgent: () => void
  onEdit: (a: SavedAgent) => void
  onDelete: (a: SavedAgent) => void
}): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <section data-tour="agents-teams" className="flex min-h-0 flex-1 flex-col gap-2">
        <SectionLabel>Teams</SectionLabel>
        <ScrollArea className="-mx-1 min-h-0 flex-1 px-1">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 pb-1">
            <AddTile label="Add team" onClick={onAddTeam} />
            {teams.map((a) => (
              <AgentCard key={a.id} agent={a} onEdit={() => onEdit(a)} onDelete={() => onDelete(a)} />
            ))}
          </div>
        </ScrollArea>
      </section>
      <section className="flex min-h-0 flex-1 flex-col gap-2">
        <SectionLabel>Agents</SectionLabel>
        <ScrollArea className="-mx-1 min-h-0 flex-1 px-1">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 pb-1">
            <AddTile label="Add agent" onClick={onAddAgent} />
            {singleAgents.map((a) => (
              <AgentCard key={a.id} agent={a} onEdit={() => onEdit(a)} onDelete={() => onDelete(a)} />
            ))}
          </div>
        </ScrollArea>
      </section>
    </div>
  )
}
