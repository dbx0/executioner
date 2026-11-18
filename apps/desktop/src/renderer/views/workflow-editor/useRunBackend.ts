import { useCallback, useEffect, useState } from 'react'
import type { AxiosInstance } from 'axios'
import { backendsApi, type BackendProfile } from '../../api/backends.js'
import { notify } from '../../lib/toast.js'
import { loadRunBackend, saveRunBackend } from '../../store/persistence.js'

/**
 * Where a run executes: the chosen backend and the saved profiles to choose
 * from. The choice is restored per engagement, because a run backend that
 * silently reverts to local is the difference between a workflow scanning the
 * remote host and every tool failing to spawn here.
 */
export function useRunBackend(
  client: AxiosInstance,
  activeRoot: string | null,
): {
  backendId: string
  setBackendId: (id: string) => void
  profiles: BackendProfile[]
  /** Re-read the profiles after the backends dialog saved one. */
  reloadProfiles: () => void
} {
  const [backendId, setBackendIdState] = useState<string>(() => loadRunBackend(activeRoot))
  const [profiles, setProfiles] = useState<BackendProfile[]>([])

  const setBackendId = useCallback(
    (id: string) => {
      setBackendIdState(id)
      saveRunBackend(activeRoot, id)
    },
    [activeRoot],
  )

  useEffect(() => {
    void backendsApi(client)
      .list()
      .then((list) => {
        setProfiles(list)
        // A remembered backend whose profile is gone can't be used, but falling
        // back to local changes where every tool runs, so say so rather than
        // reverting in silence.
        const remembered = loadRunBackend(activeRoot)
        if (remembered !== 'local' && !list.some((p) => p.id === remembered)) {
          setBackendId('local')
          notify('That run backend no longer exists. Runs will use this machine.')
        }
      })
      .catch(() => setProfiles([]))
  }, [client, activeRoot, setBackendId])

  // Switching engagements without remounting must pick up that engagement's
  // remembered backend rather than keeping the previous one.
  useEffect(() => {
    setBackendIdState(loadRunBackend(activeRoot))
  }, [activeRoot])

  const reloadProfiles = useCallback(() => {
    void backendsApi(client)
      .list()
      .then((list) => {
        setProfiles(list)
        if (backendId !== 'local' && !list.some((p) => p.id === backendId)) setBackendId('local')
      })
      .catch(() => setProfiles([]))
  }, [client, backendId, setBackendId])

  return { backendId, setBackendId, profiles, reloadProfiles }
}
