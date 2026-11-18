import { useCallback, useEffect, useMemo } from 'react'
import type { EngineConnection } from '../../lib/connection.js'
import type { LiveRun } from './OutputPane.js'
import {
  EMPTY_PAGE,
  subscribeToolEvents,
  useToolsStore,
  type BatchRun,
  type PerEngagement,
  type ProbeState,
  type ToolsPage,
  type ToolTab,
} from './tools-store.js'

const NO_BATCH: BatchRun[] = []
const NO_PROBES: Record<string, ProbeState> = {}

/** A React-style setter: a value, or a function of the previous one. */
export type Setter<T> = (value: T | ((prev: T) => T)) => void

/** The kept state of one engagement's Tools page, and every way to change it. */
export interface ToolsPageState {
  /** The engagement's project root: the key everything here is kept under. */
  root: string
  page: ToolsPage
  setQuery: Setter<ToolsPage['query']>
  setNodeId: Setter<ToolsPage['nodeId']>
  setTargetIds: Setter<ToolsPage['targetIds']>
  setBackendId: Setter<ToolsPage['backendId']>
  setParams: Setter<ToolsPage['params']>
  setParamsOrigin: Setter<ToolsPage['paramsOrigin']>
  setConnectionNote: Setter<ToolsPage['connectionNote']>
  /** The run the picked tool's Output tab is watching. */
  live: LiveRun | null
  /** The runs the picked tool's last multi-target Run started. */
  batch: BatchRun[]
  setLiveFor: (toolId: string, value: LiveRun | null | ((prev: LiveRun | null) => LiveRun | null)) => void
  setTabFor: (toolId: string | null, next: ToolTab) => void
  setBatchFor: (toolId: string, runs: BatchRun[]) => void
  /** Streams and final statuses collected for this engagement, if any yet. */
  runs: PerEngagement | undefined
  /** Install checks by connection id. */
  probes: Record<string, ProbeState>
  setProbes: (fn: (prev: Record<string, ProbeState>) => Record<string, ProbeState>) => void
  /** Start keeping a run's output. */
  watch: (executionId: string) => void
}

/**
 * The Tools page's kept state for one engagement, with a setter per field.
 *
 * What the user picked and the run they are watching live in the tools store,
 * per engagement, so switching views and back finds the page as left.
 */
export function useToolsPage(connection: EngineConnection | undefined): ToolsPageState {
  const root = connection?.projectRoot ?? ''
  const page = useToolsStore((s) => s.pages[root] ?? EMPTY_PAGE)
  const update = useToolsStore((s) => s.update)

  const setters = useMemo(() => {
    const field =
      <K extends keyof ToolsPage>(key: K): Setter<ToolsPage[K]> =>
      (value) =>
        update(root, (p) => ({
          ...p,
          [key]: typeof value === 'function' ? (value as (prev: ToolsPage[K]) => ToolsPage[K])(p[key]) : value,
        }))
    return {
      setQuery: field('query'),
      setNodeId: field('nodeId'),
      setTargetIds: field('targetIds'),
      setBackendId: field('backendId'),
      setParams: field('params'),
      setParamsOrigin: field('paramsOrigin'),
      setConnectionNote: field('connectionNote'),
    }
  }, [root, update])

  // Output belongs to its tool: each one keeps the run its Output tab watches
  // and its last batch, so picking another tool never shows this one's run.
  const { nodeId, lives, batches } = page
  const live = nodeId === null ? null : (lives[nodeId] ?? null)
  const batch = nodeId === null ? NO_BATCH : (batches[nodeId] ?? NO_BATCH)
  const setLiveFor = useCallback(
    (toolId: string, value: LiveRun | null | ((prev: LiveRun | null) => LiveRun | null)) =>
      update(root, (p) => {
        const next = typeof value === 'function' ? value(p.lives[toolId] ?? null) : value
        const nextLives = { ...p.lives }
        if (next === null) delete nextLives[toolId]
        else nextLives[toolId] = next
        return { ...p, lives: nextLives }
      }),
    [root, update],
  )
  const setTabFor = useCallback(
    (toolId: string | null, next: ToolTab) =>
      update(root, (p) => ({ ...p, tabs: { ...p.tabs, [toolId ?? '']: next } })),
    [root, update],
  )
  const setBatchFor = useCallback(
    (toolId: string, runs: BatchRun[]) => update(root, (p) => ({ ...p, batches: { ...p.batches, [toolId]: runs } })),
    [root, update],
  )

  // Tool output keeps arriving while the page is away; this only makes sure
  // the engagement's subscription is open. It is never closed from here.
  useEffect(() => {
    if (connection !== undefined) subscribeToolEvents(connection)
  }, [connection])
  const runs = useToolsStore((s) => s.runs[root])
  const probes = useToolsStore((s) => s.probes[root]) ?? NO_PROBES
  const setProbes = useCallback(
    (fn: (prev: Record<string, ProbeState>) => Record<string, ProbeState>) =>
      useToolsStore.getState().updateProbes(root, fn),
    [root],
  )
  const watch = useCallback((executionId: string) => useToolsStore.getState().watch(root, executionId), [root])

  return { root, page, ...setters, live, batch, setLiveFor, setTabFor, setBatchFor, runs, probes, setProbes, watch }
}

