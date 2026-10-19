import { spawn } from 'node:child_process'
import type { BackendProfile, BackendProfileInput } from '@exe/protocol'
import { sshInvocation, dockerInvocation } from './launcher.js'

/** One liveness step in a backend test (spinner → check/✗ in the UI). */
export interface BackendTestStep {
  name: string
  ok: boolean
  detail?: string
}

/** The result of testing a backend profile before saving it. */
export interface BackendTestResult {
  ok: boolean
  steps: BackendTestStep[]
  error?: string
  /** Set when the SSH host is reachable but the configured workdir is absent, so
   *  the caller can offer to create it and retry. Holds the missing path. */
  missingWorkdir?: string
}

/** Options for a backend test. */
export interface TestOptions {
  /** For ssh with a workdir: `mkdir -p` the directory before verifying it. */
  createWorkdir?: boolean
}

/** Outcome of a single spawned command. `timedOut` is set when we killed it. */
export interface RunOutcome {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/**
 * Spawns a command and resolves with its outcome. Injectable so backend tests
 * run against a fake runner in unit tests (no real ssh/docker).
 */
export type RunFn = (program: string, args: string[], timeoutMs: number) => Promise<RunOutcome>

const TOKEN = 'executioner-ok'

/** Timeouts (ms). SSH fails fast (BatchMode); docker pull can be slow. */
export const TIMEOUTS = { ssh: 15_000, dockerPull: 180_000, dockerRun: 60_000 } as const

/**
 * The real spawner: runs `program args`, captures stdout/stderr, and enforces a
 * hard timeout by killing the child (SIGKILL as a fallback) so a hung ssh/docker
 * can never wedge the engine.
 */
export const spawnRun: RunFn = (program, args, timeoutMs) =>
  new Promise<RunOutcome>((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ code: null, stdout: '', stderr: (e as Error).message, timedOut: false })
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let done = false
    const finish = (outcome: RunOutcome): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(outcome)
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      // Escalate if it ignores SIGTERM.
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref()
    }, timeoutMs)
    timer.unref()
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', (e) => finish({ code: null, stdout, stderr: stderr || e.message, timedOut }))
    child.on('close', (code) => finish({ code, stdout, stderr, timedOut }))
  })

/** Last non-empty line of stderr (the useful part of a failure), trimmed. */
function stderrTail(outcome: RunOutcome): string {
  const lines = outcome.stderr.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  const tail = lines.length > 0 ? lines[lines.length - 1] : outcome.stdout.trim()
  const base = tail ?? ''
  return outcome.timedOut && base === '' ? 'timed out' : base
}

/** Give the pure launcher builders a full profile shape (they read only fields). */
function asProfile(input: BackendProfileInput): BackendProfile {
  return { ...input, id: 'test', createdAt: '', updatedAt: '' }
}

/**
 * Runs the liveness test appropriate to the profile's kind and never hangs
 * (every spawned step has a hard timeout + kill via `run`).
 *
 * - local  → trivially ok.
 * - ssh    → `ssh … echo executioner-ok` (BatchMode fails fast rather than
 *            prompting); ok on exit 0 with the token in stdout.
 * - docker → `docker pull <image>`, then `docker run --rm <image> echo
 *            executioner-ok`. Our docker backend runs a *fresh* `--rm` container
 *            per command, so "watch it go live" == a throwaway container runs the
 *            command: the run step is the real liveness check. Stops at the first
 *            failing step.
 */
export async function testBackend(
  input: BackendProfileInput,
  run: RunFn = spawnRun,
  opts: TestOptions = {},
): Promise<BackendTestResult> {
  if (input.kind === 'local') {
    return { ok: true, steps: [{ name: 'local', ok: true, detail: 'Runs on this machine.' }] }
  }

  if (input.kind === 'ssh') {
    // Connectivity is tested WITHOUT the workdir, so a missing directory is
    // distinguished from an unreachable host (the workdir `cd` would otherwise
    // make both look like the same failure).
    const base = asProfile({ ...input, workdir: undefined })
    const who = `${input.user ?? ''}@${input.host ?? ''}`
    const conn = sshInvocation(base, 'echo', [TOKEN])
    const outcome = await run(conn.program, conn.args, TIMEOUTS.ssh)
    const connOk = outcome.code === 0 && outcome.stdout.includes(TOKEN)
    if (!connOk) {
      const error = stderrTail(outcome) || 'ssh failed'
      return { ok: false, steps: [{ name: 'Connect & run', ok: false, detail: error }], error }
    }

    const wd = input.workdir?.trim() ?? ''
    if (wd === '') return { ok: true, steps: [{ name: 'Connect & run', ok: true, detail: who }] }

    const connectStep: BackendTestStep = { name: 'Connect & run', ok: true, detail: who }
    // Optionally create the directory before verifying it.
    if (opts.createWorkdir) {
      const mk = sshInvocation(base, 'mkdir', ['-p', wd])
      const mo = await run(mk.program, mk.args, TIMEOUTS.ssh)
      if (mo.code !== 0) {
        const error = stderrTail(mo) || 'mkdir failed'
        return { ok: false, steps: [connectStep, { name: 'Create directory', ok: false, detail: error }], error }
      }
    }
    const chk = sshInvocation(base, 'test', ['-d', wd])
    const ck = await run(chk.program, chk.args, TIMEOUTS.ssh)
    if (ck.code === 0) {
      const label = opts.createWorkdir ? 'Create directory' : 'Working directory'
      return { ok: true, steps: [connectStep, { name: label, ok: true, detail: wd }] }
    }
    // Reachable host, absent directory — not a hard failure. `missingWorkdir`
    // drives a dedicated "create it?" prompt, so no redundant `error` line here.
    return {
      ok: false,
      missingWorkdir: wd,
      steps: [connectStep, { name: 'Working directory', ok: false, detail: wd }],
    }
  }

  // docker
  const steps: BackendTestStep[] = []
  const image = input.image ?? ''

  const pull = await run('docker', ['pull', image], TIMEOUTS.dockerPull)
  // A pull can fail because the image is already present locally only when
  // offline; exit 0 covers "pulled" and "up to date". Treat non-zero as failure.
  if (pull.code !== 0) {
    const error = stderrTail(pull) || 'docker pull failed'
    steps.push({ name: 'Pull image', ok: false, detail: error })
    return { ok: false, steps, error }
  }
  steps.push({ name: 'Pull image', ok: true, detail: image })

  const runCmd = dockerInvocation(asProfile(input), 'echo', [TOKEN])
  const ran = await run(runCmd.program, runCmd.args, TIMEOUTS.dockerRun)
  const ranOk = ran.code === 0 && ran.stdout.includes(TOKEN)
  if (!ranOk) {
    const error = stderrTail(ran) || 'docker run failed'
    steps.push({ name: 'Run container', ok: false, detail: error })
    return { ok: false, steps, error }
  }
  steps.push({ name: 'Run container', ok: true, detail: 'container ran the command' })
  return { ok: true, steps }
}
