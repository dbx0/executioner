import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearViewState,
  editorSelectionCache,
  scrollTopCache,
  setWithLRU,
} from './view-state-cache.js'

describe('setWithLRU', () => {
  it('evicts the oldest entry past the cap', () => {
    const map = new Map<string, number>()
    setWithLRU(map, 'a', 1, 2)
    setWithLRU(map, 'b', 2, 2)
    setWithLRU(map, 'c', 3, 2)
    expect(map.has('a')).toBe(false)
    expect([...map.keys()]).toEqual(['b', 'c'])
  })

  it('refreshes recency on re-set, so the refreshed key is not the one evicted', () => {
    const map = new Map<string, number>()
    setWithLRU(map, 'a', 1, 2)
    setWithLRU(map, 'b', 2, 2)
    setWithLRU(map, 'a', 9, 2)
    setWithLRU(map, 'c', 3, 2)
    expect(map.has('a')).toBe(true)
    expect(map.has('b')).toBe(false)
    expect(map.get('a')).toBe(9)
  })

  it('evicts correctly for a map whose key can legitimately be undefined', () => {
    const map = new Map<string | undefined, number>()
    setWithLRU(map, undefined, 1, 1)
    setWithLRU(map, 'b', 2, 1)
    expect(map.size).toBe(1)
    expect(map.has('b')).toBe(true)
  })
})

describe('clearViewState', () => {
  beforeEach(() => {
    scrollTopCache.clear()
    editorSelectionCache.clear()
  })

  it('drops both caches for one key', () => {
    scrollTopCache.set('f1', 100)
    editorSelectionCache.set('f1', [])
    clearViewState('f1')
    expect(scrollTopCache.has('f1')).toBe(false)
    expect(editorSelectionCache.has('f1')).toBe(false)
  })

  it('leaves other keys alone', () => {
    scrollTopCache.set('f1', 100)
    scrollTopCache.set('f2', 200)
    clearViewState('f1')
    expect(scrollTopCache.get('f2')).toBe(200)
  })
})
