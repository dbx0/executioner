import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

const EMPTY: ReadonlySet<string> = new Set<string>()

/** Animation delay for the index-th item of a staggered entrance. */
export function stagger(index: number, stepMs = 80, baseMs = 0): CSSProperties {
  return { animationDelay: `${baseMs + index * stepMs}ms` }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Counts from 0 to `target` the first time `target` is non-zero after mount.
 * Later changes jump straight to the new value.
 */
export function useCountUp(target: number, durationMs = 1400, delayMs = 0): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0))
  const played = useRef(false)

  useEffect(() => {
    if (prefersReducedMotion() || played.current || target === 0) {
      setValue(target)
      return undefined
    }
    let frame = 0
    let start: number | null = null
    const step = (now: number): void => {
      if (start === null) start = now
      // Marked once a frame runs, not when the effect does: StrictMode's
      // mount, unmount, mount would otherwise skip the only count-up.
      played.current = true
      const t = Math.min(1, (now - start) / durationMs)
      setValue(Math.round(target * (1 - (1 - t) * (1 - t))))
      if (t < 1) frame = requestAnimationFrame(step)
    }
    const timer = setTimeout(() => {
      frame = requestAnimationFrame(step)
    }, delayMs)
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
    }
  }, [target, durationMs, delayMs])

  return Math.round(value)
}

interface NewIdsState {
  resetKey: unknown
  seen: ReadonlySet<string> | null
  key: string
  result: ReadonlySet<string>
}

/**
 * Ids that appeared since the previous load. The first non-empty load for a
 * resetKey is the baseline and yields an empty set. Seen ids accumulate, so an
 * id that disappears and returns is not new again. The returned set keeps its
 * reference while the ids are unchanged.
 */
export function useNewIds(ids: readonly string[], resetKey: unknown): ReadonlySet<string> {
  const [state, setState] = useState<NewIdsState>({ resetKey, seen: null, key: '', result: EMPTY })
  const key = ids.join('\0')
  const reset = !Object.is(state.resetKey, resetKey)
  if (reset || key !== state.key) {
    const base = reset ? { seen: null, result: EMPTY } : state
    const prev = base.seen
    let seen = prev
    let result: ReadonlySet<string> = EMPTY
    if (ids.length > 0) {
      if (prev === null) {
        seen = new Set(ids)
      } else {
        const fresh = new Set(ids.filter((id) => !prev.has(id)))
        seen = new Set([...prev, ...ids])
        if (fresh.size > 0) result = fresh
      }
    }
    setState({ resetKey, seen, key, result })
    return result
  }
  return state.result
}
