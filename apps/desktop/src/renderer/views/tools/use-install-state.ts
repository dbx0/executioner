import { useCallback, useEffect, useMemo } from 'react'
import type { AxiosInstance } from 'axios'
import type { NodeListing } from '../../api/nodes.js'
import { toolsApi } from '../../api/tools.js'
import type { InstallState } from './CatalogPane.js'
import { LOCAL } from './ConnectionPicker.js'
import type { ProbeState } from './tools-store.js'

export interface InstallStatus {
  /** The selected connection's probe, undefined before it is first asked. */
  probe: ProbeState | undefined
  /** Forget this connection's answer, so it is asked again. */
  recheck: () => void
  installState: (node: NodeListing) => InstallState
  /** How much of the catalog the chosen connection has, at a glance. */
  installCounts: { installed: number; missing: number }
}

/** Install status of every tool, per connection: probed once, kept until Recheck. */
export function useInstallState({
  client,
  nodes,
  backendId,
  probes,
  setProbes,
}: {
  client: AxiosInstance | null
  nodes: NodeListing[]
  backendId: string
  probes: Record<string, ProbeState>
  setProbes: (fn: (prev: Record<string, ProbeState>) => Record<string, ProbeState>) => void
}): InstallStatus {
  const programs = useMemo(() => {
    const set = new Set<string>()
    for (const n of nodes) if (n.program !== undefined && n.program !== '') set.add(n.program)
    return [...set]
  }, [nodes])

  // A check that could not reach its connection is not an answer worth
  // keeping: ask again each time the page opens. Answers are kept.
  useEffect(() => {
    setProbes((prev) => Object.fromEntries(Object.entries(prev).filter(([, p]) => p.error === null)))
  }, [setProbes])

  const recheck = useCallback(() => {
    setProbes((prev) => {
      const next = { ...prev }
      delete next[backendId]
      return next
    })
  }, [setProbes, backendId])

  // Probe the selected connection once, the first time it is used. Same cost
  // model as Settings: one round trip per connection, kept after that, across
  // view switches, until Recheck.
  useEffect(() => {
    if (client === null || programs.length === 0) return
    if (probes[backendId] !== undefined) return
    setProbes((prev) => ({ ...prev, [backendId]: { busy: true, byProgram: {}, error: null } }))
    void toolsApi(client)
      .probeBatch(programs, backendId === LOCAL ? undefined : backendId)
      .then((res) =>
        setProbes((prev) => ({
          ...prev,
          [backendId]: {
            busy: false,
            byProgram: Object.fromEntries(res.results.map((r) => [r.program, r])),
            error: res.error ?? null,
          },
        })),
      )
      .catch(() =>
        setProbes((prev) => ({
          ...prev,
          [backendId]: { busy: false, byProgram: {}, error: 'Could not reach the engine.' },
        })),
      )
  }, [client, programs, backendId, probes, setProbes])

  const installState = useCallback(
    (n: NodeListing): InstallState => {
      const state = probes[backendId]
      if (n.program === undefined || n.program === '') return 'unknown'
      // An unreachable connection makes every tool unknown, never "missing":
      // the tool may well be there, we just could not ask.
      if (state === undefined || state.busy || state.error !== null) return 'unknown'
      const probe = state.byProgram[n.program]
      if (probe === undefined) return 'unknown'
      return probe.installed ? 'installed' : 'missing'
    },
    [probes, backendId],
  )

  // Only an answered probe counts: "unknown" is neither installed nor missing.
  const installCounts = useMemo(() => {
    let installed = 0
    let missing = 0
    for (const n of nodes) {
      const state = installState(n)
      if (state === 'installed') installed++
      else if (state === 'missing') missing++
    }
    return { installed, missing }
  }, [nodes, installState])

  return { probe: probes[backendId], recheck, installState, installCounts }
}
