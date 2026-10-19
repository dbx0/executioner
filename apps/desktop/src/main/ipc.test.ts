import { describe, expect, it, vi } from 'vitest'
import { createIpcHandlers } from './ipc.js'

const connection = { port: 5000, token: 't'.repeat(40), projectRoot: '/tmp/acme' }

describe('createIpcHandlers', () => {
  it('openProject starts the supervisor and returns the connection', async () => {
    const supervisor = { start: vi.fn(async () => connection), stop: vi.fn(), current: vi.fn(() => undefined) }
    const handlers = createIpcHandlers({
      supervisor: supervisor as never,
      pickFolder: async () => '/tmp/acme',
      initProject: vi.fn(async () => {}),
      probeAgent: vi.fn(async () => true),
      runEngineJson: vi.fn(async () => ({})),
      sshKeyDir: () => '/tmp/acme/ssh',
      connectionHints: async () => ({ sshHosts: [], sshKeys: [], defaultUser: 'u', dockerImages: [] }),
      pickImage: async () => undefined,
      encodeImage: () => null,
    })

    const result = await handlers.openProject({ dir: '/tmp/acme', create: false })
    expect(result).toEqual(connection)
    expect(supervisor.start).toHaveBeenCalledWith('/tmp/acme')
  })

  it('openProject with create true inits before serving', async () => {
    const supervisor = { start: vi.fn(async () => connection), stop: vi.fn(), current: vi.fn(() => undefined) }
    const initProject = vi.fn(async () => {})
    const handlers = createIpcHandlers({
      supervisor: supervisor as never,
      pickFolder: async () => '/tmp/acme',
      initProject,
      probeAgent: vi.fn(async () => true),
      runEngineJson: vi.fn(async () => ({})),
      sshKeyDir: () => '/tmp/acme/ssh',
      connectionHints: async () => ({ sshHosts: [], sshKeys: [], defaultUser: 'u', dockerImages: [] }),
      pickImage: async () => undefined,
      encodeImage: () => null,
    })

    const order: string[] = []
    initProject.mockImplementation(async () => { order.push('init') })
    supervisor.start.mockImplementation(async () => { order.push('start'); return connection })
    await handlers.openProject({ dir: '/tmp/acme', create: true, name: 'acme' })
    expect(order).toEqual(['init', 'start'])
  })

  it('threads name, icon, description and scope through to initProject on create', async () => {
    const supervisor = { start: vi.fn(async () => connection), stop: vi.fn(), current: vi.fn(() => undefined) }
    const initProject = vi.fn(async () => {})
    const handlers = createIpcHandlers({
      supervisor: supervisor as never,
      pickFolder: async () => '/tmp/acme',
      initProject,
      probeAgent: vi.fn(async () => true),
      runEngineJson: vi.fn(async () => ({})),
      sshKeyDir: () => '/tmp/acme/ssh',
      connectionHints: async () => ({ sshHosts: [], sshKeys: [], defaultUser: 'u', dockerImages: [] }),
      pickImage: async () => undefined,
      encodeImage: () => null,
    })
    await handlers.openProject({
      dir: '/tmp/acme',
      create: true,
      name: 'acme',
      icon: '🎯',
      description: 'test the api',
      scope: '*.example.com',
    })
    expect(initProject).toHaveBeenCalledWith('/tmp/acme', {
      name: 'acme',
      icon: '🎯',
      description: 'test the api',
      scope: '*.example.com',
    })
  })

  it('opens a second project without disturbing the first engagement\'s engine', async () => {
    const supervisor = { start: vi.fn(async () => connection), stop: vi.fn(), current: vi.fn(() => undefined) }
    const handlers = createIpcHandlers({
      supervisor: supervisor as never,
      pickFolder: async () => '/tmp/acme',
      initProject: vi.fn(async () => {}),
      probeAgent: vi.fn(async () => true),
      runEngineJson: vi.fn(async () => ({})),
      sshKeyDir: () => '/tmp/acme/ssh',
      connectionHints: async () => ({ sshHosts: [], sshKeys: [], defaultUser: 'u', dockerImages: [] }),
      pickImage: async () => undefined,
      encodeImage: () => null,
    })
    await handlers.openProject({ dir: '/tmp/a', create: false })
    await handlers.openProject({ dir: '/tmp/b', create: false })
    // Engagements are concurrent tabs: each gets its own engine, and opening the
    // second must not stop the first — that would kill its in-flight runs and
    // leave its tab pointing at a dead port.
    expect(supervisor.start).toHaveBeenNthCalledWith(1, '/tmp/a')
    expect(supervisor.start).toHaveBeenNthCalledWith(2, '/tmp/b')
    expect(supervisor.stop).not.toHaveBeenCalled()
  })

  it('pickFolder returns the chosen path', async () => {
    const handlers = createIpcHandlers({
      supervisor: { start: vi.fn(), stop: vi.fn() } as never,
      pickFolder: async () => '/chosen',
      initProject: vi.fn(),
      probeAgent: vi.fn(async () => true),
      runEngineJson: vi.fn(async () => ({})),
      sshKeyDir: () => '/tmp/acme/ssh',
      connectionHints: async () => ({ sshHosts: [], sshKeys: [], defaultUser: 'u', dockerImages: [] }),
      pickImage: async () => undefined,
      encodeImage: () => null,
    })
    expect(await handlers.pickFolder()).toBe('/chosen')
  })

  it('checkAgents probes each known agent and reports availability', async () => {
    const probeAgent = vi.fn(async (binary: string) => binary === 'claude')
    const handlers = createIpcHandlers({
      supervisor: { start: vi.fn(), stop: vi.fn() } as never,
      pickFolder: async () => undefined,
      initProject: vi.fn(),
      probeAgent,
      runEngineJson: vi.fn(async () => ({})),
      sshKeyDir: () => '/tmp/acme/ssh',
      connectionHints: async () => ({ sshHosts: [], sshKeys: [], defaultUser: 'u', dockerImages: [] }),
      pickImage: async () => undefined,
      encodeImage: () => null,
    })
    const rows = await handlers.checkAgents()
    expect(rows.find((r) => r.id === 'claude')?.installed).toBe(true)
    expect(rows.find((r) => r.id === 'codex')?.installed).toBe(false)
    // Cursor's binary differs from its id.
    expect(probeAgent).toHaveBeenCalledWith('cursor-agent')
  })
})

