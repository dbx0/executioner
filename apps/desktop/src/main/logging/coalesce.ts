/**
 * Wrap an async job so at most one run is in flight. A call that arrives while
 * one runs asks for exactly one more run after it, however many calls arrive,
 * so the last call always sees a run that started after it and an earlier,
 * slower run can never finish last.
 */
export function coalesced(run: () => Promise<void>): () => Promise<void> {
  let current: Promise<void> | undefined
  let again = false
  const start = (): Promise<void> => {
    current = run()
      .catch(() => {
        /* the job reports its own failures */
      })
      .finally(() => {
        current = undefined
        if (again) {
          again = false
          void start()
        }
      })
    return current
  }
  return () => {
    if (current !== undefined) {
      again = true
      return current
    }
    return start()
  }
}
