import { spawn } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseHandshake } from '@exe/protocol'
import { runCli } from './cli.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-cli-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('runCli init', () => {
  it('creates a project in the given directory', async () => {
    const code = await runCli(['init', dir, '--name', 'acme'])
    expect(code).toBe(0)
    expect(existsSync(join(dir, '.executioner', 'project.sqlite'))).toBe(true)
  })

  it('exits non-zero when the directory is already a project', async () => {
    await runCli(['init', dir, '--name', 'acme'])
    expect(await runCli(['init', dir, '--name', 'acme'])).toBe(1)
  })
})

describe('runCli serve', () => {
  it('prints a parseable handshake and answers /health', async () => {
    await runCli(['init', dir, '--name', 'acme'])

    // A cold engine start is about a second of CPU, nearly all of it Node's
    // module loader, and under a full-suite load it competes with every vitest
    // worker. So this waits on the handshake line itself, or the child exiting,
    // never on a deadline; the test timeout is only a cap on a hung start.
    const child = spawn(process.execPath, ['./dist/cli.js', 'serve', dir], {
      cwd: join(import.meta.dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))

    try {
      const handshake = await new Promise<NonNullable<ReturnType<typeof parseHandshake>>>((resolve, reject) => {
        let buffer = ''
        child.stdout.on('data', (chunk: Buffer) => {
          buffer += chunk.toString()
          for (const line of buffer.split('\n')) {
            const parsed = parseHandshake(line.trim())
            if (parsed !== undefined) resolve(parsed)
          }
        })
        child.once('exit', (code, signal) =>
          reject(new Error(`engine exited (${String(code ?? signal)}) before its handshake: ${stderr}`)),
        )
      })

      const res = await fetch(`http://127.0.0.1:${handshake.port}/health`)
      expect(res.status).toBe(200)

      const authed = await fetch(`http://127.0.0.1:${handshake.port}/api/targets`, {
        headers: { authorization: `Bearer ${handshake.token}` },
      })
      expect(authed.status).toBe(200)
    } finally {
      // Reap it before afterEach deletes the project it still has open.
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      await exited
    }
  }, 60_000)
})

/** The stateless commands exist so the desktop app can verify a backend before
 *  any engagement is open; they take no <dir> and read their input from stdin. */
describe('runCli backend-test', () => {
  const withStdin = async (body: string, argv: string[]): Promise<{ code: number; out: string }> => {
    let out = ''
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string) => {
      out += chunk
      return true
    }) as typeof process.stdout.write
    // runCli reads stdin as an async iterable; hand it one chunk and end.
    const original = Object.getOwnPropertyDescriptor(process, 'stdin')
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: (async function* () {
        yield Buffer.from(body)
      })(),
    })
    try {
      const code = await runCli(argv)
      return { code, out }
    } finally {
      process.stdout.write = write
      if (original !== undefined) Object.defineProperty(process, 'stdin', original)
    }
  }

  it('tests a profile read from stdin, with no engagement anywhere', async () => {
    const { code, out } = await withStdin(JSON.stringify({ name: 'here', kind: 'local' }), ['backend-test'])
    expect(code).toBe(0)
    expect(JSON.parse(out)).toMatchObject({ ok: true })
  })

  it('rejects a profile that does not validate', async () => {
    const { code } = await withStdin(JSON.stringify({ name: 'bad', kind: 'ssh' }), ['backend-test'])
    expect(code).toBe(1)
  })

  it('rejects input that is not JSON', async () => {
    const { code } = await withStdin('not json', ['backend-test'])
    expect(code).toBe(1)
  })

  it('requires --key-dir for ssh-enroll', async () => {
    const { code } = await withStdin(JSON.stringify({ host: 'h', user: 'u', password: 'p' }), ['ssh-enroll'])
    expect(code).toBe(1)
  })
})
