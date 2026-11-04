import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { LogLine } from '@exe/protocol'
import { EngineSupervisor, engineSourceId } from './engine-supervisor.js'

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

describe('EngineSupervisor browser hooks', () => {
  it('calls onReady after the engine is healthy', async () => {
    const child = new FakeChild()
    const onReady = vi.fn()
    const supervisor = new EngineSupervisor({
      enginePath: '/engine.js',
      spawnFn: () => child as never,
      fetchFn: async () => ({ ok: true }) as Response,
      onReady,
    })
    const started = supervisor.start('/tmp/acme')
    queueMicrotask(() => child.stdout.emit('data', Buffer.from(HANDSHAKE + '\n')))
    const connection = await started
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledWith(connection)
  })

  it('calls onExit when the child closes and on stop', async () => {
    const onExit = vi.fn()
    const boot = async () => {
      const child = new FakeChild()
      const supervisor = new EngineSupervisor({
        enginePath: '/engine.js',
        spawnFn: () => child as never,
        fetchFn: async () => ({ ok: true }) as Response,
        onExit,
      })
      const started = supervisor.start('/tmp/acme')
      queueMicrotask(() => child.stdout.emit('data', Buffer.from(HANDSHAKE + '\n')))
      await started
      return { child, supervisor }
    }

    const first = await boot()
    first.child.exitCode = 1
    first.child.emit('close', 1)
    expect(onExit).toHaveBeenCalledWith('/tmp/acme')

    onExit.mockClear()
    const second = await boot()
    second.supervisor.stop('/tmp/acme')
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(onExit).toHaveBeenCalledWith('/tmp/acme')
  })
})

