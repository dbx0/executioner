import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { ENV_NAME, launchValueProblem, type BackendKind, type BackendProfile } from '@exe/protocol'

export interface LaunchSpec {
  program: string
  args: string[]
  /** Working directory for the *local* wrapper process (evidence dir). The
   * remote working directory comes from the profile's `workdir`. */
  cwd: string
  env?: Record<string, string>
}

/**
 * Turns a resolved command (`{program, args}`) into a running child process.
 * Every backend yields a normal ChildProcess, so NodeRunner/Executor stream
 * stdout/stderr, watch `close`, and `kill` it identically regardless of where
 * the command actually runs.
 */
export interface CommandLauncher {
  readonly kind: BackendKind
  launch(spec: LaunchSpec): ChildProcessWithoutNullStreams
}

/** POSIX single-quote so an argument survives one round through a remote shell. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Refuse a profile value that ssh or docker would read as an option, or an env
 * name that is not one. The input schema rejects these on save; this catches a
 * profile stored before it did, at the moment it would be used.
 */
function assertLaunchable(profile: BackendProfile): void {
  for (const field of ['host', 'user', 'image'] as const) {
    const value = profile[field]
    if (value === undefined || value === '') continue
    const problem = launchValueProblem(value)
    if (problem !== null) throw new Error(`backend profile "${profile.name}": ${field} ${problem}`)
  }
  for (const name of Object.keys(profile.env ?? {})) {
    if (!ENV_NAME.test(name)) throw new Error(`backend profile "${profile.name}": "${name}" is not a valid variable name`)
  }
}

/** `export K='V'; ` prefix for a remote shell command (empty when no env). */
function sshEnvPrefix(env: BackendProfile['env']): string {
  if (env === undefined) return ''
  return Object.entries(env)
    .map(([k, v]) => `export ${k}=${shQuote(v)}; `)
    .join('')
}

/** The `ssh` invocation for a profile + command (pure, for testing). */
export function sshInvocation(profile: BackendProfile, program: string, args: string[]): { program: string; args: string[] } {
  assertLaunchable(profile)
  const opts = [
    '-T', // no pseudo-tty: keep stdout clean
    '-o',
    'BatchMode=yes', // never prompt (fail instead of hanging on a password)
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ConnectTimeout=10',
  ]
  if (profile.port !== undefined) opts.push('-p', String(profile.port))
  if (profile.identityFile !== undefined && profile.identityFile !== '') opts.push('-i', profile.identityFile)

  const command = [program, ...args].map(shQuote).join(' ')
  const inWorkdir =
    profile.workdir !== undefined && profile.workdir !== ''
      ? `cd ${shQuote(profile.workdir)} && exec ${command}`
      : command
  // Env exports go first so PATH etc. apply to the tool (e.g. reaching ~/go/bin
  // over a non-login SSH session).
  const remote = `${sshEnvPrefix(profile.env)}${inWorkdir}`
  // `--` ends option parsing, so the destination can only ever be a destination.
  return { program: 'ssh', args: [...opts, '--', `${profile.user ?? ''}@${profile.host ?? ''}`, remote] }
}

/** The `docker run` invocation for a profile + command (pure, for testing). */
export function dockerInvocation(profile: BackendProfile, program: string, args: string[]): { program: string; args: string[] } {
  assertLaunchable(profile)
  const runArgs = ['run', '--rm', '-i']
  if (profile.workdir !== undefined && profile.workdir !== '') runArgs.push('-w', profile.workdir)
  if (profile.env !== undefined) for (const [k, v] of Object.entries(profile.env)) runArgs.push('-e', `${k}=${v}`)
  runArgs.push(profile.image ?? '', program, ...args)
  return { program: 'docker', args: runArgs }
}

export class LocalLauncher implements CommandLauncher {
  readonly kind = 'local' as const
  constructor(private readonly env?: Record<string, string>) {}
  launch(spec: LaunchSpec): ChildProcessWithoutNullStreams {
    // A local profile's env augments the process env; a caller-supplied spec.env wins.
    const merged =
      this.env !== undefined || spec.env !== undefined
        ? { ...process.env, ...this.env, ...spec.env }
        : undefined
    return spawn(spec.program, spec.args, { cwd: spec.cwd, ...(merged !== undefined ? { env: merged } : {}) })
  }
}

/**
 * Runs the command on a remote host over SSH. The tool's stdout/stderr stream
 * back over the connection; file outputs on the remote are not retrieved (such
 * nodes run locally instead — see NodeRunner).
 */
export class SshLauncher implements CommandLauncher {
  readonly kind = 'ssh' as const
  constructor(private readonly profile: BackendProfile) {}

  launch(spec: LaunchSpec): ChildProcessWithoutNullStreams {
    const { program, args } = sshInvocation(this.profile, spec.program, spec.args)
    return spawn(program, args, { cwd: spec.cwd, ...(spec.env !== undefined ? { env: spec.env } : {}) })
  }
}

/** Runs the command inside a throwaway Docker container from the profile's image. */
export class DockerLauncher implements CommandLauncher {
  readonly kind = 'docker' as const
  constructor(private readonly profile: BackendProfile) {}

  launch(spec: LaunchSpec): ChildProcessWithoutNullStreams {
    const { program, args } = dockerInvocation(this.profile, spec.program, spec.args)
    return spawn(program, args, { cwd: spec.cwd, ...(spec.env !== undefined ? { env: spec.env } : {}) })
  }
}

/** Build the launcher for a resolved profile (undefined / 'local' → local). */
export function launcherForProfile(profile: BackendProfile | undefined): CommandLauncher {
  if (profile === undefined || profile.kind === 'local') return new LocalLauncher(profile?.env)
  if (profile.kind === 'ssh') return new SshLauncher(profile)
  return new DockerLauncher(profile)
}
