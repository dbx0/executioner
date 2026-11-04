import { basename } from 'node:path'
import { PtyRegistry, type PtySession, type PtySessionOptions } from '@exe/pty'
import { engineLog } from '../infra/log.js'

/** The CLI's bare name (`claude`, `codex`, `bash`), never the path it was found at. */
export function cliName(command: string): string {
  return basename(command.replace(/\\/g, '/')).replace(/\.(exe|cmd|bat|ps1)$/i, '')
}

/**
 * The argv shape for a debug line: flags verbatim, every other argument by
 * length only. Prompts, briefings and file paths travel as plain arguments,
 * and a one-word prompt is indistinguishable from a subcommand, so none of
 * them are written.
 */
export function argvShape(args: readonly string[]): string[] {
  return args.map((a) => (/^--?[A-Za-z][\w-]*$/.test(a) ? a : `[${String(a.length)} chars]`))
}

/**
 * A PtyRegistry that logs every process it starts: the CLI name, exit code and
 * duration at info, the argv shape and env variable names (never values) at
 * debug. Every agent the engine launches, headless or in a terminal, goes
 * through the one registry `serve` builds.
 */
export class LoggedPtyRegistry extends PtyRegistry {
  override create(id: string, options: PtySessionOptions): PtySession {
    const cli = cliName(options.command)
    const started = Date.now()
    let session: PtySession
    try {
      session = super.create(id, options)
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error))
      engineLog.warn('agents', 'Launch failed', { cli, name: e.name, message: e.message })
      throw error
    }
    engineLog.info('agents', 'Launched', { cli, pid: session.pid })
    engineLog.debug('agents', 'Launch command', {
      cli,
      args: argvShape(options.args),
      env: Object.keys(options.env ?? {}),
      unsetEnv: [...(options.unsetEnv ?? [])],
    })
    session.onExit((code) => {
      engineLog.info('agents', 'Exited', { cli, code, ms: Date.now() - started })
    })
    return session
  }
}
