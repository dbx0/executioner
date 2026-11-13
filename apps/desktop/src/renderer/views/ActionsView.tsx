import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, CirclePlus, Clock, Lightbulb, Plus, Trash2, Zap } from 'lucide-react'
import { useApp } from '../store.js'
import { actionsApi, type Action, type ActionInput, type ActionList, type ActionScope } from '../api/actions.js'
import { backendsApi, type BackendProfile } from '../api/backends.js'
import { nodesApi, type NodeListing } from '../api/nodes.js'
import { targetsApi, type TargetSummary } from '../api/targets.js'
import { workflowsApi, type WorkflowSummary } from '../api/workflows.js'
import { intervalText, kindWithArticle, runsOnText, STANDALONE_BUILTIN_NODES, suggestionsFor, type ActionForm } from '../lib/actions.js'
import { apiErrorMessage } from '../lib/api-error.js'
import { buildCatalog } from '../lib/node-catalog.js'
import { cn } from '../lib/utils.js'
import { NewActionPanel, type ActionTool } from '../components/actions/NewActionPanel.js'
import { ConfirmModal } from '../components/modals/ConfirmModal.js'
import { Button } from '../components/ui/button.js'
import { Switch } from '../components/ui/switch.js'

/** The names an action row needs to say what it does. */
interface Names {
  workflows: WorkflowSummary[]
  tools: ActionTool[]
  targets: TargetSummary[]
  backends: BackendProfile[]
}

/** What an action runs, in words, and what kind of thing that is. */
export function describeRun(action: Action, names: Names): { title: string; kind: 'Workflow' | 'Tool' } {
  if (action.workflowId !== null) {
    const workflow = names.workflows.find((w) => w.id === action.workflowId)
    return { title: `Run ${workflow?.name ?? 'a workflow that no longer exists'}`, kind: 'Workflow' }
  }
  const tool = names.tools.find((t) => t.type === action.nodeType)
  return { title: `Run ${tool?.label ?? action.nodeType ?? 'a tool'}`, kind: 'Tool' }
}

function ActionRow({
  action,
  on,
  names,
  onToggle,
  onDelete,
}: {
  action: Action
  /** Whether it fires here: for a default, this engagement's own switch. */
  on: boolean
  names: Names
  onToggle: (enabled: boolean) => void
  onDelete: () => void
}): JSX.Element {
  const timed = action.kind === 'interval'
  const run = describeRun(action, names)
  const target = action.targetId === null ? undefined : names.targets.find((t) => t.id === action.targetId)
  const kind = action.targetKind ?? 'target'

  return (
    <li className={cn('group flex items-center gap-4 px-4 py-3', !on && 'text-muted-foreground')}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-2">
        {timed ? (
          <Clock className="size-4 text-muted-foreground" strokeWidth={1.75} />
        ) : (
          <CirclePlus className={cn('size-4', on ? 'text-[var(--activity)]' : 'text-muted-foreground')} strokeWidth={1.75} />
        )}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13.5px] font-medium">
          {timed ? (
            intervalText(action.intervalSeconds)
          ) : (
            `When ${kindWithArticle(kind)} is added`
          )}
        </span>
        <span className="truncate text-[12px] text-muted-foreground">
          {timed ? 'In this engagement' : action.inScopeOnly ? 'Only if it is in scope' : 'Any scope'}
          {!on && ' · switched off'}
        </span>
      </div>

      <ArrowRight className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13.5px] font-medium">
          {run.title}
          {target !== undefined && (
            <>
              {' '}
              on <span className="font-mono text-[12.5px]">{target.value}</span>
            </>
          )}
        </span>
        <span className="truncate text-[12px] text-muted-foreground">
          {run.kind} · {runsOnText(action.backendProfileId, names.backends)}
        </span>
      </div>

      <Switch checked={on} onCheckedChange={onToggle} aria-label={on ? 'Switch this action off' : 'Switch this action on'} />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Delete action"
        className="text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        onClick={onDelete}
      >
        <Trash2 className="size-4" strokeWidth={1.75} />
      </Button>
    </li>
  )
}

function Section({
  title,
  hint,
  empty,
  children,
}: {
  title: string
  hint: string
  empty: string
  children: JSX.Element[]
}): JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <span className="text-[12.5px] text-muted-foreground">{hint}</span>
      </div>
      {children.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-5 text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">{children}</ul>
      )}
    </section>
  )
}

/**
 * What the system does on its own. An action is a trigger (a kind of target
 * being added, or a timer) and what it runs (a workflow, or one tool). Defaults
 * apply in every engagement; switching one off here is this engagement's own
 * choice and leaves it on everywhere else.
 */
