import * as pty from 'node-pty'
import { resolveLaunch } from './windows-launch.js'

export interface PtySessionOptions {
  command: string
  args: string[]
  cwd: string
  cols?: number
  rows?: number
  env?: Record<string, string>
  /**
   * Variables to remove from the inherited environment. `env` can only add or
   * override; this is how a caller drops something the engine process itself
   * was started with and must not pass on.
   */
  unsetEnv?: readonly string[]
  /** Bytes of recent output kept for replay on re-attach. Defaults to {@link DEFAULT_SCROLLBACK}. */
  scrollbackBytes?: number
}

/** How much recent output a session keeps so a re-attaching client can catch up. */
export const DEFAULT_SCROLLBACK = 256 * 1024

/** Unsubscribes a listener registered with {@link PtySession.onData}. */
export interface Subscription {
  dispose(): void
}

/**
 * Inherit the engine's environment, drop what the caller asked to unset, then
 * apply its overrides.
 *
 * Overrides are applied last on purpose: `unsetEnv` exists to remove values
 * *inherited* from the engine process, so a caller that explicitly passes one
 * of those keys means it — deliberately spawning a nested session, say — and
 * keeps it. Windows env lookup is case-insensitive, so match that way there or
 * an inherited `Claude_Code_Child_Session` would survive.
 */
function buildEnv(options: PtySessionOptions): Record<string, string> {
  const merged: Record<string, string | undefined> = { ...process.env }
  const caseInsensitive = process.platform === 'win32'
  for (const key of options.unsetEnv ?? []) {
    for (const present of Object.keys(merged)) {
      if (present === key || (caseInsensitive && present.toUpperCase() === key.toUpperCase())) {
        delete merged[present]
      }
    }
  }
  return { ...merged, ...options.env } as Record<string, string>
}

/**
 * One PTY-backed process. Thin wrapper over node-pty with a stable interface.
 *
 * The session keeps a bounded tail of its own output. A client that attaches
 * later — the desktop remounts a terminal whenever its engagement tab is
 * switched away from and back — would otherwise see a blank screen and only
 * whatever the process happens to print next, because a PTY has no history of
 * its own to hand over.
 */
export class PtySession {
  private readonly proc: pty.IPty
  private readonly scrollbackBytes: number
  /** Recent output, trimmed from the front once it exceeds the cap. */
  private scrollback = ''

  constructor(options: PtySessionOptions) {
    this.scrollbackBytes = options.scrollbackBytes ?? DEFAULT_SCROLLBACK
    const env = buildEnv(options)
    // On Windows a bare agent name has to become a full path first (see
    // resolveLaunch); elsewhere this hands the command back unchanged.
    const launch = resolveLaunch(options.command, options.args, env)
    this.proc = pty.spawn(launch.command, launch.args, {
      name: 'xterm-color',
      cols: options.cols ?? 80,
      rows: options.rows ?? 30,
      cwd: options.cwd,
      env,
    })
    // Recording starts with the process, so output produced before any client
    // attaches is still there when one does.
    this.proc.onData((data) => this.record(data))
  }

  /**
   * Append to the replay tail, dropping whole lines off the front when over the
   * cap. Cutting at a newline keeps an escape sequence from being sliced in
   * half, which would otherwise leave the reattaching terminal in a broken
   * state; a single line longer than the cap is hard-cut as a last resort.
   */
  private record(data: string): void {
    this.scrollback += data
    if (this.scrollback.length <= this.scrollbackBytes) return
    const excess = this.scrollback.length - this.scrollbackBytes
    const cut = this.scrollback.indexOf('\n', excess)
    this.scrollback = cut === -1 ? this.scrollback.slice(excess) : this.scrollback.slice(cut + 1)
  }

  /**
   * The recent output a newly attached client should be shown before live data.
   * Take this and subscribe in the same synchronous block: nothing can arrive
   * between the two, so the client sees no gap and no duplication.
   */
  snapshot(): string {
    return this.scrollback
  }

  get pid(): number {
    return this.proc.pid
  }

  /** Subscribe to live output. Dispose to stop listening — a socket that closes
   *  must unsubscribe, or every re-attach leaves another dead listener behind. */
  onData(listener: (data: string) => void): Subscription {
    return this.proc.onData(listener)
  }

  onExit(listener: (exitCode: number) => void): void {
    this.proc.onExit(({ exitCode }) => listener(exitCode))
  }

  write(data: string): void {
    this.proc.write(data)
  }

  resize(cols: number, rows: number): void {
    this.proc.resize(cols, rows)
  }

  kill(): void {
    this.proc.kill()
  }
}
