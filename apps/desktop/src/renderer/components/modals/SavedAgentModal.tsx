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
import { Input } from '../ui/input.js'
import { Select } from '../ui/select.js'
import { AGENT_LABELS } from '../../lib/agent-labels.js'
import { ScopeField } from './saved-agent/ScopeField.js'
import { TeamBaseField } from './saved-agent/TeamBaseField.js'
import { TeamMembersEditor } from './saved-agent/TeamMembersEditor.js'
import { BASE_AGENTS, TEAM_BASES } from './saved-agent/constants.js'
import { useTeamMembers } from './saved-agent/use-team-members.js'

/**
 * Create or edit a saved agent or a team. An agent runs a base CLI (`agent`); a
 * team is a Claude launch (`agent` = `claude-team:<id>`) that carries a `members`
 * roster the lead orchestrates. Which one this modal is depends on `initialKind`
 * (for a new record) or the record being edited — there is no in-modal switch.
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
  // record being edited — there is no in-modal switch between the two.
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
  // the model becomes a free-text field.
  const [models, setModels] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    void agentModelsApi(client)
      .list(modelAgent)
      .then((r) => alive && setModels(r.models))
      .catch(() => alive && setModels([]))
    return () => {
      alive = false
    }
  }, [client, modelAgent])

  const modelOptions = useMemo(() => {
    const opts = [{ value: 'default', label: 'Default (inherit)' }]
    const list = [...models]
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="flex max-h-[86vh] w-[560px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-[14px] font-medium capitalize">
            {agent === null ? `Add ${noun}` : `Edit ${noun}`}
          </div>
          <Button variant="ghost" size="xs" onClick={onClose}>
            Cancel
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek p-4">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Name</label>
          <Input
            className="mb-3"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isTeam ? 'Recon & Strike' : 'Recon specialist'}
          />

          {!isTeam && (
            <>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Base agent</label>
              <Select
                className="mb-3"
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
            <TeamBaseField
              teamBase={teamBase}
              locked={editingKind}
              choices={teamBaseChoices}
              onChange={setTeamBase}
            />
          )}

          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Description</label>
          <Input
            className="mb-3"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={isTeam ? 'Full offensive loop: enumerate, scan, exploit, report' : 'Enumerates the attack surface of a target'}
          />

          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
            {isTeam ? 'Lead prompt' : 'Prompt'}
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={isTeam ? 4 : 6}
            placeholder={
              isTeam
                ? 'Lead the team against the target. Delegate to the specialists, then consolidate findings…'
                : 'You are a reconnaissance specialist. Enumerate subdomains…'
            }
            className="mb-3 flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />

          {!isTeam && (
            <div className="mb-3">
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                Model (optional)
              </label>
              {models.length > 0 ? (
                <Select
                  value={model === '' ? 'default' : model}
                  onValueChange={(v) => setModel(v === 'default' ? '' : v)}
                  options={modelOptions}
                  className="w-64"
                />
              ) : (
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Default (inherit) — or type a model" />
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
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!valid || busy} onClick={() => void save()}>
            {agent === null ? 'Create' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}
