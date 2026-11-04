import type { LogLevel } from '@exe/protocol'

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

let level: LogLevel = 'info'
let wired = false

function bridge(): Window['executioner']['log'] | undefined {
  return (window as { executioner?: { log?: Window['executioner']['log'] } }).executioner?.log
}

/** Pick up the saved verbose switch and later changes. Safe without a preload log bridge. */
function wire(): void {
  if (wired) return
  const log = bridge()
  if (log === undefined) return
  wired = true
  try {
    void log.getVerbose().then((v) => { if (v) level = 'debug' }).catch(() => {})
    log.onLevel((l) => { level = l })
  } catch {
    // an older preload without these calls: stay at info
  }
}

function emit(lvl: LogLevel, sub: string, msg: string, data?: Record<string, unknown>): void {
  wire()
  if (ORDER[lvl] < ORDER[level]) return
  try {
    bridge()?.write({ lvl, src: `renderer/${sub}`, msg, ...(data !== undefined ? { data } : {}) })
  } catch {
    // logging must never break the UI
  }
}

export const rlog = {
  debug: (sub: string, msg: string, data?: Record<string, unknown>): void => emit('debug', sub, msg, data),
  info: (sub: string, msg: string, data?: Record<string, unknown>): void => emit('info', sub, msg, data),
  warn: (sub: string, msg: string, data?: Record<string, unknown>): void => emit('warn', sub, msg, data),
  error: (sub: string, msg: string, data?: Record<string, unknown>): void => emit('error', sub, msg, data),
}

/** Ask main to reload the secret values logs are masked with, after a secret or connection changes. */
export function refreshLogMasks(): void {
  try {
    bridge()?.refreshMasks()
  } catch {
    // no bridge
  }
}

export function errorFields(e: unknown): Record<string, unknown> {
  if (e instanceof Error) return { name: e.name, message: e.message, ...(e.stack !== undefined ? { stack: e.stack } : {}) }
  return { name: 'NonError', message: String(e) }
}

/** Log uncaught errors and unhandled rejections. */
export function installRendererErrorCapture(target: Window = window): void {
  wire()
  target.addEventListener('error', (ev) => {
    const e = ev as ErrorEvent
    const fields = e.error !== undefined && e.error !== null ? errorFields(e.error) : { name: 'Error', message: e.message }
    rlog.error('uncaught', 'Uncaught error', fields)
  })
  target.addEventListener('unhandledrejection', (ev) => {
    rlog.error('unhandledrejection', 'Unhandled promise rejection', errorFields((ev as PromiseRejectionEvent).reason))
  })
}

wire()
