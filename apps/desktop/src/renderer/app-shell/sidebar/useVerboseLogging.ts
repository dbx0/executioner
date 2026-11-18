import { useEffect, useState } from 'react'

/** Whether verbose (debug) logging is on, following changes made in Settings. */
export function useVerboseLogging(): boolean {
  const [verbose, setVerbose] = useState(false)
  useEffect(() => {
    // Absent in tests and older preloads.
    const log = (window.executioner as Partial<Window['executioner']> | undefined)?.log
    if (log?.getVerbose === undefined) return
    let live = true
    log
      .getVerbose()
      .then((v) => {
        if (live) setVerbose(v)
      })
      .catch(() => {})
    const off = log.onLevel((l) => setVerbose(l === 'debug'))
    return () => {
      live = false
      off()
    }
  }, [])
  return verbose
}