describe('EngineSupervisor engine logs', () => {
  async function started(extra: { logLevel?: () => 'debug' | 'info' | 'warn' | 'error' } = {}) {
    const child = new FakeChild()
    const lines: LogLine[] = []
    const spawnFn = vi.fn(() => child as never)
    const supervisor = new EngineSupervisor({
      enginePath: '/engine.js',
      spawnFn,
      fetchFn: async () => ({ ok: true }) as Response,
      onLog: (l) => lines.push(l),
      ...extra,
    })
    const p = supervisor.start('/tmp/acme')
    queueMicrotask(() => child.stdout.emit('data', Buffer.from(HANDSHAKE + '\n')))
    await p
    // The spawn record is asserted on its own; the rest of the tests watch what follows.
    const starting = lines.splice(0)
    return { child, lines, spawnFn, supervisor, starting }
  }
  const id = engineSourceId('/tmp/acme')

  it('derives a 6 hex char source id', () => {
    expect(id).toMatch(/^[0-9a-f]{6}$/)
  })

  it('tags JSON stderr lines with the engine source', async () => {
    const { child, lines } = await started()
    child.stderr.emit('data', Buffer.from(JSON.stringify({ t: 'x', lvl: 'warn', src: 'engine/scheduler', msg: 'm' }) + '\n'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ lvl: 'warn', src: `engine:${id}/scheduler`, msg: 'm' })
  })

  it('tags a bare engine source', async () => {
    const { child, lines } = await started()
    child.stderr.emit('data', Buffer.from(JSON.stringify({ t: 'x', lvl: 'info', src: 'engine', msg: 'm' }) + '\n'))
    expect(lines[0]?.src).toBe(`engine:${id}`)
  })

  it('wraps non-JSON stderr lines as errors', async () => {
    const { child, lines } = await started()
    child.stderr.emit('data', Buffer.from('boom\n'))
    expect(lines[0]).toMatchObject({ lvl: 'error', src: `engine:${id}`, msg: 'boom' })
  })

  it('reassembles lines split across chunks', async () => {
    const { child, lines } = await started()
    const whole = Buffer.from(JSON.stringify({ t: 'x', lvl: 'info', src: 'engine', msg: 'caf\u00e9' }) + '\n')
    const at = whole.indexOf(0xc3) + 1
    child.stderr.emit('data', whole.subarray(0, at))
    child.stderr.emit('data', whole.subarray(at))
    expect(lines).toHaveLength(1)
    expect(lines[0]?.msg).toBe('caf\u00e9')
  })

  it('keeps forwarding after the handshake', async () => {
    const { child, lines } = await started()
    child.stderr.emit('data', Buffer.from('one\n'))
    child.stderr.emit('data', Buffer.from('two\n'))
    expect(lines.map((l) => l.msg)).toEqual(['one', 'two'])
  })

  it('logs the exit with the last 50 stderr lines', async () => {
    const { child, lines } = await started()
    for (let i = 0; i < 60; i += 1) child.stderr.emit('data', Buffer.from(`line${i}\n`))
    lines.length = 0
    child.emit('close', 1, 'SIGSEGV')
    const exit = lines.find((l) => l.msg === 'Engine exited')
    expect(exit).toMatchObject({ lvl: 'error', src: `engine:${id}` })
    const data = exit?.data as { code: number; signal: string; stderrTail: string[] }
    expect(data.code).toBe(1)
    expect(data.signal).toBe('SIGSEGV')
    expect(data.stderrTail).toHaveLength(50)
    expect(data.stderrTail[49]).toBe('line59')
  })

  it('keeps the last 8 stderr lines in the pre-handshake rejection', async () => {
    const child = new FakeChild()
    const supervisor = new EngineSupervisor({
      enginePath: '/engine.js',
      spawnFn: () => child as never,
      fetchFn: async () => ({ ok: true }) as Response,
      onLog: () => {},
    })
    const p = supervisor.start('/tmp/acme')
    queueMicrotask(() => {
      for (let i = 0; i < 12; i += 1) child.stderr.emit('data', Buffer.from(`e${i}\n`))
      child.emit('close', 1, null)
    })
    await expect(p).rejects.toThrow(/e4\ne5\ne6\ne7\ne8\ne9\ne10\ne11$/)
  })

  it('sets EXECUTIONER_LOG_LEVEL from logLevel()', async () => {
    const { spawnFn } = await started({ logLevel: () => 'debug' })
    expect(spawnFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ env: expect.objectContaining({ EXECUTIONER_LOG_LEVEL: 'debug' }) }),
    )
  })

  it('logs a requested stop at info as Engine stopped', async () => {
    const { supervisor, lines } = await started()
    lines.length = 0
    supervisor.stop('/tmp/acme')
    const exits = lines.filter((l) => l.msg.startsWith('Engine'))
    expect(exits).toHaveLength(1)
    expect(exits[0]).toMatchObject({ lvl: 'info', msg: 'Engine stopped' })
    expect(exits[0]?.data).toHaveProperty('stderrTail')
  })

  it('logs an unprompted close at error as Engine exited', async () => {
    const { child, lines } = await started()
    lines.length = 0
    child.emit('close', 1, null)
    const exits = lines.filter((l) => l.msg.startsWith('Engine'))
    expect(exits).toHaveLength(1)
    expect(exits[0]).toMatchObject({ lvl: 'error', msg: 'Engine exited' })
  })

  it('lists live connections', async () => {
    const { supervisor } = await started()
    expect(supervisor.liveConnections()).toHaveLength(1)
  })

  it('keeps only raw non-JSON lines in the exit stderrTail', async () => {
    const { child, lines } = await started()
    child.stderr.emit('data', Buffer.from(JSON.stringify({ t: 'x', lvl: 'info', src: 'engine', msg: 'm', data: { engagement: 'Acme Corp', text: 'secret body' } }) + '\n'))
    child.stderr.emit('data', Buffer.from('raw crash text\n'))
    lines.length = 0
    child.emit('close', 1, null)
    const exit = lines.find((l) => l.msg === 'Engine exited')
    const tail = (exit?.data as { stderrTail: string[] }).stderrTail
    expect(tail).toEqual(['raw crash text'])
    expect(JSON.stringify(tail)).not.toContain('Acme')
  })

  it('uses only raw lines in the pre-handshake rejection', async () => {
    const child = new FakeChild()
    const supervisor = new EngineSupervisor({
      enginePath: '/engine.js',
      spawnFn: () => child as never,
      fetchFn: async () => ({ ok: true }) as Response,
      onLog: () => {},
    })
    const p = supervisor.start('/tmp/acme')
    queueMicrotask(() => {
      child.stderr.emit('data', Buffer.from(JSON.stringify({ t: 'x', lvl: 'info', src: 'engine', msg: 'm', data: { engagement: 'Acme Corp' } }) + '\n'))
      child.stderr.emit('data', Buffer.from('raw\n'))
      child.emit('close', 1, null)
    })
    const err = await p.catch((e: Error) => e)
    expect((err as Error).message).toMatch(/: raw$/)
    expect((err as Error).message).not.toContain('Acme')
  })

  it('logs Engine starting with the project dir before spawning', async () => {
    const { starting } = await started()
    expect(starting[0]).toMatchObject({ lvl: 'info', src: `engine:${id}`, msg: 'Engine starting', data: { engagement: '/tmp/acme' } })
  })

  it('logs Engine failed to start on a spawn error', async () => {
    const child = new FakeChild()
    const lines: LogLine[] = []
    const supervisor = new EngineSupervisor({
      enginePath: '/engine.js',
      spawnFn: () => child as never,
      fetchFn: async () => ({ ok: true }) as Response,
      onLog: (l) => lines.push(l),
    })
    const p = supervisor.start('/tmp/acme')
    queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn ENOENT'), { name: 'Error' })))
    await expect(p).rejects.toThrow('spawn ENOENT')
    expect(lines.find((l) => l.msg === 'Engine failed to start')).toMatchObject({
      lvl: 'error',
      src: `engine:${id}`,
      data: { engagement: '/tmp/acme', name: 'Error', message: 'spawn ENOENT' },
    })
  })
})
