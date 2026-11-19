import type { JSX, RefObject } from 'react'
import { useMemo, useRef } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { ParamDrawer, toParamSpecs } from '../../components/canvas/ParamDrawer.js'
import type { NodeListing } from '../../api/nodes.js'
import type { TargetSummary } from '../../api/targets.js'
import type { InstallState } from './CatalogPane.js'
import { CommandPreview, type CommandPreviewState } from './CommandPreview.js'
import { PresetBar } from './PresetBar.js'
import { RunFooter } from './RunFooter.js'
import { RunTargets } from './RunTargets.js'
import type { ParamPreset } from './presets.js'

/** Where the form's current params came from, so the form can say so. */
export type ParamsOrigin = 'last-run' | 'replay' | 'preset' | 'edited' | null

/** A value the user has not given: unset, or blank text. */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

/**
 * The run form: which target, what params, and Run. The connection is picked
 * once for the whole page, in its header.
 *
 * Run is blocked with the reason stated rather than left enabled to fail: a
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
  presets,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
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
  /** This tool's saved param sets, and what to do with them. */
  presets: ParamPreset[]
  onApplyPreset: (preset: ParamPreset) => void
  onSavePreset: (name: string) => void
  onDeletePreset: (name: string) => void
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
  const formRef = useRef<HTMLDivElement>(null)

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
  // When the reason is a missing value, mark that field and let the reason
  // take you to it; one thing to fix at a time, so not before a target is picked.
  const neededParam =
    connectionNote === null && !missing && !(noTarget && eligible.length > 0) && unfilled !== undefined
      ? unfilled.name
      : null
  const focusNeeded = (): void => {
    if (neededParam === null) return
    formRef.current?.querySelector<HTMLElement>(`[aria-label=${JSON.stringify(neededParam)}]`)?.focus()
  }
  const originNote =
    paramsOrigin === 'last-run'
      ? 'Filled in from your last run of this tool.'
      : paramsOrigin === 'replay'
        ? 'Filled in from the run you picked.'
        : paramsOrigin === 'preset'
          ? 'Filled in from a saved preset.'
          : paramsOrigin === 'edited'
            ? 'Changed from the defaults.'
            : null

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div ref={formRef} className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-glass-border p-4">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{node.name}</h2>
            {node.program !== undefined && (
              <span className="font-mono text-[11.5px] text-muted-foreground">{node.program}</span>
            )}
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{node.description}</p>
        </div>

        <RunTargets
          node={node}
          eligible={eligible}
          targetIds={targetIds}
          onTargetIds={onTargetIds}
          onAddTarget={onAddTarget}
        />

        {specs.length > 0 && (
          <PresetBar
            presets={presets}
            params={params}
            onApply={onApplyPreset}
            onSave={onSavePreset}
            onDelete={onDeletePreset}
          />
        )}

        {specs.length > 0 && originNote !== null && Object.keys(params).length > 0 && (
          <div className="flex items-center gap-2 border-b border-glass-border px-4 py-2 text-[12px] text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">{originNote}</span>
            <Button variant="ghost" size="xs" onClick={onResetParams}>
              <RotateCcw className="size-3" /> Reset to defaults
            </Button>
          </div>
        )}

        {specs.length > 0 ? (
          // No template chips: a standalone run has no upstream node to reference, and
          // the target is already picked above.
          <ParamDrawer params={specs} values={params} onChange={onParam} chips={[]} invalid={neededParam} />
        ) : (
          <p className="p-4 text-[12.5px] text-muted-foreground">This tool takes no parameters.</p>
        )}
      </div>

      <CommandPreview state={preview} more={Math.max(0, targetIds.length - 1)} />

      <RunFooter
        program={node.program ?? node.id}
        missing={missing}
        blocked={blocked}
        starting={starting}
        targetCount={targetIds.length}
        reason={reason}
        isError={reason !== null && reason === startError}
        onFocusNeeded={neededParam !== null ? focusNeeded : null}
        onRun={onRun}
        onInstall={onInstall}
        runRef={runRef}
        runsOn={runsOn}
      />
    </div>
  )
}
