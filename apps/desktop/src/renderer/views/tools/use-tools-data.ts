import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { AxiosInstance } from 'axios'
import { nodesApi, type NodeListing } from '../../api/nodes.js'
import { targetsApi, type TargetSummary } from '../../api/targets.js'
import { backendsApi, type BackendProfile } from '../../api/backends.js'
import { executionsApi, type StandaloneRun } from '../../api/executions.js'
import { toolsApi, type ToolInfo } from '../../api/tools.js'

export interface ToolsData {
  nodes: NodeListing[]
  /** True until the node list has answered, so the catalog can show a skeleton. */
  loading: boolean
  targets: TargetSummary[]
  setTargets: Dispatch<SetStateAction<TargetSummary[]>>
  profiles: BackendProfile[]
  /** Install instructions by program. */
  catalog: Record<string, ToolInfo>
  /** The standalone run history, newest first. */
  recent: StandaloneRun[]
  refreshRecent: () => void
  /** This machine's OS, for install instructions. */
  platform: string
}

/** Everything the Tools page reads from the engine once, on open. */
export function useToolsData(client: AxiosInstance | null): ToolsData {
  const [nodes, setNodes] = useState<NodeListing[]>([])
  const [loading, setLoading] = useState(true)
  const [targets, setTargets] = useState<TargetSummary[]>([])
  const [profiles, setProfiles] = useState<BackendProfile[]>([])
  const [catalog, setCatalog] = useState<Record<string, ToolInfo>>({})
  const [recent, setRecent] = useState<StandaloneRun[]>([])
  const [platform, setPlatform] = useState('')

  const refreshRecent = useCallback(() => {
    if (client === null) return
    void executionsApi(client)
      .standalone()
      .then(setRecent)
      .catch(() => setRecent([]))
  }, [client])

  useEffect(() => {
    if (client === null) return
    void nodesApi(client)
      .list()
      .then(setNodes)
      .catch(() => setNodes([]))
      .finally(() => setLoading(false))
    void targetsApi(client)
      .list()
      .then(setTargets)
      .catch(() => setTargets([]))
    void backendsApi(client)
      .list()
      .then(setProfiles)
      .catch(() => setProfiles([]))
    void toolsApi(client)
      .list()
      .then((data) => {
        setPlatform(data.platform)
        setCatalog(Object.fromEntries(data.tools.map((t) => [t.program, t])))
      })
      .catch(() => setCatalog({}))
    refreshRecent()
  }, [client, refreshRecent])

  return { nodes, loading, targets, setTargets, profiles, catalog, recent, refreshRecent, platform }
}
