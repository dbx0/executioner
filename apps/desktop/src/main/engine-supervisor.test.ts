import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { EngineSupervisor } from './engine-supervisor.js'

// A fake child process that lets the test push stdout lines.
class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed = false
  // The supervisor reads exitCode to tell a live engine from a dead one.
  exitCode: number | null = null
  kill(): boolean {
    this.killed = true
    this.exitCode = 0
    this.emit('close', 0)
    return true
  }
}

const HANDSHAKE = 'EXECUTIONER_READY ' + JSON.stringify({
  port: 4599,
  token: 'a'.repeat(40),
  pid: 1234,
  projectRoot: '/tmp/acme',
  version: '0.0.1',
})

describe('EngineSupervisor', () => {
  it('spawns the engine and resolves with the handshake connection', async () => {
    const child = new FakeChild()
    const spawnFn = vi.fn(() => child as never)
    // The supervisor polls /health; stub fetch to succeed.
    const fetchFn = vi.fn(async () => ({ ok: true }) as Response)

    const supervisor = new EngineSupervisor({ enginePath: '/engine.js', spawnFn, fetchFn })
    const startPromise = supervisor.start('/tmp/acme')

    // Emit the handshake on the next tick.
    queueMicrotask(() => child.stdout.emit('data', Buffer.from(HANDSHAKE + '\n')))

    const connection = await startPromise
    expect(connection.port).toBe(4599)
    expect(connection.token).toHaveLength(40)
    expect(spawnFn).toHaveBeenCalledWith(
      process.execPath,
      ['--enable-experimental-regexp-engine', '/engine.js', 'serve', '/tmp/acme'],
      expect.anything(),
    )
  })

  it('passes spawnEnv through to the child process', async () => {
    const child = new FakeChild()
    const spawnFn = vi.fn(() => child as never)
    const supervisor = new EngineSupervisor({
      enginePath: '/engine.js',
      spawnEnv: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      spawnFn,
      fetchFn: async () => ({ ok: true }) as Response,
    })
    const startPromise = supervisor.start('/tmp/acme')
    queueMicrotask(() => child.stdout.emit('data', Buffer.from(HANDSHAKE + '\n')))
    await startPromise
    expect(spawnFn).toHaveBeenCalledWith(
      process.execPath,
      ['--enable-experimental-regexp-engine', '/engine.js', 'serve', '/tmp/acme'],
      expect.objectContaining({ env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }) }),
    )
  })

  it('ignores non-handshake stdout noise before the handshake', async () => {
    const child = new FakeChild()
    const supervisor = new EngineSupervisor({
      enginePath: '/engine.js',
      spawnFn: () => child as never,
      fetchFn: async () => ({ ok: true }) as Response,
    })
    const startPromise = supervisor.start('/tmp/acme')
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('booting...\nloading manifests\n'))
      child.stdout.emit('data', Buffer.from(HANDSHAKE + '\n'))
    })
    const connection = await startPromise
    expect(connection.port).toBe(4599)
  })

  it('rejects if the engine exits before handshaking', async () => {
    const child = new FakeChild()
    const supervisor = new EngineSupervisor({
      enginePath: '/engine.js',
      spawnFn: () => child as never,
      fetchFn: async () => ({ ok: true }) as Response,
    })
    const startPromise = supervisor.start('/tmp/acme')
    queueMicrotask(() => child.emit('close', 1))
    await expect(startPromise).rejects.toThrow(/engine exited/)
  })

  it('stop(dir) kills that project\'s child', async () => {
    const child = new FakeChild()
    const supervisor = new EngineSupervisor({
      enginePath: '/engine.js',
      spawnFn: () => child as never,
      fetchFn: async () => ({ ok: true }) as Response,
    })
    const startPromise = supervisor.start('/tmp/acme')
    queueMicrotask(() => child.stdout.emit('data', Buffer.from(HANDSHAKE + '\n')))
    await startPromise
    supervisor.stop('/tmp/acme')
    expect(child.killed).toBe(true)
    expect(supervisor.current('/tmp/acme')).toBeUndefined()
  })
})

