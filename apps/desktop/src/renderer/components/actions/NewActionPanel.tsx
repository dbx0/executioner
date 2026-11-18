import type { JSX } from 'react'
import { useState } from 'react'
import { Clock, CirclePlus, Workflow, Wrench, X } from 'lucide-react'
import type { ActionInput } from '../../api/actions.js'
import type { BackendProfile } from '../../api/backends.js'
import type { TargetSummary } from '../../api/targets.js'
import type { WorkflowSummary } from '../../api/workflows.js'
import {
  actionInputFrom,
  DEFAULT_BACKEND,
  EMPTY_FORM,
  formProblem,
  INTERVAL_UNITS,
  kindLabel,
  LOCAL_BACKEND,
  scopeOf,
  sentenceFor,
  TARGET_KINDS,
  type ActionForm,
  type IntervalUnit,
} from '../../lib/actions.js'
import type { ParamSpec } from '../../lib/param-specs.js'
import { cn } from '../../lib/utils.js'
import { ParamDrawer } from '../canvas/ParamDrawer.js'
import { Button } from '../ui/button.js'
import { GlassPanel } from '../ui/glass-panel.js'
import { NumberField } from '../ui/number-field.js'
import { Select } from '../ui/select.js'
import { Spinner } from '../ui/spinner.js'
import { Switch } from '../ui/switch.js'
import { Choice, FieldLabel, Legend, ScopeOption } from './choices.js'

/** A tool an action can run on its own, with the form its options take. */
export interface ActionTool {
  type: string
  label: string
  params: ParamSpec[]
}

/**
 * The panel that creates an action: when it fires, what it runs, and whether it
 * belongs to every engagement or to this one. The sentence at the bottom reads
 * the choices back before anything is saved.
 */
