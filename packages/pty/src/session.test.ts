import { describe, expect, it, vi } from 'vitest'
import { PtySession } from './session.js'

// Nothing here waits on wall-clock time. Under a full-suite load, node can take
// well over a second to start, so every step waits for output it can see or for
// the exit event. No child exits right after printing what a test checks
// either: node-pty gives the pty socket only 200 ms after exit to drain, and on
// a starved event loop that timer fires before the pending read, so the last
// output is dropped. Children print, then wait to be told to exit or killed.

/** Ceiling for a wait that should resolve. It only caps a hung test; a pass never waits on it. */
const PATIENCE_MS = 20_000
const TEST_TIMEOUT_MS = 30_000

/** Resolves with everything printed up to and including the first match, then stops listening. */
function outputMatching(session: PtySession, pattern: RegExp): Promise<RegExpMatchArray> {
  return new Promise((resolve) => {
    let buffered = ''
    const sub = session.onData((d) => {
      buffered += d
      const match = buffered.match(pattern)
      if (match === null) return
      sub.dispose()
      resolve(match)
    })
  })
}

/** Resolves once the session has printed `marker`. */
async function outputContaining(session: PtySession, marker: string): Promise<void> {
  await outputMatching(session, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}

function exitOf(session: PtySession): Promise<number> {
  return new Promise((resolve) => session.onExit(resolve))
}

/** Kills the session and waits until it has actually gone. */
async function stop(session: PtySession): Promise<void> {
  const exited = exitOf(session)
  session.kill()
  await exited
}

describe('PtySession', () => {
  it(
    'spawns a command, streams its output, and fires exit',
    async () => {
      const chunks: string[] = []
      const session = new PtySession({
        command: process.execPath,
        // Exits only when told to, so the output is read before the process goes.
        args: ['-e', "process.stdout.write('pty-hello\\n'); process.stdin.once('data', () => process.exit(0))"],
        cwd: process.cwd(),
      })
      session.onData((data) => chunks.push(data))
      const hello = outputContaining(session, 'pty-hello')
      const exited = exitOf(session)

      await hello
      session.write('\n')
      expect(await exited).toBe(0)
      expect(chunks.join('')).toContain('pty-hello')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'writes input to the process',
    async () => {
      const session = new PtySession({
        command: process.execPath,
        args: ['-e', 'process.stdin.on("data", d => process.stdout.write("echo:" + d))'],
        cwd: process.cwd(),
      })
      const echoed = outputContaining(session, 'echo:ping')
      // The tty buffers this until the child reads it, however late it starts.
      session.write('ping\n')

      await echoed
      await stop(session)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'records output for replay before any client subscribes',
    async () => {
      // A terminal remounted after an engagement switch attaches to a session
      // that has been running for a while; the tail is what it gets shown.
      // Subscribing to wait would defeat the point, so this polls the tail.
      const session = new PtySession({
        command: process.execPath,
        args: ['-e', "process.stdout.write('printed-before-attach'); setInterval(() => {}, 1000)"],
        cwd: process.cwd(),
      })
      await vi.waitFor(() => expect(session.snapshot()).toContain('printed-before-attach'), {
        timeout: PATIENCE_MS,
        interval: 20,
      })
      await stop(session)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'stops delivering to a disposed subscription',
    async () => {
      // Each websocket attach subscribes; without disposal on close every
      // engagement switch would leave a dead listener on a long-lived session.
      // The child answers each line it reads, so each step waits on output it
      // asked for.
      const seen: string[] = []
      const session = new PtySession({
        command: process.execPath,
        args: ['-e', 'process.stdin.on("data", d => process.stdout.write("out:" + String(d).trim() + "\\n"))'],
        cwd: process.cwd(),
      })
      const subscription = session.onData((d) => seen.push(d))

      const first = outputContaining(session, 'out:first')
      session.write('first\n')
      await first
      // The waiter and `subscription` hear the same chunk in one synchronous fire.
      expect(seen.join('')).toContain('out:first')

      subscription.dispose()
      const afterDispose = seen.length
      const second = outputContaining(session, 'out:second')
      session.write('second\n')
      await second

      // The child has demonstrably printed again, and none of it reached `seen`.
      expect(seen.length).toBe(afterDispose)
      // The session itself is still running and still recording.
      expect(session.snapshot()).toContain('out:second')
      await stop(session)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'trims the replay tail at a line boundary once it exceeds the cap',
    async () => {
      // Cutting mid-escape-sequence would leave a reattaching terminal broken, so
      // the trim lands on a newline.
      const session = new PtySession({
        command: process.execPath,
        args: ['-e', 'for (let i=0;i<400;i++) process.stdout.write("line-"+i+"\\n"); setInterval(() => {}, 1000)'],
        cwd: process.cwd(),
        scrollbackBytes: 512,
      })
      // The session records before any listener added here, so once this one
      // has seen the last line the tail holds it too.
      await outputContaining(session, 'line-399\r\n')

      const tail = session.snapshot()
      expect(tail.length).toBeLessThanOrEqual(512 + 64)
      // The oldest lines are gone and the newest survive.
      // The pty turns \n into \r\n, so this is how line 0 would appear.
      expect(tail).not.toContain('line-0\r\n')
      expect(tail).toContain('line-399')
      await stop(session)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'drops an inherited variable the caller asked to unset',
    async () => {
      process.env.EXE_TEST_INHERITED = 'leaked'
      try {
        const session = new PtySession({
          command: process.execPath,
          args: ['-e', 'process.stdout.write("env=[" + String(process.env.EXE_TEST_INHERITED) + "]"); setInterval(() => {}, 1000)'],
          cwd: process.cwd(),
          unsetEnv: ['EXE_TEST_INHERITED'],
        })
        const match = await outputMatching(session, /env=\[(.*?)\]/)
        expect(match[1]).toBe('undefined')
        await stop(session)
      } finally {
        delete process.env.EXE_TEST_INHERITED
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'keeps a value the caller passes explicitly, even when also unset',
    async () => {
      // unsetEnv removes what was *inherited*; a caller that passes the key means
      // it, when deliberately spawning a nested session, for instance.
      process.env.EXE_TEST_INHERITED = 'leaked'
      try {
        const session = new PtySession({
          command: process.execPath,
          args: ['-e', 'process.stdout.write("env=[" + String(process.env.EXE_TEST_INHERITED) + "]"); setInterval(() => {}, 1000)'],
          cwd: process.cwd(),
          unsetEnv: ['EXE_TEST_INHERITED'],
          env: { EXE_TEST_INHERITED: 'deliberate' },
        })
        const match = await outputMatching(session, /env=\[(.*?)\]/)
        expect(match[1]).toBe('deliberate')
        await stop(session)
      } finally {
        delete process.env.EXE_TEST_INHERITED
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'kill terminates the session',
    async () => {
      const session = new PtySession({
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)'],
        cwd: process.cwd(),
      })
      const exitPromise = exitOf(session)
      session.kill()
      await expect(exitPromise).resolves.toBeTypeOf('number')
    },
    TEST_TIMEOUT_MS,
  )
})
