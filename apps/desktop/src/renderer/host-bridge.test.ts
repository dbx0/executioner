import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOST_TOKEN_KEY, installHostBridge, resolveHostBridgeConfig } from './host-bridge.js'

describe('resolveHostBridgeConfig', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    window.history.replaceState({}, '', '/')
    vi.stubGlobal('prompt', vi.fn(() => null))
  })

  afterEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('captures ?token= into storage and strips it from the URL', () => {
    window.history.replaceState({}, '', '/?token=abc123&x=1')
    const config = resolveHostBridgeConfig()
    expect(config.bootstrapToken).toBe('abc123')
    expect(sessionStorage.getItem(HOST_TOKEN_KEY)).toBe('abc123')
    expect(localStorage.getItem(HOST_TOKEN_KEY)).toBe('abc123')
    expect(window.location.search).toBe('?x=1')
  })

  it('reuses a token already in sessionStorage', () => {
    sessionStorage.setItem(HOST_TOKEN_KEY, 'saved')
    expect(resolveHostBridgeConfig().bootstrapToken).toBe('saved')
  })

  it('falls back to localStorage when sessionStorage is empty', () => {
    localStorage.setItem(HOST_TOKEN_KEY, 'from-local')
    expect(resolveHostBridgeConfig().bootstrapToken).toBe('from-local')
  })

  it('prompts once when no token is stored', () => {
    const prompt = vi.fn(() => ' pasted-token ')
    vi.stubGlobal('prompt', prompt)
    expect(resolveHostBridgeConfig().bootstrapToken).toBe('pasted-token')
    expect(localStorage.getItem(HOST_TOKEN_KEY)).toBe('pasted-token')
    expect(prompt).toHaveBeenCalledOnce()
  })
})

describe('installHostBridge', () => {
  afterEach(() => {
    // @ts-expect-error clear for isolation
    delete window.executioner
    vi.unstubAllGlobals()
  })

  it('openProject POSTs /host/engagements/open with the bootstrap bearer', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        port: 9,
        token: 'engine',
        projectRoot: '/tmp/eng',
        endpoint: { host: '127.0.0.1', port: 9 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    installHostBridge({ baseUrl: '', bootstrapToken: 'boot' })

    const connection = await window.executioner.openProject({
      dir: '/tmp/eng',
      create: false,
      name: 'eng',
    })

    expect(connection).toEqual({ port: 9, token: 'engine', projectRoot: '/tmp/eng' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/host/engagements/open',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ dir: '/tmp/eng', create: false, name: 'eng' }),
      }),
    )
    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers)
    expect(headers.get('Authorization')).toBe('Bearer boot')
  })

  it('checkAgents GETs /host/agents with the bootstrap bearer', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        agents: [
          { id: 'claude', installed: true },
          { id: 'codex', installed: true },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    installHostBridge({ baseUrl: '', bootstrapToken: 'boot' })

    await expect(window.executioner.checkAgents()).resolves.toEqual([
      { id: 'claude', installed: true },
      { id: 'codex', installed: true },
    ])
    expect(fetchMock).toHaveBeenCalledWith('/host/agents', expect.any(Object))
    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers)
    expect(headers.get('Authorization')).toBe('Bearer boot')
  })

  it('stubs Electron-only chrome so Landing can mount', async () => {
    installHostBridge({ baseUrl: '', bootstrapToken: '' })
    expect(window.executioner.platform).toBe('linux')
    expect(await window.executioner.connectionHints()).toEqual({
      sshHosts: [],
      sshKeys: [],
      defaultUser: '',
      dockerImages: [],
    })
    expect(await window.executioner.checkForUpdate()).toBeNull()
    window.executioner.windowControl('close')
    window.executioner.browser.place({ root: '/', id: 'b', bounds: null })
  })
})