export function NewActionPanel({
  workflows,
  tools,
  targets,
  backends,
  engagementName,
  initial,
  onCreate,
  onClose,
}: {
  workflows: WorkflowSummary[]
  tools: ActionTool[]
  targets: TargetSummary[]
  backends: BackendProfile[]
  engagementName: string
  /** Where the form starts, when the panel was opened from a suggestion. */
  initial?: Partial<ActionForm>
  /** Saves the action; rejects with the reason it could not be saved. */
  onCreate: (input: ActionInput) => Promise<void>
  onClose: () => void
}): JSX.Element {
  const [form, setForm] = useState<ActionForm>({ ...EMPTY_FORM, ...initial })
  const [showOptions, setShowOptions] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<ActionForm>): void => setForm((f) => ({ ...f, ...patch }))

  const tool = tools.find((t) => t.type === form.nodeType)
  const problem = formProblem(form)
  const timed = form.trigger === 'interval'

  const sentence = sentenceFor(form, {
    runName: form.runs === 'workflow' ? (workflows.find((w) => w.id === form.workflowId)?.name ?? '') : (tool?.label ?? ''),
    targetName: targets.find((t) => t.id === form.targetId)?.value ?? '',
    backendName: form.backendProfileId === LOCAL_BACKEND ? 'this machine' : (backends.find((b) => b.id === form.backendProfileId)?.name ?? ''),
    engagementName,
  })

  const save = async (): Promise<void> => {
    if (problem !== null) return
    setBusy(true)
    setError(null)
    try {
      await onCreate(actionInputFrom(form))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action could not be created.')
      setBusy(false)
    }
  }

  return (
    <GlassPanel asChild className="flex w-[440px] max-w-[50%] shrink-0 flex-col">
      <aside aria-label="New action">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-glass-border pl-5 pr-2">
        <h2 className="flex-1 text-[14px] font-semibold tracking-[-0.01em]">New action</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X className="size-4" strokeWidth={1.75} />
        </Button>
      </div>

      <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
        <section>
          <Legend>When</Legend>
          <div role="radiogroup" aria-label="Trigger" className="grid grid-cols-2 gap-2">
            <Choice
              selected={!timed}
              onSelect={() => set({ trigger: 'on_create' })}
              icon={<CirclePlus className="size-4 text-activity" strokeWidth={1.75} />}
            >
              Something is added
            </Choice>
            <Choice
              selected={timed}
              onSelect={() => set({ trigger: 'interval' })}
              icon={<Clock className="size-4 text-muted-foreground" strokeWidth={1.75} />}
            >
              On a schedule
            </Choice>
          </div>

          {timed ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <FieldLabel>Every</FieldLabel>
                <NumberField min={1} aria-label="Every" value={form.every} onValueChange={(every) => set({ every })} />
              </div>
              <div>
                <FieldLabel>Unit</FieldLabel>
                <Select
                  ariaLabel="Unit"
                  value={form.unit}
                  onValueChange={(unit) => set({ unit: unit as IntervalUnit })}
                  options={INTERVAL_UNITS.map((u) => ({ value: u, label: u }))}
                />
              </div>
              <div className="col-span-2">
                <FieldLabel>{form.runs === 'tool' ? 'Target' : 'Target (optional)'}</FieldLabel>
                <Select
                  ariaLabel="Target"
                  value={form.targetId}
                  onValueChange={(targetId) => set({ targetId })}
                  placeholder={targets.length === 0 ? 'No targets in this engagement yet' : 'Pick a target'}
                  options={targets.map((t) => ({ value: t.id, label: `${t.value} (${kindLabel(t.kind)})` }))}
                />
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              <div>
                <FieldLabel>Kind of target</FieldLabel>
                <Select
                  ariaLabel="Kind of target"
                  value={form.targetKind}
                  onValueChange={(targetKind) => set({ targetKind })}
                  options={TARGET_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))}
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[13px] font-medium">Only targets in scope</span>
                  <span className="text-[12px] text-muted-foreground">
                    Skip anything the scope rules exclude or do not mention.
                  </span>
                </span>
                <Switch
                  checked={form.inScopeOnly}
                  onCheckedChange={(inScopeOnly) => set({ inScopeOnly })}
                  aria-label="Only targets in scope"
                />
              </div>
            </div>
          )}
        </section>

        <section>
          <Legend>Do</Legend>
          <div role="radiogroup" aria-label="What to run" className="grid grid-cols-2 gap-2">
            <Choice
              selected={form.runs === 'workflow'}
              onSelect={() => set({ runs: 'workflow' })}
              icon={<Workflow className="size-4" strokeWidth={1.75} />}
            >
              A workflow
            </Choice>
            <Choice
              selected={form.runs === 'tool'}
              onSelect={() => set({ runs: 'tool' })}
              icon={<Wrench className="size-4" strokeWidth={1.75} />}
            >
              A tool
            </Choice>
          </div>

          <div className="mt-3 flex flex-col gap-3">
            {form.runs === 'workflow' ? (
              <div>
                <FieldLabel>Workflow</FieldLabel>
                <Select
                  ariaLabel="Workflow"
                  value={form.workflowId}
                  onValueChange={(workflowId) => set({ workflowId })}
                  placeholder={workflows.length === 0 ? 'No workflows yet' : 'Pick a workflow'}
                  options={workflows.map((w) => ({ value: w.id, label: w.name }))}
                />
              </div>
            ) : (
              <div>
                <FieldLabel>Tool</FieldLabel>
                <Select
                  ariaLabel="Tool"
                  value={form.nodeType}
                  onValueChange={(nodeType) => {
                    // Options belong to one tool; another tool starts from its own defaults.
                    set({ nodeType, nodeParams: {} })
                    setShowOptions(false)
                  }}
                  placeholder="Pick a tool"
                  options={tools.map((t) => ({ value: t.type, label: t.label }))}
                />
                {tool !== undefined && tool.params.length > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="flex-1 text-[12px] text-muted-foreground">
                      {Object.keys(form.nodeParams).length === 0
                        ? "Runs with the tool's default options."
                        : 'Runs with the options you changed.'}
                    </span>
                    <Button variant="glass" size="sm" onClick={() => setShowOptions((v) => !v)}>
                      {showOptions ? 'Hide options' : 'Edit options'}
                    </Button>
                  </div>
                )}
                {tool !== undefined && showOptions && (
                  <div className="mt-2 rounded-[14px] border border-glass-border">
                    <ParamDrawer
                      params={tool.params.filter((p) => p.name !== 'target')}
                      values={form.nodeParams}
                      chips={[]}
                      onChange={(name, value) => set({ nodeParams: { ...form.nodeParams, [name]: value } })}
                    />
                  </div>
                )}
              </div>
            )}

            <div>
              <FieldLabel>Run on</FieldLabel>
              <Select
                ariaLabel="Run on"
                value={form.backendProfileId}
                onValueChange={(backendProfileId) => set({ backendProfileId })}
                options={[
                  { value: DEFAULT_BACKEND, label: 'Engagement default' },
                  { value: LOCAL_BACKEND, label: 'This machine' },
                  ...backends.map((b) => ({ value: b.id, label: `${b.name} (${b.kind})` })),
                ]}
              />
            </div>
          </div>
        </section>

        <section>
          <Legend>Applies to</Legend>
          <div role="radiogroup" aria-label="Applies to" className="flex flex-col gap-2">
            <ScopeOption
              selected={scopeOf(form) === 'default'}
              disabled={timed}
              onSelect={() => set({ scope: 'default' })}
              title="Every engagement"
              hint={
                timed
                  ? 'A schedule runs against one engagement, so it cannot be a default.'
                  : 'A default. It also covers engagements you create later.'
              }
            />
            <ScopeOption
              selected={scopeOf(form) === 'engagement'}
              onSelect={() => set({ scope: 'engagement' })}
              title="Only this engagement"
              hint={engagementName}
            />
          </div>
        </section>

        <p className="rounded-[14px] border border-glass-border bg-glass px-3.5 py-2.5 text-[13px] text-muted-foreground">{sentence}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-glass-border px-5 py-3.5">
        <span role="status" className={cn('min-w-0 flex-1 truncate text-[12px]', error !== null ? 'text-destructive' : 'text-muted-foreground')}>
          {error ?? problem ?? ''}
        </span>
        <Button variant="glass" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={problem !== null || busy} onClick={() => void save()}>
          {busy && <Spinner size="sm" />}
          Create action
        </Button>
      </div>
      </aside>
    </GlassPanel>
  )
}
