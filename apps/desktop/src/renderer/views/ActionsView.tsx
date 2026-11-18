import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, Lightbulb, Plus } from 'lucide-react'
import { useApp } from '../store.js'
import { actionsApi, type Action, type ActionInput, type ActionList, type ActionScope } from '../api/actions.js'
import { backendsApi, type BackendProfile } from '../api/backends.js'
import { nodesApi, type NodeListing } from '../api/nodes.js'
import { targetsApi, type TargetSummary } from '../api/targets.js'
import { workflowsApi, type WorkflowSummary } from '../api/workflows.js'
import { STANDALONE_BUILTIN_NODES, suggestionsFor, type ActionForm } from '../lib/actions.js'
import { apiErrorMessage } from '../lib/api-error.js'
import { buildCatalog } from '../lib/node-catalog.js'
import { NewActionPanel, type ActionTool } from '../components/actions/NewActionPanel.js'
import { ConfirmModal } from '../components/modals/ConfirmModal.js'
import { Button } from '../components/ui/button.js'
import { GlassPanel } from '../components/ui/glass-panel.js'
import { Page, PageBody, PageToolbar } from '../components/ui/page.js'
import { ActionRow, ActionsSkeleton, Section, SectionHeading, type Names } from './actions/ActionRow.js'

// Kept on this module: callers and tests import the wording helper from the view.
export { describeRun } from './actions/ActionRow.js'

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
    <Page>
      <PageToolbar
        title="Actions"
        actions={
          <Button size="sm" disabled={client === null} onClick={() => setCreating({})}>
            <Plus className="size-4" strokeWidth={2} />
            New action
          </Button>
        }
      />

      <PageBody>
        <GlassPanel className="scrollbar-sleek min-w-0 flex-1 overflow-y-auto">
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

            {actions === null && error === null && <ActionsSkeleton />}

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
                    <SectionHeading title="Suggestions" hint="Starting points. Nothing runs until you create one." />
                    <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
                      {suggestions.map((suggestion) => (
                        <li key={suggestion.id}>
                          <button
                            type="button"
                            onClick={() => setCreating(suggestion.form)}
                            className="flex h-full w-full flex-col gap-1.5 rounded-[14px] border border-dashed border-glass-border px-4 py-3 text-left outline-none transition-colors hover:bg-glass focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
        </GlassPanel>

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
      </PageBody>

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
    </Page>
  )
}
