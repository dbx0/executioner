import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { LogLevel } from '@exe/protocol'

export interface LoggingSettings {
  verbose: boolean
}

/** The saved logging setting (`<globalDir>/logging.json`); a missing or unreadable file means verbose off. */
export function readLoggingSettings(file: string): LoggingSettings {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return { verbose: typeof value === 'object' && value !== null && (value as { verbose?: unknown }).verbose === true }
  } catch {
    return { verbose: false }
  }
}

export function writeLoggingSettings(file: string, settings: LoggingSettings): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ verbose: settings.verbose })}\n`)
}

/** The level this session runs at: the saved switch, or `--verbose` / `EXECUTIONER_VERBOSE=1` for this launch only. */
export function effectiveLevel(saved: LoggingSettings, argv: string[], env: NodeJS.ProcessEnv): LogLevel {
  return saved.verbose || argv.includes('--verbose') || env.EXECUTIONER_VERBOSE === '1' ? 'debug' : 'info'
}

interface EngineTarget {
  port: number
  token: string
  projectRoot: string
}

type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>

/** Tell each running engine the new level over its bearer-guarded route; a failure is reported, never thrown. */
export async function pushEngineLevel(
  conns: EngineTarget[],
  level: LogLevel,
  fetchFn: FetchFn,
  onFail: (conn: EngineTarget, error: string) => void,
): Promise<void> {
  await Promise.all(
    conns.map(async (conn) => {
      try {
        const res = await fetchFn(`http://127.0.0.1:${conn.port}/api/log-level`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${conn.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ level }),
        })
        if (!res.ok) onFail(conn, `status ${res.status}`)
      } catch (err) {
        onFail(conn, err instanceof Error ? err.message : String(err))
      }
    }),
  )
}
