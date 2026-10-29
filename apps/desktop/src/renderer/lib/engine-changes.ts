import { useEffect, useRef } from 'react'

export type ChangeTopic = 'targets' | 'findings' | 'scope' | 'runs' | 'sessions'

interface Subscriber {
  topics: ReadonlySet<ChangeTopic>
  cb: () => void
  pending: boolean
}

const subscribers = new Set<Subscriber>()

/** Tells every subscriber of `topic` that the underlying data changed. Callbacks
 * are coalesced per subscriber with a microtask, so a burst of emits in one tick
 * triggers a single refetch. */
export function emitChange(topic: ChangeTopic): void {
  for (const sub of subscribers) {
    if (!sub.topics.has(topic) || sub.pending) continue
    sub.pending = true
    queueMicrotask(() => {
      sub.pending = false
      if (subscribers.has(sub)) sub.cb()
    })
  }
}

export function onChange(topics: readonly ChangeTopic[], cb: () => void): () => void {
  const sub: Subscriber = { topics: new Set(topics), cb, pending: false }
  subscribers.add(sub)
  return () => {
    subscribers.delete(sub)
  }
}

/** Runs `cb` whenever one of `topics` changes. The latest `cb` is kept in a ref, so an inline callback does not resubscribe. */
export function useEngineChange(topics: readonly ChangeTopic[], cb: () => void): void {
  const cbRef = useRef(cb)
  useEffect(() => {
    cbRef.current = cb
  })
  const key = topics.join(',')
  useEffect(() => {
    return onChange(key.split(',') as ChangeTopic[], () => cbRef.current())
  }, [key])
}
