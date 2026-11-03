import { describe, expect, it, vi } from 'vitest'
import type { Cdp, CdpJson } from './cdp.js'
import { HostBrowserManager } from './manager.js'
import { BROWSER_DARWIN_REQUIRED } from './types.js'

function fakeCdp(initialUrl = 'about:blank'): {
  cdp: Cdp
  history: { currentIndex: number; entries: { id: number; url: string; title: string }[] }
} {
  const history = {
    currentIndex: 0,
    entries: [{ id: 1, url: initialUrl, title: '' }],
  }
  const listeners = new Map<string, Set<(params: CdpJson, sessionId?: string) => void>>()
  let nextTarget = 1
  let lastNavigated = initialUrl
  const windowIds = new Map<string, number>()

  const cdp: Cdp = {
    async send(method, params, sessionId) {
      switch (method) {
        case 'Target.createTarget': {
          const targetId = `t${nextTarget++}`
          windowIds.set(targetId, 100 + nextTarget)
          return { targetId }
        }
        case 'Target.attachToTarget': {
          const targetId = String((params as { targetId: string }).targetId)
          return { sessionId: `s-${targetId}` }
        }
        case 'Target.closeTarget':
          return { success: true }
        case 'Page.enable':
        case 'Runtime.enable':
        case 'Browser.setWindowBounds':
        case 'Page.reload':
        case 'Page.stopLoading':
          return {}
        case 'Browser.getWindowForTarget': {
          const targetId = String((params as { targetId: string }).targetId)
          return { windowId: windowIds.get(targetId) ?? 1 }
        }
        case 'Page.navigate': {
          const url = String((params as { url: string }).url)
          lastNavigated = url
          history.entries.push({
            id: history.entries.length + 1,
            url,
            title: url.includes('example.com') ? 'Example Domain' : '',
          })
          history.currentIndex = history.entries.length - 1
          queueMicrotask(() => {
            const set = listeners.get('Page.frameNavigated')
            if (set !== undefined) {
              for (const cb of set) cb({ frame: { url } }, sessionId)
            }
            const loaded = listeners.get('Page.loadEventFired')
            if (loaded !== undefined) for (const cb of loaded) cb({}, sessionId)
          })
          return { frameId: 'f1' }
        }
        case 'Runtime.evaluate': {
          const expression = String((params as { expression?: string }).expression ?? '')
          if (expression.includes('location.href')) {
            return {
              result: {
                value: {
                  url: lastNavigated,
                  title: lastNavigated.includes('example.com') ? 'Example Domain' : '',
                  canGoBack: history.currentIndex > 0,
                  canGoForward: false,
                },
              },
            }
          }
          return { result: { value: undefined } }
        }
        default:
          throw new Error(`unexpected CDP ${method}`)
      }
    },
    on(event, cb) {
      let set = listeners.get(event)
      if (set === undefined) {
        set = new Set()
        listeners.set(event, set)
      }
      set.add(cb)
      return () => {
        set!.delete(cb)
      }
    },
    close() {
      listeners.clear()
    },
  }

  return { cdp, history }
}

describe('HostBrowserManager', () => {
  it('returns 501-class error off Darwin', async () => {
    const mgr = new HostBrowserManager({
      platform: 'linux',
      launch: async () => {
        throw new Error('should not launch')
      },
    })
    expect(() => mgr.place('/eng', 'b1', { x: 0, y: 0, width: 100, height: 100 })).toThrow(
      BROWSER_DARWIN_REQUIRED,
    )
    await expect(mgr.operator('/eng', 'b1', { navigate: 'https://example.com' })).rejects.toThrow(
      BROWSER_DARWIN_REQUIRED,
    )
  })

  it('place null does not launch; operator navigate emits state', async () => {
    const fake = fakeCdp()
    const kill = vi.fn(async () => undefined)
    const mgr = new HostBrowserManager({
      platform: 'darwin',
      launch: async () => ({ cdp: fake.cdp, kill }),
    })
    const states: { id: string; url: string; title: string }[] = []
    mgr.subscribe((e) => {
      states.push({ id: e.id, url: e.state.url, title: e.state.title })
    })

    mgr.place('/eng', 'b1', null)
    expect(kill).not.toHaveBeenCalled()
    expect(states).toEqual([])

    await mgr.operator('/eng', 'b1', { navigate: 'https://example.com/' })
    await vi.waitFor(() => {
      expect(states.some((s) => s.url.includes('example.com'))).toBe(true)
    })
    const last = states.at(-1)!
    expect(last.title).toBe('Example Domain')
    expect(last.id).toBe('b1')
  })

  it('close destroys the session; closeAll kills Chromium', async () => {
    const fake = fakeCdp()
    const kill = vi.fn(async () => undefined)
    const mgr = new HostBrowserManager({
      platform: 'darwin',
      launch: async () => ({ cdp: fake.cdp, kill }),
    })
    await mgr.operator('/eng', 'b1', { navigate: 'https://example.com/' })
    mgr.close('/eng', 'b1')
    expect(kill).not.toHaveBeenCalled()
    await mgr.closeAll()
    expect(kill).toHaveBeenCalled()
  })

  it('rejects non-http operator navigate', async () => {
    const fake = fakeCdp()
    const mgr = new HostBrowserManager({
      platform: 'darwin',
      launch: async () => ({ cdp: fake.cdp, kill: async () => undefined }),
    })
    await expect(mgr.operator('/eng', 'b1', { navigate: 'file:///etc/passwd' })).rejects.toThrow(
      /http and https/,
    )
  })
})
