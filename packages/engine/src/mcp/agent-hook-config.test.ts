import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeAgentHookConfig } from './agent-hook-config.js'

const TOKEN = 'hook-token-hook-token-hook-token'

interface Settings {
  hooks: Record<string, { hooks: { command: string }[] }[]>
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-hooktest-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const commandsOf = (path: string): string[] =>
  Object.values((JSON.parse(readFileSync(path, 'utf8')) as Settings).hooks).flatMap((entries) =>
    entries.flatMap((e) => e.hooks.map((h) => h.command)),
  )

describe('writeAgentHookConfig', () => {
  it('keeps the token off every hook command line', () => {
    const path = writeAgentHookConfig({ port: 4100, token: TOKEN, sessionId: 's1', dir })
    const commands = commandsOf(path)
    expect(commands.length).toBeGreaterThan(0)
    for (const command of commands) expect(command).not.toContain(TOKEN)
  })

  it('stores the token in an owner-only file beside the forwarder', () => {
    const path = writeAgentHookConfig({ port: 4100, token: TOKEN, sessionId: 's1', dir })
    const tokenFile = join(dirname(path), 'token')
    expect(readFileSync(tokenFile, 'utf8')).toBe(TOKEN)
    if (process.platform !== 'win32') {
      expect(statSync(tokenFile).mode & 0o777).toBe(0o600)
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  })

  it.skipIf(process.platform === 'win32')('forwards a hook payload authenticated with the stored token', async () => {
    let seen: { auth: string | undefined; body: string } | undefined
    const server = createServer((req: IncomingMessage, res) => {
      let body = ''
      req.on('data', (c: Buffer) => (body += c.toString()))
      req.on('end', () => {
        seen = { auth: req.headers.authorization, body }
        res.end('{}')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as { port: number }).port
      const path = writeAgentHookConfig({ port, token: TOKEN, sessionId: 's1', dir })
      const command = commandsOf(path).find((c) => c.endsWith(' Stop')) ?? ''
      // Run the hook the way Claude does: through a shell, payload on stdin. It
      // exits once its POST settles, so the request has landed by then.
      await new Promise<void>((resolve, reject) => {
        const child = spawn('/bin/sh', ['-c', command], { stdio: ['pipe', 'ignore', 'ignore'] })
        child.on('error', reject)
        child.on('close', () => resolve())
        child.stdin.end(JSON.stringify({ hello: 'world' }))
      })
      expect(seen?.auth).toBe(`Bearer ${TOKEN}`)
      expect(JSON.parse(seen?.body ?? '{}')).toEqual({ sessionId: 's1', event: 'Stop', payload: { hello: 'world' } })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
