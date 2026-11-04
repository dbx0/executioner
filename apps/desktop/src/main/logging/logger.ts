import { formatLine, isLogLevel, levelEnabled, Redactor } from '@exe/protocol'
import type { LogLevel, LogLine } from '@exe/protocol'

/** Where written lines go; a SessionLog, or a no-op when the log file could not be opened. */
export interface LogSink {
  write(line: LogLine): void
}

export interface MainLoggerOptions {
  session: LogSink
  /** How long to hold lines for the first mask list before writing them with pattern redaction only. */
  maskTimeoutMs?: number
}

const DEFAULT_MASK_TIMEOUT_MS = 5000
/** A runaway producer before the masks load must not grow memory without bound. */
const MAX_BUFFERED = 5000
/** Renderer lines larger than this, serialised, are dropped. */
export const RENDERER_LINE_CAP = 16 * 1024

/**
 * The main process's logger. Every line it writes, its own, the renderer's and
 * forwarded engine lines, passes through one Redactor holding the known secret
 * values (from `log-masks`) plus every engine bearer token. Until the first mask
 * list arrives, lines wait in memory so a secret is never written unmasked.
 */
export class MainLogger {
  private readonly session: LogSink
  private readonly redactor = new Redactor()
  private min: LogLevel = 'info'
  private masks: string[] = []
  private readonly tokens: string[] = []
  private ready = false
  private buffer: LogLine[] = []
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(opts: MainLoggerOptions) {
    this.session = opts.session
    this.timer = setTimeout(() => this.flushUnmasked('timeout'), opts.maskTimeoutMs ?? DEFAULT_MASK_TIMEOUT_MS)
    // The wait must never keep the process alive on its own.
    this.timer.unref?.()
  }

  log(line: Omit<LogLine, 't'> & { t?: string }): void {
    try {
      if (!levelEnabled(this.min, line.lvl)) return
      const full: LogLine = { ...line, t: line.t ?? new Date().toISOString() }
      if (!this.ready) {
        if (this.buffer.length < MAX_BUFFERED) this.buffer.push(full)
        return
      }
      this.write(full)
    } catch {
      /* logging must never throw into the app */
    }
  }

  debug(src: string, msg: string, data?: Record<string, unknown>): void {
    if (this.min !== 'debug') return
    this.log(data === undefined ? { lvl: 'debug', src, msg } : { lvl: 'debug', src, msg, data })
  }

  info(src: string, msg: string, data?: Record<string, unknown>): void {
    this.log(data === undefined ? { lvl: 'info', src, msg } : { lvl: 'info', src, msg, data })
  }

  warn(src: string, msg: string, data?: Record<string, unknown>): void {
    this.log(data === undefined ? { lvl: 'warn', src, msg } : { lvl: 'warn', src, msg, data })
  }

  error(src: string, msg: string, data?: Record<string, unknown>): void {
    this.log(data === undefined ? { lvl: 'error', src, msg } : { lvl: 'error', src, msg, data })
  }

  setLevel(level: LogLevel): void {
    this.min = level
  }

  level(): LogLevel {
    return this.min
  }

  /** Replace the known secret values; the first call releases the held lines. */
  setMasks(values: string[]): void {
    this.masks = values
    this.redactor.setValues([...this.masks, ...this.tokens])
    this.release()
  }

  /** Mask one more value for good, e.g. an engine's bearer token from its handshake. */
  addMask(value: string): void {
    this.tokens.push(value)
    this.redactor.setValues([...this.masks, ...this.tokens])
  }

  /** Write the held lines now with pattern and field redaction only (mask list late, failed, or the process is dying). */
  flushUnmasked(reason: string): void {
    if (this.ready) return
    this.release()
    this.write({
      t: new Date().toISOString(),
      lvl: 'warn',
      src: 'main/logging',
      msg: 'Known-value masking is unavailable for this session',
      data: { reason },
    })
  }

  private release(): void {
    if (this.ready) return
    this.ready = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    const held = this.buffer
    this.buffer = []
    for (const line of held) this.write(line)
  }

  private write(line: LogLine): void {
    try {
      this.session.write(this.redactor.redact(line))
    } catch {
      /* logging must never throw into the app */
    }
  }
}

const RENDERER_SRC = /^renderer\/[A-Za-z0-9._-]{1,64}$/

/** Validate a line the renderer sent; null when it is malformed or too large. Its source is always the renderer's. */
export function rendererLine(req: unknown): LogLine | null {
  if (typeof req !== 'object' || req === null || Array.isArray(req)) return null
  const r = req as Record<string, unknown>
  if (!isLogLevel(r.lvl) || typeof r.msg !== 'string') return null
  if (r.data !== undefined && (typeof r.data !== 'object' || r.data === null || Array.isArray(r.data))) return null
  const src = typeof r.src === 'string' && RENDERER_SRC.test(r.src) ? r.src : 'renderer'
  const line: LogLine = { t: new Date().toISOString(), lvl: r.lvl, src, msg: r.msg }
  if (r.data !== undefined) line.data = r.data as Record<string, unknown>
  let text: string
  try {
    text = formatLine(line)
  } catch {
    // Circular or otherwise unserialisable data.
    return null
  }
  return Buffer.byteLength(text) > RENDERER_LINE_CAP ? null : line
}

let active: MainLogger | undefined

/** The app's logger, for modules that are not handed one (embedded browser pages). */
export function mainLogger(): MainLogger | undefined {
  return active
}

export function setMainLogger(logger: MainLogger): void {
  active = logger
}
