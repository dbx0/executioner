import { Hono } from 'hono'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { EngineEvent, EventBus } from '../transport/events.js'

/** Cap on lines held in the in-memory ring buffer. */
const DEFAULT_BUFFER = 500
/** Default number of recent lines returned. */
const DEFAULT_TAIL = 200
/** Upper bound on ?limit so a client can't ask for an unbounded slice. */
const MAX_TAIL = 2000
/** Never read a log file larger than this (bytes) — a crude tail guard. */
const MAX_FILE_BYTES = 4 * 1024 * 1024

export interface LogsRoutesOptions {
  bus: EventBus
  /**
   * Absolute path to an engine log file to tail. Comes from engine config/env,
   * never from the request. When unset (the current desktop supervisor captures
   * engine stdout/stderr in memory, not to a file), the route serves the
   * in-memory ring buffer of recent engine events instead.
   */
  logFile?: string | undefined
  /** Ring-buffer capacity (in-memory source). */
  bufferSize?: number
}

/** Render one engine event as a single readable log line. */
function formatEvent(e: EngineEvent): string {
  const where = e.nodeId === '' ? e.executionId : `${e.executionId}/${e.nodeId}`
  const data = e.data.replace(/\s+$/, '')
  return `${e.at} [${e.type}] ${where}${data === '' ? '' : ` ${data}`}`
}

/**
 * Resolve and validate a configured log-file path before any read. The path is
 * operator-supplied (not from the request), but we still guard it: it must be
 * absolute, exist, resolve (via realpath, defeating symlink surprises) to a
 * regular file, and stay under a size cap. Anything else yields undefined and
 * the route falls back to the in-memory buffer.
 */
function safeLogFile(path: string): string | undefined {
  try {
    if (!isAbsolute(path) || !existsSync(path)) return undefined
    const real = realpathSync(path)
    const st = statSync(real)
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return undefined
    return real
  } catch {
    return undefined
  }
}

/** Read the last `limit` lines of a (small, already size-guarded) log file. */
function tailFile(path: string, limit: number): string[] {
  const text = readFileSync(path, 'utf8')
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.slice(-limit)
}

/**
 * Recent engine logs, bearer-guarded (mounted under /api). Source, in order of
 * preference: a configured engine log file (tailed, path-guarded), otherwise a
 * ring buffer of recent engine events accumulated in memory since boot.
 *
 * GET /logs?limit=200 → { source: 'file' | 'events' | 'empty', lines: string[] }
 */
export function logsRoutes(options: LogsRoutesOptions): Hono {
  const app = new Hono()
  const cap = options.bufferSize ?? DEFAULT_BUFFER
  // The configured path may come from the environment so the desktop supervisor
  // can opt into file-backed logs without a signature change.
  const configuredFile = options.logFile ?? process.env.EXE_ENGINE_LOG_FILE

  // Accumulate recent events regardless of source so the buffer is warm if the
  // file ever disappears mid-session.
  const ring: string[] = []
  options.bus.subscribe((e) => {
    ring.push(formatEvent(e))
    if (ring.length > cap) ring.splice(0, ring.length - cap)
  })

  app.get('/logs', (c) => {
    const raw = Number(c.req.query('limit'))
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), MAX_TAIL) : DEFAULT_TAIL

    const file = configuredFile !== undefined && configuredFile !== '' ? safeLogFile(configuredFile) : undefined
    if (file !== undefined) {
      try {
        return c.json({ source: 'file' as const, lines: tailFile(file, limit) })
      } catch {
        /* fall through to the in-memory buffer */
      }
    }

    if (ring.length > 0) {
      return c.json({ source: 'events' as const, lines: ring.slice(-limit) })
    }
    return c.json({ source: 'empty' as const, lines: [] as string[] })
  })

  return app
}
