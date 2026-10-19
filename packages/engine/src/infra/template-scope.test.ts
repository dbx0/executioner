import { describe, expect, it } from 'vitest'
import { buildScope } from './template-scope.js'

describe('buildScope', () => {
  const target = { value: 'example.com', kind: 'domain' as const }

  /** Narrow a record lookup to a present value, failing loudly if it is missing. */
  function must<T>(v: T | undefined): T {
    if (v === undefined) throw new Error('expected a value, got undefined')
    return v
  }

  it('exposes params, target and run_dir', () => {
    const scope = buildScope({
      params: { threads: 40 },
      target,
      runDir: '/e/exec-1',
      nodeOutputs: {},
    })
    expect(scope.params.threads).toBe(40)
    expect(scope.target.value).toBe('example.com')
    expect(scope.run_dir).toBe('/e/exec-1')
  })

  it('exposes a prior node raw output under nodes.<id>.output', () => {
    const scope = buildScope({
      params: {},
      target,
      runDir: '/e',
      nodeOutputs: { subfinder: { output: 'a.com\nb.com\n', rows: [] } },
    })
    expect(must((scope.nodes as Record<string, { output: string }>).subfinder).output).toBe('a.com\nb.com\n')
  })

  it('exposes the first parsed row fields under nodes.<id>.<field>', () => {
    const scope = buildScope({
      params: {},
      target,
      runDir: '/e',
      nodeOutputs: { httpx: { output: '', rows: [{ host: 'a.com', status: 200 }] } },
    })
    const httpx = must((scope.nodes as Record<string, Record<string, unknown>>).httpx)
    expect(httpx.host).toBe('a.com')
    expect(httpx.status).toBe(200)
  })

  it('includes loop variables when a loop context is given', () => {
    const scope = buildScope({
      params: {},
      target,
      runDir: '/e',
      nodeOutputs: {},
      loop: { item: 'a.com', index: 0, count: 3 },
    })
    expect(scope.loop).toEqual({ item: 'a.com', index: 0, count: 3 })
  })

  it('omits loop when no loop context is given', () => {
    const scope = buildScope({ params: {}, target, runDir: '/e', nodeOutputs: {} })
    expect(scope.loop).toBeUndefined()
  })
})
