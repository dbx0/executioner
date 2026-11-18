import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type { AxiosInstance } from 'axios'
import {
  savedAgentsApi,
  isTeamSavedAgent,
  teamBaseOf,
  type SavedAgent,
  type SavedAgentInput,
  type SavedAgentScope,
  type TeamBase,
} from '../../api/saved-agents.js'
import { agentModelsApi } from '../../api/agent-models.js'
import { useApp } from '../../store.js'
import { AgentIcon } from '../brand/AgentIcon.js'
import { Button } from '../ui/button.js'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/dialog.js'
import { Input } from '../ui/input.js'
import { Select } from '../ui/select.js'
import { Skeleton } from '../ui/skeleton.js'
import { Spinner } from '../ui/spinner.js'
import { Textarea } from '../ui/textarea.js'
import { AGENT_LABELS } from '../../lib/agent-labels.js'
import { FieldLabel } from './field-label.js'
import { ScopeField } from './saved-agent/ScopeField.js'
import { TeamBaseField } from './saved-agent/TeamBaseField.js'
import { TeamMembersEditor } from './saved-agent/TeamMembersEditor.js'
import { BASE_AGENTS, TEAM_BASES } from './saved-agent/constants.js'
import { useTeamMembers } from './saved-agent/use-team-members.js'

/**
 * Create or edit a saved agent or a team. An agent runs a base CLI (`agent`); a
 * team is a Claude launch (`agent` = `claude-team:<id>`) that carries a `members`
 * roster the lead orchestrates. Which one this modal is depends on `initialKind`
 * (for a new record) or the record being edited. There is no in-modal switch.
 * Optional fields are only sent when set (exactOptionalPropertyTypes).
 */
