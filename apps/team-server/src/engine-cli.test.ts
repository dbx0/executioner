import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  backendTestArgs,
  runEngineJson,
  sshEnrollArgs,
  type EngineSpawn,
} from './engine-cli.js'

function fakeChild(opts: {
  code: number
  stdout?: string
  stderr?: string
  onStdin?: (chunk: string) => void
}): ReturnType<EngineSpawn> {
  const child = new EventEmitter() as ReturnType<EngineSpawn>
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdin = new Writable({
    write(chunk, _enc, cb) {
      opts.onStdin?.(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk))
      cb()
    },
  })
  stdin.end = ((chunk?: unknown, encodingOrCb?: unknown, cb?: unknown) => {
    if (chunk !== undefined && chunk !== null) {
      opts.onStdin?.(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk))
    }
    const done = typeof encodingOrCb === 'function' ? encodingOrCb : typeof cb === 'function' ? cb : undefined
    queueMicrotask(() => {
      if (opts.stdout !== undefined && opts.stdout !== '') stdout.write(opts.stdout)
      if (opts.stderr !== undefined && opts.stderr !== '') stderr.write(opts.stderr)
      stdout.end()
      stderr.end()
      child.emit('close', opts.code)
      done?.()
    })
    return stdin
  }) as typeof stdin.end
  child.stdin = stdin
  child.stdout = stdout
  child.stderr = stderr
  return child
}

describe('sshEnrollArgs / backendTestArgs', () => {
  it('builds ssh-enroll argv with key-dir', () => {
    expect(sshEnrollArgs('/tmp/keys')).toEqual(['ssh-enroll', '--key-dir', '/tmp/keys'])
  })

  it('builds backend-test argv and optional create-workdir', () => {
    expect(backendTestArgs()).toEqual(['backend-test'])
    expect(backendTestArgs(true)).toEqual(['backend-test', '--create-workdir'])
    expect(backendTestArgs(false)).toEqual(['backend-test'])
  })
})

describe('runEngineJson', () => {
  it('spawns node with engine path + args and feeds JSON stdin', async () => {
    let stdin = ''
    const spawnFn = vi.fn<EngineSpawn>((_cmd, _args, _opts) =>
      fakeChild({
        code: 0,
        stdout: '{"ok":true,"identityFile":"/tmp/k"}\n',
        onStdin: (c) => {
          stdin += c
        },
      }),
    )

    const result = await runEngineJson({
      nodeBin: 'node',
      enginePath: '/eng/cli.js',
      args: sshEnrollArgs('/keys'),
      input: { host: 'h', user: 'u', password: 'p' },
      spawnFn,
    })

    expect(result).toEqual({ ok: true, identityFile: '/tmp/k' })
    expect(spawnFn).toHaveBeenCalledWith(
      'node',
      ['/eng/cli.js', 'ssh-enroll', '--key-dir', '/keys'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
    )
    expect(JSON.parse(stdin)).toEqual({ host: 'h', user: 'u', password: 'p' })
  })

  it('rejects on non-zero exit with stderr', async () => {
    const spawnFn = vi.fn<EngineSpawn>(() =>
      fakeChild({ code: 1, stderr: 'error: invalid backend profile\n' }),
    )
    await expect(
      runEngineJson({
        nodeBin: 'node',
        enginePath: '/eng/cli.js',
        args: backendTestArgs(),
        input: { name: 'bad' },
        spawnFn,
      }),
    ).rejects.toThrow('error: invalid backend profile')
  })

  it('rejects unreadable stdout on exit 0', async () => {
    const spawnFn = vi.fn<EngineSpawn>(() => fakeChild({ code: 0, stdout: 'not-json' }))
    await expect(
      runEngineJson({
        nodeBin: 'node',
        enginePath: '/eng/cli.js',
        args: ['backend-test'],
        input: {},
        spawnFn,
      }),
    ).rejects.toThrow('returned unreadable output')
  })
})
