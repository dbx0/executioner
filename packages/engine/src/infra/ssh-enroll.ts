import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'ssh2'
import type { BackendProfile } from '@exe/protocol'
import { shQuote, sshInvocation } from './launcher.js'
import { spawnRun, type RunFn, TIMEOUTS } from './backend-test.js'

/** What the caller provides to enroll a generated key on a password host. */
export interface EnrollInput {
  host: string
  port?: number
  user: string
  /** Transient: used once to install the public key, never persisted or logged. */
  password: string
  /** Directory the generated keypair lives in (e.g. <project>/.executioner/ssh). */
  keyDir: string
}

/** One enrollment step (spinner → check/✗ in the UI, same shape as a test step). */
export interface EnrollStep {
  name: string
  ok: boolean
  detail?: string
}

/** Outcome of enrolling a generated key. `identityFile` is set only on full success. */
export interface EnrollResult {
  ok: boolean
  identityFile: string | null
  steps: EnrollStep[]
  error?: string
}

/** The generated (or reused) keypair: private-key path + its public-key line. */
export interface GeneratedKey {
  identityFile: string
  publicKey: string
}

/**
 * Injectable dependencies so unit tests never shell out, open a socket, or touch
 * a real host. The defaults do the real work (ssh-keygen, ssh2 connect, ssh verify).
 */
export interface EnrollDeps {
  /** Create (or reuse) an ed25519 keypair under `keyDir`, returning its paths. */
  keygen: (opts: { keyDir: string; keyName: string }) => Promise<GeneratedKey>
  /** Connect with the password and idempotently append the public key. Throws a
   * friendly Error on failure; always closes the connection. */
  install: (opts: {
    host: string
    port: number
    user: string
    password: string
    publicKey: string
  }) => Promise<void>
  /** Spawn the final key-auth verification (`ssh -i … echo`), with a hard timeout. */
  verify: RunFn
}

const TOKEN = 'executioner-ok'

/** Sanitize `user@host` into a filesystem-safe key basename. */
export function safeKeyName(user: string, host: string): string {
  const raw = `${user}@${host}`
  const cleaned = raw.replace(/[^A-Za-z0-9._@-]/g, '_').replace(/^[-.]+/, '')
  return cleaned === '' ? 'ssh-key' : cleaned
}

/** Last non-empty stderr line (or stdout), the useful part of a spawn failure. */
function outcomeError(stderr: string, stdout: string, timedOut: boolean): string {
  const lines = stderr.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  const tail = lines.length > 0 ? lines[lines.length - 1] : stdout.trim()
  const base = tail ?? ''
  if (base !== '') return base
  return timedOut ? 'Connection timed out' : 'Verification failed'
}

/**
 * Default keygen: ensure `keyDir` exists, then run
 * `ssh-keygen -t ed25519 -N '' -C executioner -f <keyDir>/<keyName>.key`.
 * If the private key already exists, reuse it (read the sibling `.pub`).
 */
export const spawnKeygen: EnrollDeps['keygen'] = ({ keyDir, keyName }) =>
  new Promise<GeneratedKey>((resolve, reject) => {
    mkdirSync(keyDir, { recursive: true })
    const identityFile = join(keyDir, `${keyName}.key`)
    const pubFile = `${identityFile}.pub`
    if (existsSync(identityFile) && existsSync(pubFile)) {
      try {
        resolve({ identityFile, publicKey: readFileSync(pubFile, 'utf8').trim() })
      } catch (e) {
        reject(new Error(`Could not read existing key: ${(e as Error).message}`))
      }
      return
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(
        'ssh-keygen',
        ['-t', 'ed25519', '-N', '', '-C', 'executioner', '-f', identityFile],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      )
    } catch (e) {
      reject(new Error(`ssh-keygen failed to start: ${(e as Error).message}`))
      return
    }
    let stderr = ''
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      child.kill('SIGKILL')
      reject(new Error('ssh-keygen timed out'))
    }, 15_000)
    timer.unref()
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', (e) => {
      if (done) return
      done = true
      clearTimeout(timer)
      reject(new Error(`ssh-keygen failed: ${e.message}`))
    })
    child.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`ssh-keygen exited ${code ?? 'null'}${stderr.trim() ? `: ${stderr.trim()}` : ''}`))
        return
      }
      try {
        resolve({ identityFile, publicKey: readFileSync(pubFile, 'utf8').trim() })
      } catch (e) {
        reject(new Error(`Could not read generated key: ${(e as Error).message}`))
      }
    })
  })

