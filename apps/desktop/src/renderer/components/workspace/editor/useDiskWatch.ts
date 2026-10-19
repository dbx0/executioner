import { useEffect, useRef } from 'react'
import type { FileContent, FileStat } from '../../../api/files.js'
import type { DiskBaseline } from '../../../store/types.js'
import { getDiskBaselineSignature } from './signature.js'

/** How often an open, visible tab re-checks its file. */
export const DISK_POLL_INTERVAL_MS = 5000

export type DiskCheckOutcome =
  | 'skipped'
  | 'unchanged'
  | 'refreshed-stat'
  | 'reloaded'
  | 'conflict'
  | 'deleted'
  | 'unavailable'

export interface DiskCheckParams {
  path: string
  isDirty: boolean
  baseline: DiskBaseline | undefined
  isWriteInFlight: () => boolean
  stat: (path: string) => Promise<FileStat>
  read: (path: string) => Promise<FileContent>
  /** Disk changed and the buffer was clean: adopt the new content silently. */
  onReload: (content: string) => void
  /** Disk changed under an unsaved buffer: warn, and do not touch the buffer. */
  onConflict: (diskContent: string) => void
  onDeleted: () => void
  onRebaseline: (baseline: DiskBaseline) => void
}

function isNotFound(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 404
}

/**
 * Decide what one disk check should do. Pure but for the two IO callbacks, so
 * the decision table is testable without timers or React.
 *
 * The stat is only a hint: it is what a frequent poll can afford, but mtime
 * moves for rewrites that changed nothing. The content signature is the
 * authority — a byte-identical rewrite refreshes the baseline and raises
 * nothing, because there is no change for the user to act on.
 */
export async function checkDiskState(params: DiskCheckParams): Promise<DiskCheckOutcome> {
  const { baseline } = params
  // Nothing to compare against yet, or our own write is mid-flight — statting
  // now would read back the bytes we are writing and flag a false conflict.
  if (baseline === undefined || params.isWriteInFlight()) {
    return 'skipped'
  }

  let stat: FileStat
  try {
    stat = await params.stat(params.path)
  } catch (error) {
    if (isNotFound(error)) {
      params.onDeleted()
      return 'deleted'
    }
    // A transient failure (engine restarting, network blip) is not evidence of
    // a change; stay quiet rather than alarming the user.
    return 'unavailable'
  }

  if (stat.mtimeMs === baseline.stat.mtimeMs && stat.size === baseline.stat.size) {
    return 'unchanged'
  }

  let disk: FileContent
  try {
    disk = await params.read(params.path)
  } catch (error) {
    if (isNotFound(error)) {
      params.onDeleted()
      return 'deleted'
    }
    return 'unavailable'
  }

  const signature = getDiskBaselineSignature(disk.content)
  if (signature === baseline.signature) {
    // Touched but not changed — refresh the hint so we stop re-reading it.
    params.onRebaseline({ stat: { mtimeMs: disk.mtimeMs, size: disk.size }, signature })
    return 'refreshed-stat'
  }

  if (params.isDirty) {
    params.onConflict(disk.content)
    return 'conflict'
  }

  params.onReload(disk.content)
  params.onRebaseline({ stat: { mtimeMs: disk.mtimeMs, size: disk.size }, signature })
  return 'reloaded'
}

/**
 * Poll one open file for external changes, on window focus and on an interval.
 *
 * Only runs while the tab is visible: a background tab is checked when it is
 * activated, not continuously.
 */
export function useDiskWatch(params: DiskCheckParams & { enabled: boolean }): void {
  const paramsRef = useRef(params)
  paramsRef.current = params
  const runningRef = useRef(false)

  useEffect(() => {
    if (!params.enabled) return

    const run = async (): Promise<void> => {
      // Never overlap checks for one file; a slow read would otherwise stack up.
      if (runningRef.current) return
      runningRef.current = true
      try {
        await checkDiskState(paramsRef.current)
      } finally {
        runningRef.current = false
      }
    }

    void run()
    const interval = setInterval(() => void run(), DISK_POLL_INTERVAL_MS)
    window.addEventListener('focus', run)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', run)
    }
  }, [params.enabled, params.path])
}
