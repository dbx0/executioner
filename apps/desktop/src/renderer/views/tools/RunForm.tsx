import type { JSX, RefObject } from 'react'
import { useMemo, useState } from 'react'
import { Check, Download, Loader2, Play, Plus, RotateCcw, Search } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { cn } from '../../lib/utils.js'
import { ParamDrawer, toParamSpecs } from '../../components/canvas/ParamDrawer.js'
import type { NodeListing } from '../../api/nodes.js'
import type { TargetSummary } from '../../api/targets.js'
import type { InstallState } from './CatalogPane.js'
import { CommandPreview, type CommandPreviewState } from './CommandPreview.js'
import { AddTargetInline } from './AddTargetInline.js'

/** Where the form's current params came from, so the form can say so. */
export type ParamsOrigin = 'last-run' | 'replay' | 'edited' | null

/** How the run shortcut reads on this platform. */
const RUN_SHORTCUT = /Mac/.test(navigator.userAgent) ? '⌘↵' : 'Ctrl+Enter'

/** A value the user has not given: unset, or blank text. */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

/**
 * The run form: which target, what params, and Run. The connection is picked
 * once for the whole page, in its header.
 *
 * Run is blocked with the reason stated rather than left enabled to fail — a
 * tool that is not on the chosen connection offers Install instead, because a
 * run that can only exit "command not found" teaches the user nothing.
 */
