import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stagger, useCountUp, useNewIds } from './motion.js'

describe('motion', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('stagger computes the delay', () => {
    expect(stagger(3)).toEqual({ animationDelay: '240ms' })
    expect(stagger(2, 50, 100)).toEqual({ animationDelay: '200ms' })
  })

  it('useCountUp reaches the target', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const { result } = renderHook(() => useCountUp(42, 1000))
    expect(result.current).toBe(0)
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(result.current).toBe(42)
  })

  it('useCountUp still counts up under StrictMode', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const { result } = renderHook(() => useCountUp(42, 1000), { wrapper: StrictMode })
    expect(result.current).toBe(0)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current).toBeGreaterThan(0)
    expect(result.current).toBeLessThan(42)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current).toBe(42)
  })

  it('useCountUp returns the target at once under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { result } = renderHook(() => useCountUp(42))
    expect(result.current).toBe(42)
  })

  it('useNewIds returns empty for the first load', () => {
    const { result } = renderHook(() => useNewIds(['a', 'b'], 'e1'))
    expect(result.current.size).toBe(0)
  })

  it('useNewIds returns only unseen ids on later loads', () => {
    const { result, rerender } = renderHook(({ ids }) => useNewIds(ids, 'e1'), {
      initialProps: { ids: ['a', 'b'] },
    })
    rerender({ ids: ['a', 'b', 'c'] })
    expect([...result.current]).toEqual(['c'])
    const stable = result.current
    rerender({ ids: ['a', 'b', 'c'] })
    expect(result.current).toBe(stable)
  })

  it('useNewIds resets when resetKey changes', () => {
    const { result, rerender } = renderHook(({ ids, key }) => useNewIds(ids, key), {
      initialProps: { ids: ['a'], key: 'e1' },
    })
    rerender({ ids: ['a', 'b'], key: 'e1' })
    expect([...result.current]).toEqual(['b'])
    rerender({ ids: ['x', 'y'], key: 'e2' })
    expect(result.current.size).toBe(0)
  })
})
