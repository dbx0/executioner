import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { BrowserRegistry, type BrowserEventName } from './registry.js'
import type { BrowserHostHub } from './host-hub.js'
import { BrowserTools } from './tools.js'

let dir: string
let project: Project
let events: Array<{ event: BrowserEventName; active?: unknown }>
let registry: BrowserRegistry
let call: ReturnType<typeof vi.fn>
let tools: BrowserTools

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-browser-tools-'))
  project = createProject(dir, { name: 'test' })
  events = []
  registry = new BrowserRegistry((event, _item, extra) => events.push({ event, active: extra?.active }))
  call = vi.fn().mockResolvedValue({ url: 'https://a.test/', title: 'A', snapshot: 'x' })
  tools = new BrowserTools({ registry, hub: { call } as unknown as BrowserHostHub, project })
})

afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('BrowserTools', () => {
  it('refuses a caller without a session', async () => {
    await expect(tools.call('browser_snapshot', {}, {})).rejects.toThrow('Browser tools need an agent session.')
  })

  it('a session with no browser gets a new one on any browser tool', async () => {
    await tools.call('browser_snapshot', {}, { sessionId: 's1' })
    const owned = registry.list().filter((b) => b.owner === 's1')
    expect(owned).toHaveLength(1)
    expect(call).toHaveBeenCalledWith(owned[0]!.id, 'snapshot', {})
  })

  it("reuses the session's browser", async () => {
    await tools.call('browser_snapshot', {}, { sessionId: 's1' })
    await tools.call('browser_snapshot', {}, { sessionId: 's1' })
    expect(registry.list()).toHaveLength(1)
    expect(call.mock.calls[0]![0]).toBe(call.mock.calls[1]![0])
  })

  it('never drives a browser owned by another session', async () => {
    const other = registry.create({ owner: 's2' })
    await tools.call('browser_snapshot', {}, { sessionId: 's1' })
    expect(call.mock.calls[0]![0]).not.toBe(other.id)
  })

  it('after hand-off the previous owner gets a fresh browser', async () => {
    await tools.call('browser_snapshot', {}, { sessionId: 's1' })
    const first = registry.ownedBy('s1')!
    registry.setOwner(first.id, 's2')
    await tools.call('browser_snapshot', {}, { sessionId: 's1' })
    const second = registry.ownedBy('s1')!
    expect(second.id).not.toBe(first.id)
    expect(call.mock.calls[1]![0]).toBe(second.id)
  })

  it('navigate reports scope status without blocking', async () => {
    project.scopeRules.add({ effect: 'exclude', pattern: 'evil.test', source: 'manual' })
    call.mockResolvedValue({ url: 'https://evil.test/', title: '' })
    const result = (await tools.call('browser_navigate', { url: 'https://evil.test/' }, { sessionId: 's1' })) as {
      scopeStatus?: string
    }
    expect(result.scopeStatus).toBe('out')
    expect(call).toHaveBeenCalled()
  })

  it('marks activity around the call', async () => {
    call.mockRejectedValue(new Error('boom'))
    await expect(tools.call('browser_snapshot', {}, { sessionId: 's1' })).rejects.toThrow('boom')
    const activity = events.filter((e) => e.event === 'activity').map((e) => e.active)
    expect(activity).toEqual([true, false])
  })

  it('screenshot writes a png under evidence/browser and returns its path', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    call.mockResolvedValue({ data: png.toString('base64') })
    const out = (await tools.call('browser_screenshot', {}, { sessionId: 's1' })) as {
      __mcpImage: { data: string; mimeType: string }
      result: { path: string }
    }
    expect(out.__mcpImage).toEqual({ data: png.toString('base64'), mimeType: 'image/png' })
    expect(out.result.path).toContain(join('evidence', 'browser'))
    expect(existsSync(out.result.path)).toBe(true)
    expect(readFileSync(out.result.path).equals(png)).toBe(true)
  })

  it('screenshot fails when the browser returns no image', async () => {
    call.mockResolvedValue({})
    await expect(tools.call('browser_screenshot', {}, { sessionId: 's1' })).rejects.toThrow('The browser returned no screenshot.')
  })

  it('forwards network with its filters', async () => {
    call.mockResolvedValue({ entries: [{ requestId: '1' }], next: 7 })
    const out = await tools.call('browser_network', { since: 3, urlContains: '/api', limit: 20 }, { sessionId: 's1' })
    expect(call).toHaveBeenCalledWith(registry.ownedBy('s1')!.id, 'network', { since: 3, urlContains: '/api', limit: 20 })
    expect(out).toEqual({ entries: [{ requestId: '1' }], next: 7 })
  })

  it('upload resolves relative paths against the engagement root', async () => {
    writeFileSync(join(project.root, 'a.txt'), 'x')
    await tools.call('browser_upload', { ref: 'e1', paths: ['a.txt'] }, { sessionId: 's1' })
    expect(call).toHaveBeenCalledWith(registry.ownedBy('s1')!.id, 'upload', {
      ref: 'e1',
      paths: [resolve(project.root, 'a.txt')],
    })
  })

  it('upload fails for a missing file without calling the browser', async () => {
    await expect(tools.call('browser_upload', { ref: 'e1', paths: ['nope.txt'] }, { sessionId: 's1' })).rejects.toThrow(
      `No such file: ${resolve(project.root, 'nope.txt')}`,
    )
    expect(call).not.toHaveBeenCalled()
  })

  it('rewrite rules are validated', async () => {
    await expect(tools.call('browser_rewrite_rules', { rules: [{ status: 200 }] }, { sessionId: 's1' })).rejects.toThrow()
    expect(call).not.toHaveBeenCalled()
    call.mockResolvedValue({ rules: [] })
    await expect(tools.call('browser_rewrite_rules', { rules: [] }, { sessionId: 's1' })).resolves.toEqual({ rules: [] })
  })

  it('drag refuses more than 200 steps', async () => {
    await expect(
      tools.call('browser_drag', { from: { x: 0, y: 0 }, to: { x: 9, y: 9 }, steps: 201 }, { sessionId: 's1' }),
    ).rejects.toThrow()
    expect(call).not.toHaveBeenCalled()
  })

  it('eval forwards the frame to the browser', async () => {
    call.mockResolvedValueOnce({ value: 'in frame' })
    const out = await tools.call('browser_eval', { expression: 'location.href', frame: 'f2' }, { sessionId: 's1' })
    expect(call.mock.calls[0]![1]).toBe('eval')
    expect(call.mock.calls[0]![2]).toEqual({ expression: 'location.href', frame: 'f2' })
    expect(out).toEqual({ value: 'in frame' })
  })

  it('response_body forwards paging and returns the window it got', async () => {
    call.mockResolvedValueOnce({ body: 'abc', base64Encoded: false, truncated: true, totalBytes: 603_000, offset: 150_000, nextOffset: 150_003 })
    const out = await tools.call('browser_response_body', { requestId: 'N1', offset: 150_000, maxBytes: 3 }, { sessionId: 's1' })
    expect(call.mock.calls[0]![2]).toEqual({ requestId: 'N1', offset: 150_000, maxBytes: 3 })
    expect(out).toEqual({ body: 'abc', base64Encoded: false, truncated: true, totalBytes: 603_000, offset: 150_000, nextOffset: 150_003 })
  })

  it('response_body refuses more than 1 000 000 bytes and a negative offset', async () => {
    await expect(tools.call('browser_response_body', { requestId: 'N1', maxBytes: 1_000_001 }, { sessionId: 's1' })).rejects.toThrow()
    await expect(tools.call('browser_response_body', { requestId: 'N1', offset: -1 }, { sessionId: 's1' })).rejects.toThrow()
    expect(call).not.toHaveBeenCalled()
  })

  it('emulate accepts userAgentMetadata and null clears it', async () => {
    const meta = { platform: 'Windows', platformVersion: '15.0.0', architecture: 'x86', model: '', mobile: false, brands: [{ brand: 'Chromium', version: '146' }] }
    await tools.call('browser_emulate', { userAgent: 'UA', userAgentMetadata: meta }, { sessionId: 's1' })
    expect(call.mock.calls[0]![2]).toEqual({ userAgent: 'UA', userAgentMetadata: meta })
    await tools.call('browser_emulate', { userAgentMetadata: null }, { sessionId: 's1' })
    expect(call.mock.calls[1]![2]).toEqual({ userAgentMetadata: null })
    await expect(tools.call('browser_emulate', { userAgentMetadata: { platform: 'Windows' } }, { sessionId: 's1' })).rejects.toThrow()
  })

  describe('ask_operator', () => {
    let asked: Array<{ event: BrowserEventName; extra?: Record<string, unknown> | undefined }>
    beforeEach(() => {
      asked = []
      registry = new BrowserRegistry((event, _item, extra) => asked.push({ event, extra }))
      tools = new BrowserTools({ registry, hub: { call } as unknown as BrowserHostHub, project })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('waits for the operator and returns their reply without calling the browser', async () => {
      const out = tools.call('browser_ask_operator', { message: 'solve the captcha' }, { sessionId: 's1' })
      let settled = false
      void out.then(() => (settled = true))
      await Promise.resolve()
      await Promise.resolve()
      expect(settled).toBe(false)
      expect(asked.find((e) => e.event === 'ask')?.extra).toEqual({ message: 'solve the captcha' })
      const id = registry.ownedBy('s1')!.id
      expect(registry.answer(id, '424242')).toBe(true)
      await expect(out).resolves.toEqual({ answered: true, reply: '424242' })
      expect(call).not.toHaveBeenCalled()
    })

    it('does not mark the page as in use while it waits', async () => {
      const out = tools.call('browser_ask_operator', { message: 'm' }, { sessionId: 's1' })
      await Promise.resolve()
      const activity = asked.filter((e) => e.event === 'activity').map((e) => e.extra?.active)
      expect(activity.at(-1) ?? false).toBe(false)
      registry.answer(registry.ownedBy('s1')!.id)
      await out
    })

    it('times out leaving the ask pending, and a second call joins without notifying again', async () => {
      vi.useFakeTimers()
      const first = tools.call('browser_ask_operator', { message: 'm', timeoutSec: 5 }, { sessionId: 's1' })
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(first).resolves.toEqual({ answered: false, pending: true, reason: 'timeout' })
      const id = registry.ownedBy('s1')!.id
      expect(registry.get(id)?.ask?.message).toBe('m')
      const second = tools.call('browser_ask_operator', { message: 'm', timeoutSec: 5 }, { sessionId: 's1' })
      await vi.advanceTimersByTimeAsync(1_000)
      expect(asked.filter((e) => e.event === 'ask')).toHaveLength(1)
      registry.answer(id, 'done')
      await expect(second).resolves.toEqual({ answered: true, reply: 'done' })
    })

    it('reports closed when the browser goes away', async () => {
      const out = tools.call('browser_ask_operator', { message: 'm' }, { sessionId: 's1' })
      await Promise.resolve()
      registry.remove(registry.ownedBy('s1')!.id)
      await expect(out).resolves.toEqual({ answered: false, reason: 'closed' })
    })

    it('returns before an agent CLI gives up: 45 seconds by default, capped at 50', async () => {
      vi.useFakeTimers()
      const byDefault = tools.call('browser_ask_operator', { message: 'm' }, { sessionId: 's1' })
      await vi.advanceTimersByTimeAsync(45_000)
      await expect(byDefault).resolves.toMatchObject({ answered: false, pending: true })
      const capped = tools.call('browser_ask_operator', { message: 'm', timeoutSec: 1800 }, { sessionId: 's1' })
      await vi.advanceTimersByTimeAsync(50_000)
      await expect(capped).resolves.toMatchObject({ answered: false, pending: true })
    })

    it('keeps a reply given after the caller hung up and returns it on the next call', async () => {
      const hangup = new AbortController()
      const first = tools.call('browser_ask_operator', { message: 'mfa' }, { sessionId: 's1', signal: hangup.signal })
      await Promise.resolve()
      hangup.abort()
      await first
      const id = registry.ownedBy('s1')!.id
      expect(registry.answer(id, '4242')).toBe(true)
      await expect(tools.call('browser_ask_operator', { message: 'mfa' }, { sessionId: 's1' })).resolves.toEqual({
        answered: true,
        reply: '4242',
      })
      expect(asked.filter((e) => e.event === 'ask')).toHaveLength(1)
    })

    it('keeps a reply given between two timed out calls', async () => {
      vi.useFakeTimers()
      const first = tools.call('browser_ask_operator', { message: 'm', timeoutSec: 5 }, { sessionId: 's1' })
      await vi.advanceTimersByTimeAsync(5_000)
      await first
      registry.answer(registry.ownedBy('s1')!.id, '4242')
      await expect(tools.call('browser_ask_operator', { message: 'm' }, { sessionId: 's1' })).resolves.toEqual({
        answered: true,
        reply: '4242',
      })
    })
  })
})