describe('openProject reuses a live engine', () => {
  const deps = (supervisor: unknown) => ({
    supervisor: supervisor as never,
    pickFolder: async () => '/tmp/acme',
    initProject: vi.fn(async () => {}),
    probeAgent: vi.fn(async () => true),
    runEngineJson: vi.fn(async () => ({})),
    sshKeyDir: () => '/tmp/acme/ssh',
    connectionHints: async () => ({ sshHosts: [], sshKeys: [], defaultUser: 'u', dockerImages: [] }),
    pickImage: async () => undefined,
    encodeImage: () => null,
  })

  it('does not restart the engine when the same project is reopened', async () => {
    // The renderer calls openProject on every reload; restarting here would kill
    // whatever the running engine was executing.
    const supervisor = {
      start: vi.fn(async () => connection),
      stop: vi.fn(),
      current: vi.fn(() => connection),
    }
    const handlers = createIpcHandlers(deps(supervisor))

    const result = await handlers.openProject({ dir: '/tmp/acme', create: false })

    expect(result).toEqual(connection)
    expect(supervisor.stop).not.toHaveBeenCalled()
    expect(supervisor.start).not.toHaveBeenCalled()
  })

  it('starts an engine when nothing is serving that project yet', async () => {
    const supervisor = {
      start: vi.fn(async () => connection),
      stop: vi.fn(),
      current: vi.fn(() => undefined),
    }
    const handlers = createIpcHandlers(deps(supervisor))

    await handlers.openProject({ dir: '/tmp/acme', create: false })
    expect(supervisor.start).toHaveBeenCalledWith('/tmp/acme')
  })

  it('starts a second engine for a different project, stopping nothing', async () => {
    const supervisor = {
      start: vi.fn(async () => connection),
      stop: vi.fn(),
      // Nothing live for the requested dir, even though another engine runs.
      current: vi.fn(() => undefined),
    }
    const handlers = createIpcHandlers(deps(supervisor))

    await handlers.openProject({ dir: '/tmp/other', create: false })
    expect(supervisor.stop).not.toHaveBeenCalled()
    expect(supervisor.start).toHaveBeenCalledWith('/tmp/other')
  })

  it('always starts a fresh engine for a newly created project', async () => {
    const supervisor = {
      start: vi.fn(async () => connection),
      stop: vi.fn(),
      current: vi.fn(() => connection),
    }
    const handlers = createIpcHandlers(deps(supervisor))

    await handlers.openProject({ dir: '/tmp/acme', create: true, name: 'acme' })
    expect(supervisor.start).toHaveBeenCalled()
  })
})

describe('closeProject', () => {
  it('stops only the engine of the engagement being closed', () => {
    const supervisor = { start: vi.fn(), stop: vi.fn(), current: vi.fn(() => undefined) }
    const handlers = createIpcHandlers({
      supervisor: supervisor as never,
      pickFolder: async () => '/tmp/acme',
      initProject: vi.fn(async () => {}),
      probeAgent: vi.fn(async () => true),
      runEngineJson: vi.fn(async () => ({})),
      sshKeyDir: () => '/tmp/acme/ssh',
      connectionHints: async () => ({ sshHosts: [], sshKeys: [], defaultUser: 'u', dockerImages: [] }),
      pickImage: async () => undefined,
      encodeImage: () => null,
    })

    handlers.closeProject({ dir: '/tmp/a' })
    expect(supervisor.stop).toHaveBeenCalledWith('/tmp/a')
    expect(supervisor.stop).toHaveBeenCalledTimes(1)
  })
})
