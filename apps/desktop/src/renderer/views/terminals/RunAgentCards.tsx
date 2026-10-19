import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { useApp } from '../../store.js'
import { AgentIcon } from '../../components/brand/AgentIcon.js'
import { savedAgentsApi, type SavedAgent } from '../../api/saved-agents.js'
import { RunAgentModal } from '../../components/modals/RunAgentModal.js'

/**
 * The "Run an agent" group on the empty workspace: the user's saved agents as
 * cards. Clicking a card opens the run modal (multi-target + connectivity), then
 * starts a primed agent terminal.
 */
export function RunAgentCards(): JSX.Element | null {
  const client = useApp((s) => s.client)
  const [agents, setAgents] = useState<SavedAgent[]>([])
  const [runFor, setRunFor] = useState<SavedAgent | null>(null)

  useEffect(() => {
    if (client === null) return
    let alive = true
    void savedAgentsApi(client)
      .list()
      .then((list) => alive && setAgents(list))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [client])

  if (agents.length === 0) return null

  return (
    <div className="mt-6 w-full max-w-[680px] px-4">
      <div className="mb-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Run an agent
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">
        {agents.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setRunFor(a)}
            className="flex min-h-[72px] flex-col gap-1.5 rounded-lg border border-border bg-card p-3 text-left transition-all hover:border-border-strong hover:shadow-sm"
          >
            <div className="flex items-center gap-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-2">
                <AgentIcon agent={a.agent} className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{a.name}</span>
            </div>
            <p className="line-clamp-2 text-[11px] text-muted-foreground">{a.description}</p>
          </button>
        ))}
      </div>
      {runFor !== null && <RunAgentModal agent={runFor} onClose={() => setRunFor(null)} />}
    </div>
  )
}
