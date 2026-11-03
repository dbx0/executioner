import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process'

/** Narrow spawn surface so tests can stub without a full child_process mock. */
export type EngineSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams

export interface RunEngineJsonOptions {
  nodeBin: string
  enginePath: string
  args: string[]
  input: unknown
  env?: NodeJS.ProcessEnv
  spawnFn?: EngineSpawn
}

/**
 * Run a stateless engine CLI command. `input` is JSON on stdin so a password
 * never lands in argv. Parsed JSON stdout is the result (matches Electron
 * `runEngineJson`).
 */
export function runEngineJson<T = unknown>(options: RunEngineJsonOptions): Promise<T> {
  const spawnFn = options.spawnFn ?? (spawn as EngineSpawn)
  const env = options.env ?? process.env
  return new Promise((resolve, reject) => {
    const child = spawnFn(options.nodeBin, [options.enginePath, ...options.args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const label = options.args[0] ?? 'engine'
      if (code !== 0) {
        reject(new Error(err.trim() === '' ? `engine ${label} exited ${String(code)}` : err.trim()))
        return
      }
      try {
        resolve(JSON.parse(out) as T)
      } catch {
        reject(new Error(`engine ${label} returned unreadable output`))
      }
    })
    child.stdin.end(JSON.stringify(options.input))
  })
}

/** Argv for `ssh-enroll`, matching Electron `createIpcHandlers.enrollSsh`. */
export function sshEnrollArgs(keyDir: string): string[] {
  return ['ssh-enroll', '--key-dir', keyDir]
}

/** Argv for `backend-test`, matching Electron `createIpcHandlers.testBackend`. */
export function backendTestArgs(createWorkdir?: boolean): string[] {
  return ['backend-test', ...(createWorkdir === true ? ['--create-workdir'] : [])]
}
