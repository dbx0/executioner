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
    const fetchMock = vi.fn(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    installHostBridge({ baseUrl: '', bootstrapToken: 'boot' })
    expect(window.executioner.platform).toBe('linux')
    expect(await window.executioner.checkForUpdate()).toBeNull()
    window.executioner.windowControl('close')
    window.executioner.browser.place({ root: '/', id: 'b', bounds: null })
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/host/browser/place',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('browser.operator POSTs /host/browser/operator with the bootstrap bearer', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    installHostBridge({ baseUrl: '', bootstrapToken: 'boot' })

    await window.executioner.browser.operator({
      root: '/eng',
      id: 'b1',
      op: { navigate: 'https://example.com' },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/host/browser/operator',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          root: '/eng',
          id: 'b1',
          op: { navigate: 'https://example.com' },
        }),
      }),
    )
    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers)
    expect(headers.get('Authorization')).toBe('Bearer boot')
  })

  it('pickFolder POSTs /host/dialogs/folder with the bootstrap bearer', async () => {
    const fetchMock = vi.fn(async () => Response.json({ path: '/tmp/eng' }))
    vi.stubGlobal('fetch', fetchMock)
    installHostBridge({ baseUrl: '', bootstrapToken: 'boot' })

    await expect(window.executioner.pickFolder()).resolves.toBe('/tmp/eng')
    expect(fetchMock).toHaveBeenCalledWith(
      '/host/dialogs/folder',
      expect.objectContaining({ method: 'POST' }),
    )
    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers)
    expect(headers.get('Authorization')).toBe('Bearer boot')
  })

  it('pickFolder maps a null path to undefined (cancel)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ path: null })))
    installHostBridge({ baseUrl: '', bootstrapToken: 'boot' })
    await expect(window.executioner.pickFolder()).resolves.toBeUndefined()
  })

  it('connectionHints GETs /host/connection-hints with the bootstrap bearer', async () => {
    const hints = {
      sshHosts: [{ alias: 'kali', hostname: '10.0.0.5' }],
      sshKeys: ['/home/u/.ssh/id_ed25519'],
      defaultUser: 'u',
      dockerImages: ['ubuntu:22.04'],
    }
    const fetchMock = vi.fn(async () => Response.json(hints))
    vi.stubGlobal('fetch', fetchMock)
    installHostBridge({ baseUrl: '', bootstrapToken: 'boot' })

    await expect(window.executioner.connectionHints()).resolves.toEqual(hints)
    expect(fetchMock).toHaveBeenCalledWith('/host/connection-hints', expect.any(Object))
    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers)
    expect(headers.get('Authorization')).toBe('Bearer boot')
  })

  it('enrollSsh POSTs /host/ssh/enroll with the bootstrap bearer', async () => {
    const enroll = {
      ok: true,
      identityFile: '/home/u/.executioner/ssh/u@h.key',
      steps: [{ name: 'Verify', ok: true }],
    }
    const fetchMock = vi.fn(async () => Response.json(enroll))
    vi.stubGlobal('fetch', fetchMock)
    installHostBridge({ baseUrl: '', bootstrapToken: 'boot' })

    await expect(
      window.executioner.enrollSsh({ host: 'h', user: 'u', password: 'p', port: 2222 }),
    ).resolves.toEqual(enroll)
    expect(fetchMock).toHaveBeenCalledWith(
      '/host/ssh/enroll',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ host: 'h', user: 'u', password: 'p', port: 2222 }),
      }),
    )
    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers)
    expect(headers.get('Authorization')).toBe('Bearer boot')
  })

  it('testBackend POSTs /host/backends/test with profile and createWorkdir', async () => {
    const result = { ok: true, steps: [{ name: 'Connect', ok: true }] }
    const fetchMock = vi.fn(async () => Response.json(result))
    vi.stubGlobal('fetch', fetchMock)
    installHostBridge({ baseUrl: '', bootstrapToken: 'boot' })

    await expect(
      window.executioner.testBackend({
        profile: { name: 'here', kind: 'local' },
        createWorkdir: true,
      }),
    ).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith(
      '/host/backends/test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          profile: { name: 'here', kind: 'local' },
          createWorkdir: true,
        }),
      }),
    )
    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers)
    expect(headers.get('Authorization')).toBe('Bearer boot')
  })

  it('engagement photo methods hit /host/engagement-photo/* with bearer', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/pick')) return Response.json({ dataUrl: 'data:image/png;base64,aaa' })
      if (url.endsWith('/read')) return Response.json({ dataUrl: 'data:image/png;base64,bbb' })
      if (url.endsWith('/write')) return Response.json({ dataUrl: 'data:image/png;base64,ccc' })
      return Response.json({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)
    installHostBridge({ baseUrl: '', bootstrapToken: 'boot' })

    await expect(window.executioner.pickEngagementPhoto()).resolves.toBe('data:image/png;base64,aaa')
    await expect(window.executioner.readEngagementPhoto({ root: '/tmp/eng' })).resolves.toBe(
      'data:image/png;base64,bbb',
    )
    await expect(
      window.executioner.writeEngagementPhoto({ root: '/tmp/eng', dataUrl: 'data:image/png;base64,in' }),
    ).resolves.toBe('data:image/png;base64,ccc')
    window.executioner.clearEngagementPhoto({ root: '/tmp/eng' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))

    const paths = fetchMock.mock.calls.map((c) => c[0])
    expect(paths).toEqual([
      '/host/engagement-photo/pick',
      '/host/engagement-photo/read',
      '/host/engagement-photo/write',
      '/host/engagement-photo/clear',
    ])
    for (const call of fetchMock.mock.calls) {
      const headers = new Headers((call[1] as RequestInit).headers)
      expect(headers.get('Authorization')).toBe('Bearer boot')
    }
  })
})

