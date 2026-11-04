import { writeSync } from 'node:fs'
import { Redactor, formatLine, isLogLevel, levelEnabled, type LogLevel } from '@exe/protocol'

let minLevel: LogLevel = isLogLevel(process.env.EXECUTIONER_LOG_LEVEL) ? process.env.EXECUTIONER_LOG_LEVEL : 'info'
const redactor = new Redactor()
// Refreshed wholesale by setMasks; the persistent list (addMask) survives that.
let refreshed: string[] = []
const persistent = new Set<string>()
const applyMasks = (): void => redactor.setValues([...persistent, ...refreshed])

function write(lvl: LogLevel, sub: string, msg: string, data?: Record<string, unknown>): void {
  if (!levelEnabled(minLevel, lvl)) return
  try {
    const line = redactor.redact({
      t: new Date().toISOString(),
      lvl,
      src: `engine/${sub}`,
      msg,
      ...(data !== undefined ? { data } : {}),
    })
    writeSync(2, `${formatLine(line)}\n`)
  } catch {
    /* redaction failed or stderr is gone (closed pipe); logging must never take the engine down */
  }
}

/**
 * The engine's logger: one JSON line per call on stderr, which the desktop
 * supervisor forwards (rewriting `engine/<sub>` to `engine:<id>/<sub>`).
 */
export const engineLog = {
  debug: (sub: string, msg: string, data?: Record<string, unknown>): void => write('debug', sub, msg, data),
  info: (sub: string, msg: string, data?: Record<string, unknown>): void => write('info', sub, msg, data),
  warn: (sub: string, msg: string, data?: Record<string, unknown>): void => write('warn', sub, msg, data),
  error: (sub: string, msg: string, data?: Record<string, unknown>): void => write('error', sub, msg, data),
  setLevel(level: LogLevel): void {
    minLevel = level
  },
  level: (): LogLevel => minLevel,
  setMasks(values: string[]): void {
    refreshed = values
    applyMasks()
  },
  /** Mask a value for the rest of the process, e.g. the engine's own bearer token; survives setMasks. */
  addMask(value: string): void {
    persistent.add(value)
    applyMasks()
  },
}

/** Every value that must never reach a log line: secret values and backend env values. */
export function collectMasks(project: {
  secrets: { map(): Record<string, string> }
  backends: { list(): Array<{ env?: Record<string, string> | undefined }> }
}): string[] {
  const values = new Set<string>(Object.values(project.secrets.map()))
  for (const backend of project.backends.list()) {
    for (const value of Object.values(backend.env ?? {})) values.add(value)
  }
  return [...values]
}

/** An error's name and message for a log line's data; a non-Error is stringified. */
export function errorFields(e: unknown): { name: string; message: string } {
  return e instanceof Error ? { name: e.name, message: e.message } : { name: 'NonError', message: String(e) }
}
