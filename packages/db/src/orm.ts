import type Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { projectTables } from './tables.js'

/** The query builder every repository goes through. */
export type Orm = BetterSQLite3Database<typeof projectTables>

/**
 * An open database. `orm` belongs to the data layer: repositories are built
 * from it, and nothing outside packages/db reads it (the lint config enforces
 * that), so every query in the product lives behind a repository method.
 */
export interface ProjectDatabase {
  readonly orm: Orm
  close(): void
}

/**
 * Run `fn` as one transaction: every repository write inside it lands together,
 * or none does when it throws. Repositories that open their own transaction
 * nest inside it as savepoints.
 */
export function atomically<T>(db: ProjectDatabase, fn: () => T): T {
  return db.orm.transaction(() => fn())
}

/** Wrap an already-open better-sqlite3 handle (migration tests build their own). */
export function wrapDatabase(raw: Database.Database): ProjectDatabase {
  return {
    orm: drizzle(raw, { schema: projectTables }),
    close: () => raw.close(),
  }
}
