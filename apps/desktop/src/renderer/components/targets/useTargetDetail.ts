import { useEffect, useRef, useState } from 'react'
import type { ScreenshotItem, TargetDetail, targetsApi } from '../../api/targets.js'
import { apiErrorMessage } from '../../lib/api-error.js'
import { useEngineChange } from '../../lib/engine-changes.js'
import type { TargetRenamePatch } from './TargetEditBar.js'

type TargetsApi = ReturnType<typeof targetsApi>

export interface TargetDetailState {
  target: TargetDetail | null
  screenshots: ScreenshotItem[]
  /** True only for the first fetch of a target, never for a live refresh. */
  loading: boolean
  /** Screenshots arrive after the detail, so they have a flag of their own. */
  screenshotsLoading: boolean
  renaming: boolean
  deleting: boolean
  error: string | null
  rename: (patch: TargetRenamePatch) => void
  remove: () => void
}

/**
 * Loads one target's detail and screenshots and owns its rename and delete.
 * Kept out of the pane so the pane is only layout.
 */
export function useTargetDetail(
  api: TargetsApi,
  targetId: string,
  { onChanged, onDeleted }: { onChanged?: (() => void) | undefined; onDeleted?: (() => void) | undefined },
): TargetDetailState {
  const [target, setTarget] = useState<TargetDetail | null>(null)
  const [screenshots, setScreenshots] = useState<ScreenshotItem[]>([])
  const [loading, setLoading] = useState(true)
  const [screenshotsLoading, setScreenshotsLoading] = useState(true)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    const detail = await api.get(targetId)
    setTarget(detail)
    try {
      setScreenshots(await api.screenshots(targetId))
    } catch {
      setScreenshots([])
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setScreenshots([])
    setScreenshotsLoading(true)
    void (async () => {
      try {
        const detail = await api.get(targetId)
        if (cancelled) return
        setTarget(detail)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
      try {
        const shots = await api.screenshots(targetId)
        if (!cancelled) setScreenshots(shots)
      } catch {
        if (!cancelled) setScreenshots([])
      } finally {
        if (!cancelled) setScreenshotsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api, targetId])

  // A live refresh swaps the findings in place: no loading state, and the
  // rename input and open sections are untouched because only `target` changes.
  const current = useRef({ api, targetId })
  useEffect(() => {
    current.current = { api, targetId }
  })
  useEngineChange(['findings'], () => {
    const asked = { api, targetId }
    void api
      .get(targetId)
      .then((detail) => {
        if (current.current.api === asked.api && current.current.targetId === asked.targetId) setTarget(detail)
      })
      .catch(() => {})
  })

  const rename = (patch: TargetRenamePatch): void => {
    setRenaming(true)
    setError(null)
    void (async () => {
      try {
        await api.update(targetId, patch)
        await refresh()
        onChanged?.()
      } catch (e) {
        setError(apiErrorMessage(e, 'Could not rename that target.'))
      } finally {
        setRenaming(false)
      }
    })()
  }

  const remove = (): void => {
    setDeleting(true)
    setError(null)
    void (async () => {
      try {
        await api.remove(targetId)
        onDeleted?.()
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setDeleting(false)
      }
    })()
  }

  return { target, screenshots, loading, screenshotsLoading, renaming, deleting, error, rename, remove }
}
