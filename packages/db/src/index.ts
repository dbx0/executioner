import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { migrate } from './migrate.js'
import { wrapDatabase, type ProjectDatabase } from './orm.js'
import { GLOBAL_SCHEMA_SQL } from './schema.js'

export { atomically } from './orm.js'
export type { ProjectDatabase } from './orm.js'

export function openDatabase(path: string): ProjectDatabase {
  const raw = new Database(path)
  migrate(raw)
  return wrapDatabase(raw)
}

/**
 * The user-level database shared by every engagement (connections, secrets).
 * Several engines run at once — one per open engagement — so this file is read
 * and written by several processes: WAL plus a busy timeout keeps a concurrent
 * write from failing, and each statement sees the latest committed rows, so a
 * connection saved in one workspace is listed by the next one to look.
 */
export function openGlobalDatabase(path: string): ProjectDatabase {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const raw = new Database(path)
  raw.pragma('journal_mode = WAL')
  raw.pragma('busy_timeout = 5000')
  // DDL, not a query: the user-level tables are created idempotently on open.
  raw.exec(GLOBAL_SCHEMA_SQL)
  restrictToOwner(path)
  return wrapDatabase(raw)
}

/**
 * The user-level file holds API keys and connection details in plain text, so
 * it, its WAL companions and the directory around them are the owner's alone.
 * Applied on every open, which also tightens a file an older build created
 * under the default umask. Best-effort: a filesystem without POSIX modes
 * (Windows) has nothing to set.
 */
function restrictToOwner(path: string): void {
  try {
    chmodSync(dirname(path), 0o700)
    for (const file of [path, `${path}-wal`, `${path}-shm`]) {
      if (existsSync(file)) chmodSync(file, 0o600)
    }
  } catch {
    /* no POSIX permissions here */
  }
}

export * from './schema.js'
export * from './targets.js'
export * from './scope-rules.js'
export * from './tree.js'
export * from './facts.js'
export * from './executions.js'
export * from './runs.js'
export * from './workflows.js'
export * from './findings.js'
export * from './backends.js'
export * from './secrets.js'
export * from './custom-nodes.js'
export * from './schedules.js'
export * from './saved-agents.js'
export * from './assistant.js'
export * from './overview.js'
export * from './adopt.js'
export * from './starter-workflows.js'
