import { useCallback } from 'react'
import type { AxiosInstance } from 'axios'
import { targetsApi, type TargetSummary } from '../../api/targets.js'
import type { BackendProfile } from '../../api/backends.js'
import type { StandaloneRun } from '../../api/executions.js'
import { apiErrorMessage } from '../../lib/api-error.js'
import { LOCAL } from './ConnectionPicker.js'
import type { ToolsData } from './use-tools-data.js'
import type { ToolsPageState } from './use-tools-page.js'

export interface ToolSelection {
  /** Pick a tool: its last-used params come back, and targets it cannot take are dropped. */
  selectNode: (id: string) => void
  /** Where a past run executed, in words: its connection's name when known. */
  connectionLabel: (run: StandaloneRun) => string
  /** Load a past run's whole setup back into the form, and show what it produced. */
  replay: (run: StandaloneRun) => void
  /** Create a target from the form, then pick it alongside any already picked. */
  addTarget: (kind: string, value: string) => Promise<void>
}

/** Everything that changes what the form holds: picking a tool, replaying a run, adding a target. */
export function useToolSelection({
  client,
  data,
  state,
  setStartError,
}: {
  client: AxiosInstance | null
  data: ToolsData
  state: ToolsPageState
  setStartError: (error: string | null) => void
}): ToolSelection {
  const { nodes, targets, setTargets, profiles, recent } = data
  const { setNodeId, setParams, setParamsOrigin, setTargetIds, setBackendId, setConnectionNote } = state
  const { watch, setLiveFor, setBatchFor, setTabFor } = state
  const batches = state.page.batches

  /** A tool's last-used params: the newest standalone run of that node. */
  const lastParamsFor = useCallback(
    (id: string): Record<string, unknown> => recent.find((r) => r.nodeId === id)?.params ?? {},
    [recent],
  )

  const selectNode = useCallback(
    (id: string) => {
      setNodeId(id)
      setStartError(null)
      const last = lastParamsFor(id)
      setParams(last)
      setParamsOrigin(Object.keys(last).length > 0 ? 'last-run' : null)
      // A target the new tool cannot accept would only earn a 400, so drop it.
      const next = nodes.find((n) => n.id === id)
      if (next !== undefined && next.accepts.length > 0) {
        setTargetIds((ids) =>
          ids.filter((tid) => {
            const t = targets.find((x) => x.id === tid)
            return t !== undefined && next.accepts.includes(t.kind)
          }),
        )
      }
    },
    [nodes, targets, lastParamsFor, setNodeId, setParams, setParamsOrigin, setTargetIds, setStartError],
  )

  /**
   * The saved connection a past run used. Runs saved before the profile id was
   * kept carry only the kind ("ssh"); with exactly one profile of that kind the
   * answer is still certain. A run that named a profile now deleted has no
   * answer: another profile of the same kind is a different machine. Null means
   * unknown, which is NOT this machine.
   */
  const profileFor = useCallback(
    (run: StandaloneRun): BackendProfile | null => {
      if (run.backendProfileId !== null) return profiles.find((p) => p.id === run.backendProfileId) ?? null
      if (run.backend === LOCAL) return null
      const sameKind = profiles.filter((p) => p.kind === run.backend)
      return sameKind.length === 1 ? sameKind[0]! : null
    },
    [profiles],
  )

  const connectionLabel = useCallback(
    (run: StandaloneRun): string => {
      if (run.backend === LOCAL) return 'this machine'
      return profileFor(run)?.name ?? run.backend
    },
    [profileFor],
  )

  const replay = useCallback(
    (run: StandaloneRun) => {
      setNodeId(run.nodeId)
      setStartError(null)
      setParams(run.params)
      setParamsOrigin(Object.keys(run.params).length > 0 ? 'replay' : null)
      if (run.targetId !== null && targets.some((t) => t.id === run.targetId)) setTargetIds([run.targetId])
      // A run on this machine goes back to this machine. A remote run whose
      // connection cannot be found (deleted, or ambiguous) keeps the current
      // selection and says so: quietly switching to this machine would run a
      // remote-only tool where it is not installed.
      const profile = profileFor(run)
      if (run.backend === LOCAL) {
        setBackendId(LOCAL)
        setConnectionNote(null)
      } else if (profile !== null) {
        setBackendId(profile.id)
        setConnectionNote(null)
      } else {
        setConnectionNote(`The ${run.backend} connection this run used is gone, so pick where to run it.`)
      }
      // And show what it produced. A run still going streams like one started here.
      const startedAt = run.startedAt === null ? Date.now() : Date.parse(run.startedAt)
      if (run.status === 'running') watch(run.id)
      setLiveFor(run.nodeId, { executionId: run.id, nodeId: run.nodeId, status: run.status, startedAt })
      setTabFor(run.nodeId, 'output')
      // The batch's tabs only make sense while one of its runs is on screen.
      if (!(batches[run.nodeId] ?? []).some((b) => b.executionId === run.id)) setBatchFor(run.nodeId, [])
    },
    [targets, profileFor, watch, batches, setNodeId, setParams, setParamsOrigin, setTargetIds, setBackendId, setConnectionNote, setLiveFor, setBatchFor, setTabFor, setStartError],
  )

  const addTarget = useCallback(
    async (kind: string, value: string): Promise<void> => {
      if (client === null) return
      const api = targetsApi(client)
      let created: TargetSummary
      try {
        created = (await api.create({ kind, value, source: 'manual' })) as TargetSummary
      } catch (e) {
        throw new Error(apiErrorMessage(e, 'Could not add that target.'), { cause: e })
      }
      setTargets(await api.list().catch(() => [...targets, created]))
      setTargetIds((ids) => (ids.includes(created.id) ? ids : [...ids, created.id]))
      setStartError(null)
    },
    [client, targets, setTargets, setTargetIds, setStartError],
  )

  return { selectNode, connectionLabel, replay, addTarget }
}
