import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type LevelListener = (level: string) => void

async function load(verbose = false): Promise<{
  mod: typeof import('./log.js')
  write: ReturnType<typeof vi.fn>
  emitLevel: LevelListener
  refreshMasks: ReturnType<typeof vi.fn>
}> {
  vi.resetModules()
  const write = vi.fn()
  const refreshMasks = vi.fn()
  let listener: LevelListener = () => {}
  vi.stubGlobal('window', Object.assign(window, {
    executioner: {
      log: {
        write,
        refreshMasks,
        getVerbose: () => Promise.resolve(verbose),
        onLevel: (l: LevelListener) => {
          listener = l
          return () => {}
        },
      },
    },
  }))
  const mod = await import('./log.js')
  await new Promise((r) => setTimeout(r, 0))
  return { mod, write, refreshMasks, emitLevel: (l) => listener(l) }
}

describe('rlog', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('drops debug at info and sends it after onLevel(debug)', async () => {
    const { mod, write, emitLevel } = await load()
    mod.rlog.debug('x', 'hidden')
    expect(write).not.toHaveBeenCalled()
    mod.rlog.info('x', 'shown', { a: 1 })
    expect(write).toHaveBeenCalledWith({ lvl: 'info', src: 'renderer/x', msg: 'shown', data: { a: 1 } })
    emitLevel('debug')
    mod.rlog.debug('x', 'now')
    expect(write).toHaveBeenCalledWith({ lvl: 'debug', src: 'renderer/x', msg: 'now' })
  })

  it('starts at debug when getVerbose resolves true', async () => {
    const { mod, write } = await load(true)
    mod.rlog.debug('x', 'v')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('is a no-op without a log bridge', async () => {
    vi.resetModules()
    vi.stubGlobal('window', Object.assign(window, { executioner: {} }))
    const mod = await import('./log.js')
    expect(() => mod.rlog.error('x', 'm')).not.toThrow()
    expect(() => mod.refreshLogMasks()).not.toThrow()
  })

  it('logs an error event and an unhandled rejection once each', async () => {
    const { mod, write } = await load()
    const target = new EventTarget() as unknown as Window
    mod.installRendererErrorCapture(target)
    const ev = new Event('error') as Event & { error?: unknown; message?: string }
    ev.error = new TypeError('boom')
    ev.message = 'boom'
    target.dispatchEvent(ev)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]![0]).toMatchObject({ lvl: 'error', data: { name: 'TypeError', message: 'boom' } })
    const rej = new Event('unhandledrejection') as Event & { reason?: unknown }
    rej.reason = new Error('nope')
    target.dispatchEvent(rej)
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[1]![0]).toMatchObject({ lvl: 'error', data: { message: 'nope' } })
  })

  it('refreshLogMasks calls refreshMasks once', async () => {
    const { mod, refreshMasks } = await load()
    mod.refreshLogMasks()
    expect(refreshMasks).toHaveBeenCalledTimes(1)
  })
})
