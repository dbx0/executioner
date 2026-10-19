import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../store.js'
import { workflowsApi, type WorkflowSummary } from '../api/workflows.js'
import { savedAgentsApi, isTeamSavedAgent, type SavedAgent } from '../api/saved-agents.js'
import { WorkflowPreviewModal } from '../components/modals/WorkflowPreviewModal.js'
import { RunWorkflowModal } from '../components/modals/RunWorkflowModal.js'
import { ConfirmModal } from '../components/modals/ConfirmModal.js'
import { SchedulesDialog } from '../components/modals/SchedulesDialog.js'
import { SavedAgentModal } from '../components/modals/SavedAgentModal.js'
import { HubHeader } from './workflows-hub/HubHeader.js'
import { WorkflowsPanel } from './workflows-hub/WorkflowsPanel.js'
import { AgentsPanel } from './workflows-hub/AgentsPanel.js'

/**
 * The Workflows/Agents hub: the landing page for the two sidebar sections. It
 * has a Workflows tab (a card grid of saved workflows plus recent runs) and an
 * Agents tab (saved agents and teams). The active tab lives in the store so the
 * sidebar's Workflows and Agents entries drive it. The canvas editor is reached
 * from here — `onCreate` opens a blank editor, `onOpen` opens the chosen one.
 */
export function WorkflowsHub({
  onCreate,
  onOpen,
}: {
  onCreate: () => void
  onOpen: (id: string) => void
}): JSX.Element {
  const client = useApp((s) => s.client)!
  const api = useMemo(() => workflowsApi(client), [client])
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  /** First load done (success or failure); until then the grid shows placeholders. */
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(null)
  const [runFor, setRunFor] = useState<{ id: string; name: string } | null>(null)
  const [deleteFor, setDeleteFor] = useState<{ id: string; name: string } | null>(null)
  const [showSchedules, setShowSchedules] = useState(false)
  const tab = useApp((s) => s.hubTab)

  const agentsApi = useMemo(() => savedAgentsApi(client), [client])
  const [agents, setAgents] = useState<SavedAgent[]>([])
  // `kind` seeds the modal when creating (Add agent vs Add team).
  const [agentModal, setAgentModal] = useState<{ agent: SavedAgent | null; kind?: 'agent' | 'team' } | null>(null)
  const [deleteAgentFor, setDeleteAgentFor] = useState<SavedAgent | null>(null)

  const teams = useMemo(() => agents.filter((a) => isTeamSavedAgent(a)), [agents])
  const singleAgents = useMemo(() => agents.filter((a) => !isTeamSavedAgent(a)), [agents])

  const refreshAgents = useCallback(() => {
    void agentsApi
      .list()
      .then(setAgents)
      .catch(() => setAgents([]))
  }, [agentsApi])

  const refresh = useCallback(() => {
    void api
      .list()
      .then(setWorkflows)
      .catch(() => setWorkflows([]))
      .finally(() => setLoadedOnce(true))
  }, [api])

  useEffect(() => {
    refresh()
    refreshAgents()
  }, [refresh, refreshAgents])

  const removeAgent = async (id: string): Promise<void> => {
    await agentsApi.remove(id).catch(() => {})
    refreshAgents()
  }

  const remove = async (id: string, keepHistory: boolean): Promise<void> => {
    await api.remove(id, keepHistory).catch(() => {})
    refresh()
  }

  const duplicate = async (id: string): Promise<void> => {
    await api.duplicate(id).catch(() => {})
    refresh()
  }

  return (
    <div className="flex h-full flex-col">
      <HubHeader
        tab={tab}
        onCreateWorkflow={onCreate}
        onShowSchedules={() => setShowSchedules(true)}
        onAddTeam={() => setAgentModal({ agent: null, kind: 'team' })}
        onAddAgent={() => setAgentModal({ agent: null, kind: 'agent' })}
      />

      {tab === 'workflows' && (
        <WorkflowsPanel
          loading={!loadedOnce}
          workflows={workflows}
          onCreate={onCreate}
          onPreview={(w) => setPreview({ id: w.id, name: w.name })}
          onDuplicate={(id) => void duplicate(id)}
          onDelete={(w) => setDeleteFor({ id: w.id, name: w.name })}
        />
      )}

      {tab === 'agents' && (
        <AgentsPanel
          teams={teams}
          singleAgents={singleAgents}
          onAddTeam={() => setAgentModal({ agent: null, kind: 'team' })}
          onAddAgent={() => setAgentModal({ agent: null, kind: 'agent' })}
          onEdit={(a) => setAgentModal({ agent: a })}
          onDelete={(a) => setDeleteAgentFor(a)}
        />
      )}

      {preview !== null && (
        <WorkflowPreviewModal
          workflowId={preview.id}
          name={preview.name}
          onClose={() => setPreview(null)}
          onEdit={() => {
            const id = preview.id
            setPreview(null)
            onOpen(id)
          }}
          onRun={() => {
            setRunFor({ id: preview.id, name: preview.name })
            setPreview(null)
          }}
        />
      )}

      {runFor !== null && (
        <RunWorkflowModal
          workflowId={runFor.id}
          name={runFor.name}
          onClose={() => setRunFor(null)}
        />
      )}

      {showSchedules && <SchedulesDialog client={client} onClose={() => setShowSchedules(false)} />}

      {deleteFor !== null && (
        <ConfirmModal
          title="Delete workflow"
          message={`Delete “${deleteFor.name}”? This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          checkboxLabel="Keep this workflow's run history"
          checkboxDefault
          onCancel={() => setDeleteFor(null)}
          onConfirm={(keepHistory) => {
            const id = deleteFor.id
            setDeleteFor(null)
            void remove(id, keepHistory)
          }}
        />
      )}

      {agentModal !== null && (
        <SavedAgentModal
          client={client}
          agent={agentModal.agent}
          initialKind={agentModal.kind ?? 'agent'}
          onClose={() => setAgentModal(null)}
          onSaved={refreshAgents}
        />
      )}

      {deleteAgentFor !== null && (
        <ConfirmModal
          title="Delete agent"
          message={`Delete “${deleteAgentFor.name}”? This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setDeleteAgentFor(null)}
          onConfirm={() => {
            const id = deleteAgentFor.id
            setDeleteAgentFor(null)
            void removeAgent(id)
          }}
        />
      )}
    </div>
  )
}
