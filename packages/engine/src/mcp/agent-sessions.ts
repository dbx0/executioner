import type { WorkflowProposal } from './toolset.js'

/**
 * What one headless agent run is waiting to receive from its own MCP calls.
 * - `nodeOutput`: the workflow agent node's result (`set_node_output`).
 * - `proposal`: the assistant turn's proposed graph (`propose_workflow`).
 * - `graph`: the canvas the assistant turn edits (`get_workflow_graph`).
 */
export interface AgentSessionBinding {
  nodeOutput?: (data: Record<string, unknown>) => void
  proposal?: (proposal: WorkflowProposal) => void
  graph?: unknown
}

/**
 * The per-session places a headless agent's results land, keyed by the session
 * id its scoped token carries. A call reaches only the binding of the session
 * that made it, so two agent nodes running at once each get their own output,
 * and an agent cannot write into another run's node or proposal. A caller with
 * no session, or a session nobody bound, reaches nothing.
 */
export class AgentSessionSinks {
  private readonly bound = new Map<string, AgentSessionBinding>()

  /**
   * Bind `sessionId` for one run and return the unbind. Binding an id that is
   * already bound throws: ids are fresh per launch, so a clash is a bug, and
   * silently replacing would hand one run's output to another.
   */
  bind(sessionId: string, binding: AgentSessionBinding): () => void {
    if (sessionId === '') throw new Error('an agent session needs an id')
    if (this.bound.has(sessionId)) throw new Error(`agent session ${sessionId} is already bound`)
    this.bound.set(sessionId, binding)
    return () => {
      if (this.bound.get(sessionId) === binding) this.bound.delete(sessionId)
    }
  }

  /** The binding for a caller's session, or undefined when it has none. */
  get(sessionId: string | undefined): AgentSessionBinding | undefined {
    return sessionId === undefined ? undefined : this.bound.get(sessionId)
  }

  /** How many sessions are bound, for tests and diagnostics. */
  get size(): number {
    return this.bound.size
  }
}