/**
 * One engine per project. The app keeps several engagements open at once and
 * each tab holds its own port + token, so a second engagement must not disturb
 * the first — the previous single-child supervisor killed it, taking every tool
 * process its runs had spawned with it.
 */
describe('EngineSupervisor — one engine per project', () => {
  /** Start `dir` on a fresh fake child, resolving once the handshake lands. */
  const startOn = async (supervisor: EngineSupervisor, children: FakeChild[], dir: string): Promise<FakeChild> => {
    const child = new FakeChild()
    children.push(child)
    const started = supervisor.start(dir)
    queueMicrotask(() => child.stdout.emit('data', Buffer.from(HANDSHAKE + '\n')))
    await started
    return child
  }

  const build = (children: FakeChild[]): EngineSupervisor =>
    new EngineSupervisor({
      enginePath: '/engine.js',
      spawnFn: () => children[children.length - 1] as never,
      fetchFn: async () => ({ ok: true }) as Response,
    })

  it('runs both projects at once and reports each as served', async () => {
    const children: FakeChild[] = []
    const supervisor = build(children)
    const a = await startOn(supervisor, children, '/tmp/a')
    const b = await startOn(supervisor, children, '/tmp/b')

    expect(a.killed).toBe(false)
    expect(b.killed).toBe(false)
    expect(supervisor.served().sort()).toEqual(['/tmp/a', '/tmp/b'])
    expect(supervisor.current('/tmp/a')).toBeDefined()
    expect(supervisor.current('/tmp/b')).toBeDefined()
  })

  it('stops one project without touching the other', async () => {
    const children: FakeChild[] = []
    const supervisor = build(children)
    const a = await startOn(supervisor, children, '/tmp/a')
    const b = await startOn(supervisor, children, '/tmp/b')

    supervisor.stop('/tmp/a')

    expect(a.killed).toBe(true)
    expect(b.killed).toBe(false)
    expect(supervisor.served()).toEqual(['/tmp/b'])
  })

  it('hands back the running engine instead of spawning a second for one project', async () => {
    const children: FakeChild[] = []
    const supervisor = build(children)
    const first = await startOn(supervisor, children, '/tmp/a')

    // A plain re-start of a served project must reuse, not respawn.
    const again = await supervisor.start('/tmp/a')
    expect(again).toEqual(supervisor.current('/tmp/a'))
    expect(children).toHaveLength(1)
    expect(first.killed).toBe(false)
  })

  it('shares one spawn between concurrent starts of the same project', async () => {
    // Session restore opens every persisted engagement in parallel; two opens of
    // one dir racing must not leave a second, orphaned engine behind.
    const children: FakeChild[] = []
    const supervisor = build(children)
    const child = new FakeChild()
    children.push(child)

    const first = supervisor.start('/tmp/a')
    const second = supervisor.start('/tmp/a')
    queueMicrotask(() => child.stdout.emit('data', Buffer.from(HANDSHAKE + '\n')))

    expect(await first).toEqual(await second)
    expect(children).toHaveLength(1)
  })

  it('forgets an engine that exits on its own', async () => {
    const children: FakeChild[] = []
    const supervisor = build(children)
    const child = await startOn(supervisor, children, '/tmp/a')

    child.exitCode = 1
    child.emit('close', 1)

    expect(supervisor.current('/tmp/a')).toBeUndefined()
    expect(supervisor.served()).toEqual([])
  })

  it('stopAll() stops every engine', async () => {
    const children: FakeChild[] = []
    const supervisor = build(children)
    const a = await startOn(supervisor, children, '/tmp/a')
    const b = await startOn(supervisor, children, '/tmp/b')

    supervisor.stopAll()

    expect(a.killed).toBe(true)
    expect(b.killed).toBe(true)
    expect(supervisor.served()).toEqual([])
  })
})