export function ActionsView(): JSX.Element {
  const client = useApp((s) => s.client)
  const activeRoot = useApp((s) => s.activeRoot)
  const engagementName = useApp((s) => s.engagementName) ?? 'this engagement'
  const api = useMemo(() => (client === null ? null : actionsApi(client)), [client])

  const [actions, setActions] = useState<ActionList | null>(null)
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [targets, setTargets] = useState<TargetSummary[]>([])
  const [backends, setBackends] = useState<BackendProfile[]>([])
  const [listings, setListings] = useState<NodeListing[]>([])
  // The form the New action panel starts from, or null while it is closed.
  const [creating, setCreating] = useState<Partial<ActionForm> | null>(null)
  const [deleting, setDeleting] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback((): void => {
    if (api === null) return
    api
      .list()
      .then((list) => {
        setActions(list)
        setError(null)
      })
      .catch((e: unknown) => setError(apiErrorMessage(e, 'The actions could not be loaded.')))
  }, [api])

  useEffect(() => {
    if (client === null) return
    refresh()
    void workflowsApi(client).list().then(setWorkflows).catch(() => setWorkflows([]))
    void targetsApi(client).list().then(setTargets).catch(() => setTargets([]))
    void backendsApi(client).list().then(setBackends).catch(() => setBackends([]))
    void nodesApi(client).list().then(setListings).catch(() => setListings([]))
  }, [client, activeRoot, refresh])

  // What an action may run on its own: every tool, plus the built-in recon
  // nodes that make sense aimed at one target.
  const tools = useMemo<ActionTool[]>(
    () =>
      buildCatalog(listings)
        .filter((entry) => entry.kind === 'tool' || STANDALONE_BUILTIN_NODES.includes(entry.type))
        .map((entry) => ({ type: entry.type, label: entry.label, params: entry.params }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [listings],
  )
  const names: Names = { workflows, tools, targets, backends }

  const suggestions = useMemo(
    () =>
      actions === null
        ? []
        : suggestionsFor({
            workflowIds: workflows.map((w) => w.id),
            toolTypes: tools.map((t) => t.type),
            existing: [...actions.defaults, ...actions.engagement],
          }),
    [actions, workflows, tools],
  )

  const toggle = (scope: ActionScope, id: string, enabled: boolean): void => {
    if (api === null) return
    api
      .setEnabled(scope, id, enabled)
      .then(refresh)
      .catch((e: unknown) => setError(apiErrorMessage(e, 'The action could not be changed.')))
  }

  const remove = (scope: ActionScope, id: string): void => {
    if (api === null) return
    api
      .remove(scope, id)
      .then(refresh)
      .catch((e: unknown) => setError(apiErrorMessage(e, 'The action could not be deleted.')))
  }

  const create = async (input: ActionInput): Promise<void> => {
    if (api === null) return
    try {
      await api.create(input)
    } catch (e) {
      throw new Error(apiErrorMessage(e, 'The action could not be created.'), { cause: e })
    }
    refresh()
  }

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <Zap className="size-4 text-muted-foreground" strokeWidth={1.75} />
        <h1 className="text-sm font-medium">Actions</h1>
        <Button size="sm" className="ml-auto shrink-0" disabled={client === null} onClick={() => setCreating({})}>
          <Plus className="size-4" strokeWidth={2} />
          New action
        </Button>
      </div>

      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        <div className="flex max-w-[1040px] flex-col gap-7 p-6">
          <p className="max-w-[620px] text-[13.5px] text-muted-foreground">
            What Executioner does on its own: run a workflow or a single tool on a schedule, or the moment something new
            shows up.
          </p>

          {error !== null && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}

          {actions !== null && (
            <>
              <Section
                title="Defaults"
                hint="Shared by every engagement. The switch turns one on or off here only."
                empty="No defaults yet. A default runs in every engagement, including the ones you create later."
              >
                {actions.defaults.map((action) => (
                  <ActionRow
                    key={action.id}
                    action={action}
                    on={action.enabledHere}
                    names={names}
                    onToggle={(enabled) => toggle('default', action.id, enabled)}
                    onDelete={() => setDeleting(action)}
                  />
                ))}
              </Section>

              <Section
                title="This engagement"
                hint={`Only in ${engagementName}.`}
                empty="Nothing here yet. Schedules, and actions meant for this engagement alone, show up here."
              >
                {actions.engagement.map((action) => (
                  <ActionRow
                    key={action.id}
                    action={action}
                    on={action.enabled}
                    names={names}
                    onToggle={(enabled) => toggle('engagement', action.id, enabled)}
                    onDelete={() => remove('engagement', action.id)}
                  />
                ))}
              </Section>

              {suggestions.length > 0 && (
                <section className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline gap-x-2.5">
                    <h2 className="text-[13px] font-semibold">Suggestions</h2>
                    <span className="text-[12.5px] text-muted-foreground">Starting points. Nothing runs until you create one.</span>
                  </div>
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
                    {suggestions.map((suggestion) => (
                      <li key={suggestion.id}>
                        <button
                          type="button"
                          onClick={() => setCreating(suggestion.form)}
                          className="flex h-full w-full flex-col gap-1.5 rounded-xl border border-dashed border-border px-4 py-3 text-left outline-none transition-colors hover:bg-surface-1 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          <span className="flex items-center gap-2 text-[13.5px] font-medium">
                            {suggestion.form.trigger === 'interval' ? (
                              <Clock className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                            ) : (
                              <Lightbulb className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                            )}
                            {suggestion.title}
                          </span>
                          <span className="text-[12px] text-muted-foreground">{suggestion.body}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {creating !== null && (
        <NewActionPanel
          // A suggestion opened over an open panel starts the form afresh.
          key={JSON.stringify(creating)}
          initial={creating}
          workflows={workflows}
          tools={tools}
          targets={targets}
          backends={backends}
          engagementName={engagementName}
          onCreate={create}
          onClose={() => setCreating(null)}
        />
      )}

      {deleting !== null && (
        <ConfirmModal
          title="Delete default action"
          message="This default stops running in every engagement, not only this one. To stop it here alone, switch it off instead."
          confirmLabel="Delete for every engagement"
          destructive
          onConfirm={() => {
            remove('default', deleting.id)
            setDeleting(null)
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
