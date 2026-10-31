import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
})