/** Map an ssh2 client error to a short, user-facing message. */
function friendlyConnectError(err: Error & { level?: string; code?: string }): string {
  const level = err.level ?? ''
  const code = err.code ?? ''
  const msg = err.message ?? ''
  if (level === 'client-authentication' || /authentication/i.test(msg)) {
    return 'Authentication failed — check the username/password'
  }
  if (code === 'ETIMEDOUT' || /timed out|timeout/i.test(msg)) return 'Connection timed out'
  if (code === 'ECONNREFUSED' || /refused/i.test(msg)) return 'Connection refused — is the host reachable on this port?'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo|not found/i.test(msg)) return 'Host not found'
  if (code === 'ECONNRESET') return 'Connection reset by the host'
  return msg || 'Could not connect to the host'
}

/**
 * Default install: connect over ssh2 with the password and idempotently append
 * the public key to `~/.ssh/authorized_keys`. Resolves on exit code 0; rejects
 * with a friendly Error otherwise. Always ends the connection and never hangs.
 */
export const ssh2Install: EnrollDeps['install'] = ({ host, port, user, password, publicKey }) =>
  new Promise<void>((resolve, reject) => {
    const conn = new Client()
    let settled = false
    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(guard)
      try {
        conn.end()
      } catch {
        // ignore
      }
      if (err) reject(err)
      else resolve()
    }
    // Hard overall guard on top of ssh2's readyTimeout, covering the exec too.
    const guard = setTimeout(() => finish(new Error('Connection timed out')), 30_000)
    guard.unref()

    const remote =
      'mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && ' +
      `chmod 600 ~/.ssh/authorized_keys && grep -qxF ${shQuote(publicKey)} ~/.ssh/authorized_keys || ` +
      `printf '%s\\n' ${shQuote(publicKey)} >> ~/.ssh/authorized_keys`

    conn.on('ready', () => {
      conn.exec(remote, (err, stream) => {
        if (err) {
          finish(new Error(`Could not run the install command: ${err.message}`))
          return
        }
        let stderr = ''
        stream.on('data', () => {})
        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString()
        })
        stream.on('close', (code: number | null) => {
          if (code === 0) finish()
          else finish(new Error(`Failed to install the key on the host${stderr.trim() ? `: ${stderr.trim()}` : ''}`))
        })
      })
    })
    conn.on('error', (err: Error & { level?: string; code?: string }) => {
      finish(new Error(friendlyConnectError(err)))
    })

    try {
      conn.connect({ host, port, username: user, password, readyTimeout: 15_000 })
    } catch (e) {
      finish(new Error(friendlyConnectError(e as Error & { level?: string; code?: string })))
    }
  })

const defaultDeps: EnrollDeps = {
  keygen: spawnKeygen,
  install: ssh2Install,
  verify: spawnRun,
}

/**
 * Generate an SSH keypair, install its public key on the host using the password
 * (once), verify key-auth works, and return the identity file to save. The
 * password is never persisted; only the identity file is meant to be stored.
 * Stops at the first failing step and never hangs (every network/spawn step has
 * a hard timeout). `identityFile` is returned only when install + verify pass.
 */
export async function enrollSshKey(input: EnrollInput, deps: EnrollDeps = defaultDeps): Promise<EnrollResult> {
  const steps: EnrollStep[] = []
  const port = input.port ?? 22

  // 1. Generate (or reuse) the keypair.
  let key: GeneratedKey
  try {
    key = await deps.keygen({ keyDir: input.keyDir, keyName: safeKeyName(input.user, input.host) })
    steps.push({ name: 'Generate key', ok: true, detail: key.identityFile })
  } catch (e) {
    const error = (e as Error).message
    steps.push({ name: 'Generate key', ok: false, detail: error })
    return { ok: false, identityFile: null, steps, error }
  }

  // 2. Install the public key over the password connection.
  try {
    await deps.install({ host: input.host, port, user: input.user, password: input.password, publicKey: key.publicKey })
    steps.push({ name: 'Install key', ok: true, detail: `${input.user}@${input.host}` })
  } catch (e) {
    const error = (e as Error).message
    steps.push({ name: 'Install key', ok: false, detail: error })
    return { ok: false, identityFile: null, steps, error }
  }

  // 3. Verify key-auth works (reuse the launcher's BatchMode ssh invocation).
  const profile: BackendProfile = {
    id: 'enroll',
    name: 'enroll',
    kind: 'ssh',
    host: input.host,
    port,
    user: input.user,
    identityFile: key.identityFile,
    createdAt: '',
    updatedAt: '',
  }
  const { program, args } = sshInvocation(profile, 'echo', [TOKEN])
  const outcome = await deps.verify(program, args, TIMEOUTS.ssh)
  const verified = outcome.code === 0 && outcome.stdout.includes(TOKEN)
  if (verified) {
    steps.push({ name: 'Verify', ok: true, detail: `${input.user}@${input.host}` })
    return { ok: true, identityFile: key.identityFile, steps }
  }
  const error = outcomeError(outcome.stderr, outcome.stdout, outcome.timedOut)
  steps.push({ name: 'Verify', ok: false, detail: error })
  return { ok: false, identityFile: null, steps, error }
}