export function SavedAgentModal({
  client,
  agent,
  initialKind = 'agent',
  onClose,
  onSaved,
}: {
  client: AxiosInstance
  /** The agent to edit, or null to create a new one. */
  agent: SavedAgent | null
  /** For a new record, which kind the modal opens on (Add agent vs Add team). */
  initialKind?: 'agent' | 'team'
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const api = savedAgentsApi(client)
  const installedAgents = useApp((s) => s.installedAgents)
  const refreshAgents = useApp((s) => s.refreshAgents)
  // Only offer base agents that are actually installed on this machine. Until the
  // probe resolves (null) fall back to the full set rather than an empty list. An
  // agent being edited keeps its own base even if the CLI isn't currently present.
  const baseChoices = useMemo(() => {
    const editing = agent?.agent
    return BASE_AGENTS.filter(
      (id) => installedAgents === null || installedAgents.includes(id) || id === editing,
    )
  }, [installedAgents, agent])

  useEffect(() => {
    if (installedAgents === null) refreshAgents()
  }, [installedAgents, refreshAgents])

  // Kind is fixed by how the modal was opened (Add agent vs Add team) or by the
  // record being edited. There is no in-modal switch between the two.
  const [kind] = useState<'agent' | 'team'>(
    agent === null ? initialKind : isTeamSavedAgent(agent) ? 'team' : 'agent',
  )
  const isTeam = kind === 'team'
  const editingKind = agent !== null
  // Which CLI a team runs on. Claude takes an inline roster; opencode reads it
  // from `.opencode/agent/*.md` written at launch. Locked once the team exists.
  const [teamBase, setTeamBase] = useState<TeamBase>(
    agent !== null && isTeamSavedAgent(agent) ? teamBaseOf(agent.agent) : 'claude',
  )
  const teamBaseChoices = useMemo(
    () => TEAM_BASES.filter((b) => installedAgents === null || installedAgents.includes(b.id) || b.id === teamBase),
    [installedAgents, teamBase],
  )

  const [name, setName] = useState(agent?.name ?? '')
  const [base, setBase] = useState<string>(agent !== null && !isTeamSavedAgent(agent) ? agent.agent : 'claude')
  const [description, setDescription] = useState(agent?.description ?? '')
  const [prompt, setPrompt] = useState(agent?.prompt ?? '')
  const [model, setModel] = useState(agent?.model ?? '')
  const { members, addMember, updateMember, removeMember, membersValid, cleanMembers } = useTeamMembers(
    agent?.members ?? [],
  )
  const [scope, setScope] = useState<SavedAgentScope>(agent?.scope ?? 'global')
  // A team's models are Claude's, so the base agent for the model probe is claude.
  const modelAgent = isTeam ? 'claude' : base
  // Models are fetched from the selected base agent (its CLI where it can list
  // them, Claude's aliases otherwise). Empty = the agent can't be enumerated, so
  // the model becomes a free-text field. The list is kept with the agent it was
  // fetched for, so a list for another base reads as still loading.
  const [fetched, setFetched] = useState<{ agent: string; models: string[] } | null>(null)
  const models = fetched !== null && fetched.agent === modelAgent ? fetched.models : null

  useEffect(() => {
    let alive = true
    void agentModelsApi(client)
      .list(modelAgent)
      .then((r) => alive && setFetched({ agent: modelAgent, models: r.models }))
      .catch(() => alive && setFetched({ agent: modelAgent, models: [] }))
    return () => {
      alive = false
    }
  }, [client, modelAgent])

  const modelOptions = useMemo(() => {
    const opts = [{ value: 'default', label: 'Default (inherit)' }]
    const list = [...(models ?? [])]
    // Preserve an existing custom model that isn't in the fetched list.
    if (model !== '' && !list.includes(model)) list.unshift(model)
    for (const m of list) opts.push({ value: m, label: m })
    return opts
  }, [models, model])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A team needs at least one member with a name and a prompt; an agent needs a base.
  const valid =
    name.trim() !== '' && prompt.trim() !== '' && (isTeam ? membersValid : base !== '')

  const save = async (): Promise<void> => {
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      // A new team sends the bare `<base>-team`; the store assigns its id. An
      // edited team keeps its existing id-qualified agent string.
      const agentField = isTeam ? agent?.agent ?? `${teamBase}-team` : base
      const body: SavedAgentInput = { name: name.trim(), agent: agentField, prompt: prompt.trim(), scope }
      const desc = description.trim()
      if (desc !== '') body.description = desc
      if (isTeam) {
        body.members = cleanMembers()
      } else {
        const m = model.trim()
        if (m !== '') body.model = m
      }

      if (agent === null) await api.create(body)
      else await api.update(agent.id, body)
      onSaved()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const noun = isTeam ? 'team' : 'agent'

  return (
    <Dialog onClose={onClose} className="w-[560px]">
      <DialogHeader title={agent === null ? `Add ${noun}` : `Edit ${noun}`} className="capitalize" closeButton />

      <DialogBody>
        <FieldLabel htmlFor="saved-agent-name">Name</FieldLabel>
        <Input
          id="saved-agent-name"
          className="mb-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isTeam ? 'Recon & Strike' : 'Recon specialist'}
        />

        {!isTeam && (
          <>
            <FieldLabel>Base agent</FieldLabel>
            <Select
              className="mb-3"
              ariaLabel="Base agent"
              value={base}
              onValueChange={setBase}
              options={baseChoices.map((id) => ({
                value: id,
                label: AGENT_LABELS[id] ?? id,
                icon: <AgentIcon agent={id} className="size-4" />,
              }))}
            />
          </>
        )}
        {isTeam && (
          <TeamBaseField teamBase={teamBase} locked={editingKind} choices={teamBaseChoices} onChange={setTeamBase} />
        )}

        <FieldLabel htmlFor="saved-agent-description">Description</FieldLabel>
        <Input
          id="saved-agent-description"
          className="mb-3"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={
            isTeam ? 'Full offensive loop: enumerate, scan, exploit, report' : 'Enumerates the attack surface of a target'
          }
        />

        <FieldLabel htmlFor="saved-agent-prompt">{isTeam ? 'Lead prompt' : 'Prompt'}</FieldLabel>
        <Textarea
          id="saved-agent-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={isTeam ? 4 : 6}
          placeholder={
            isTeam
              ? 'Lead the team against the target. Delegate to the specialists, then consolidate findings…'
              : 'You are a reconnaissance specialist. Enumerate subdomains…'
          }
          className="mb-3"
        />

        {!isTeam && (
          <div className="mb-3">
            <FieldLabel htmlFor="saved-agent-model">Model (optional)</FieldLabel>
            {models === null ? (
              <div role="status" aria-label="Loading models">
                <Skeleton className="h-9 w-64 rounded-control" />
              </div>
            ) : models.length > 0 ? (
              <Select
                ariaLabel="Model"
                value={model === '' ? 'default' : model}
                onValueChange={(v) => setModel(v === 'default' ? '' : v)}
                options={modelOptions}
                className="w-64"
              />
            ) : (
              <Input
                id="saved-agent-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Default (inherit), or type a model"
              />
            )}
          </div>
        )}

        {isTeam && (
          <TeamMembersEditor
            members={members}
            teamBase={teamBase}
            onAdd={addMember}
            onUpdate={updateMember}
            onRemove={removeMember}
          />
        )}

        <ScopeField scope={scope} onChange={setScope} />

        {error !== null && <p className="mt-3 text-[12px] text-status-error">{error}</p>}
      </DialogBody>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={!valid || busy} onClick={() => void save()}>
          {busy && <Spinner />}
          {agent === null ? 'Create' : 'Save'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