export function RunForm({
  node,
  targets,
  targetIds,
  onTargetIds,
  onAddTarget,
  params,
  onParam,
  paramsOrigin,
  onResetParams,
  installState,
  preview,
  startError,
  starting,
  onRun,
  onInstall,
  runRef,
  runsOn,
  connectionNote,
}: {
  node: NodeListing | null
  targets: TargetSummary[]
  /** Every target the run goes to: one run per target, in this order. */
  targetIds: string[]
  onTargetIds: (ids: string[]) => void
  /** Create a target and add it to the picked ones; rejects with the reason. */
  onAddTarget: (kind: string, value: string) => Promise<void>
  params: Record<string, unknown>
  onParam: (name: string, value: unknown) => void
  paramsOrigin: ParamsOrigin
  /** Drop every changed param, so each field falls back to its default. */
  onResetParams: () => void
  installState: InstallState
  preview: CommandPreviewState
  /** Why the last Run did not start, until the form changes. */
  startError: string | null
  starting: boolean
  onRun: () => void
  onInstall: () => void
  /** The Run button, so the page's Ctrl+Enter presses exactly what is offered. */
  runRef?: RefObject<HTMLButtonElement | null>
  /** The connection Run sends to, by name, so it is never a surprise. */
  runsOn: string
  /** Why the connection needs picking again, after loading a past run. */
  connectionNote: string | null
}): JSX.Element {
  const [targetQuery, setTargetQuery] = useState('')
  const [adding, setAdding] = useState(false)

  // Only targets of a kind this tool accepts; an empty `accepts` accepts all.
  const eligible = useMemo(() => {
    if (node === null) return []
    return node.accepts.length === 0 ? targets : targets.filter((t) => node.accepts.includes(t.kind))
  }, [node, targets])

  if (node === null) {
    const picked = targetIds.length === 1 ? targets.find((t) => t.id === targetIds[0]) : undefined
    return (
      <div className="grid h-full place-items-center p-6">
        <p className="text-[13px] text-muted-foreground">
          {picked === undefined ? 'Pick a tool to run.' : `Pick a tool to run against ${picked.value}.`}
        </p>
      </div>
    )
  }

  const specs = toParamSpecs(node.params)
  const needle = targetQuery.trim().toLowerCase()
  const shown = needle === '' ? eligible : eligible.filter((t) => t.value.toLowerCase().includes(needle))
  const toggle = (id: string): void =>
    onTargetIds(targetIds.includes(id) ? targetIds.filter((t) => t !== id) : [...targetIds, id])
  // Select-all works on what the search shows, so "search, then select all" is
  // how a batch gets picked.
  const allShown = shown.length > 0 && shown.every((t) => targetIds.includes(t.id))
  const toggleShown = (): void => {
    const ids = new Set(shown.map((t) => t.id))
    onTargetIds(
      allShown ? targetIds.filter((t) => !ids.has(t)) : [...targetIds, ...shown.map((t) => t.id).filter((t) => !targetIds.includes(t))],
    )
  }
  const missing = installState === 'missing'
  // `required` is a promise the manifest makes about the tool: run without it
  // and the tool fails or does something useless, so do not offer the run. A
  // param with no default is required too: the engine refuses to run without it.
  const unfilled = specs.find(
    (s) =>
      (s.required === true || (s.default === undefined && s.type !== 'boolean')) &&
      isBlank(params[s.name] ?? s.default),
  )
  const noTarget = targetIds.length === 0
  const blocked = missing || noTarget || unfilled !== undefined || connectionNote !== null
  const reason =
    connectionNote !== null
      ? connectionNote
      : missing
        ? `${node.program ?? node.id} is not installed on this connection.`
        : noTarget && eligible.length > 0
          ? 'Pick a target to run against.'
          : unfilled !== undefined
            ? `Fill in ${unfilled.label ?? unfilled.name} to run.`
            : startError
  const originNote =
    paramsOrigin === 'last-run'
      ? 'Filled in from your last run of this tool.'
      : paramsOrigin === 'replay'
        ? 'Filled in from the run you picked.'
        : paramsOrigin === 'edited'
          ? 'Changed from the defaults.'
          : null

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
        <div className="border-b border-border p-4">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[15px] font-medium">{node.name}</h2>
            {node.program !== undefined && (
              <span className="font-mono text-[11.5px] text-muted-foreground">{node.program}</span>
            )}
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{node.description}</p>
        </div>

        <div className="flex flex-col gap-3 border-b border-border p-4">
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center gap-2">
              <span>{targetIds.length > 1 ? `Targets (${targetIds.length})` : 'Target'}</span>
              <span className="ml-auto flex items-center gap-1">
                {eligible.length > 0 && (
                  <Button
                    variant="ghost"
                    size="xs"
                    aria-expanded={adding}
                    onClick={() => setAdding((v) => !v)}
                  >
                    <Plus className="mr-1 size-3" /> Add
                  </Button>
                )}
                {eligible.length > 1 && shown.length > 1 && (
                  <Button variant="ghost" size="xs" onClick={toggleShown}>
                    {allShown ? 'Deselect shown' : needle === '' ? 'Select all' : 'Select shown'}
                  </Button>
                )}
                {targetIds.length > 0 && (
                  <Button variant="ghost" size="xs" onClick={() => onTargetIds([])}>
                    Clear
                  </Button>
                )}
              </span>
            </div>
            {/* With no target this tool can take, adding one is the only way
                forward, so the field is simply there. */}
            {(adding || eligible.length === 0) && (
              <AddTargetInline toolName={node.name} accepts={node.accepts} onAdd={onAddTarget} />
            )}
            {eligible.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                No {node.accepts.join(', ')} target yet. Add one above.
              </p>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    value={targetQuery}
                    onChange={(e) => setTargetQuery(e.target.value)}
                    placeholder="Search targets"
                    aria-label="Search targets"
                    className="h-8 w-full rounded-md border border-input bg-transparent pl-7 pr-2 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                </div>
                <div
                  role="listbox"
                  aria-label="Target"
                  aria-multiselectable="true"
                  className="max-h-40 overflow-y-auto scrollbar-sleek rounded-md border border-border p-1"
                >
                  {shown.length === 0 ? (
                    <p className="px-1.5 py-2 text-[12px] text-muted-foreground">No target matches that.</p>
                  ) : (
                    shown.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="option"
                        aria-selected={targetIds.includes(t.id)}
                        onClick={() => toggle(t.id)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12.5px]',
                          targetIds.includes(t.id) ? 'selected-surface' : 'hover:bg-surface-2',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'grid size-3.5 shrink-0 place-items-center rounded-[3px] border',
                            targetIds.includes(t.id) ? 'border-foreground bg-foreground text-background' : 'border-input',
                          )}
                        >
                          {targetIds.includes(t.id) && <Check className="size-2.5" strokeWidth={3} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{t.value}</span>
                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {t.kind}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {specs.length > 0 && originNote !== null && Object.keys(params).length > 0 && (
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-[12px] text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">{originNote}</span>
            <Button variant="ghost" size="xs" onClick={onResetParams}>
              <RotateCcw className="mr-1 size-3" /> Reset to defaults
            </Button>
          </div>
        )}

        {specs.length > 0 ? (
          // No template chips: a standalone run has no upstream node to reference, and
          // the target is already picked above.
          <ParamDrawer params={specs} values={params} onChange={onParam} chips={[]} />
        ) : (
          <p className="p-4 text-[12.5px] text-muted-foreground">This tool takes no parameters.</p>
        )}
      </div>

      <CommandPreview state={preview} more={Math.max(0, targetIds.length - 1)} />

      <div className="flex shrink-0 items-center gap-3 border-t border-border p-3">
        {missing ? (
          <Button variant="outline" size="sm" onClick={onInstall}>
            <Download className="mr-1.5 size-3.5" /> Install {node.program ?? node.id}
          </Button>
        ) : (
          <Button
            ref={runRef}
            size="sm"
            disabled={blocked || starting}
            onClick={onRun}
            title={`Run (${RUN_SHORTCUT})`}
          >
            {starting ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Play className="mr-1.5 size-3.5" />}
            {targetIds.length > 1 ? `Run on ${targetIds.length} targets` : 'Run'}
          </Button>
        )}
        {reason !== null && (
          <span
            role={reason === startError ? 'alert' : undefined}
            className={cn(
              'min-w-0 truncate text-[12px]',
              reason === startError ? 'text-status-error' : 'text-muted-foreground',
            )}
            title={reason}
          >
            {reason}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground">on {runsOn}</span>
      </div>
    </div>
  )
}
