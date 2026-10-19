import Database from 'better-sqlite3'
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { GLOBAL_SCHEMA_SQL } from './schema.js'
import { globalTables, projectTables } from './tables.js'

interface LiveColumn {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

/** How SQLite reports a Drizzle default in `PRAGMA table_info`. */
function sqlDefault(value: unknown): string | null {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return String(value)
  return `'${String(value)}'`
}

/** One table's shape as Drizzle declares it, in the vocabulary of the PRAGMAs. */
function declared(table: SQLiteTable) {
  const config = getTableConfig(table)
  return {
    columns: config.columns
      .map((c) => ({
        name: c.name,
        type: c.getSQLType().toUpperCase(),
        notnull: c.notNull ? 1 : 0,
        dflt_value: sqlDefault(c.default),
        pk: c.primary ? 1 : 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    indexes: config.indexes
      .map((i) => ({ name: i.config.name, columns: i.config.columns.map((c) => (c as { name: string }).name) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    foreignKeys: config.foreignKeys
      .map((fk) => {
        const ref = fk.reference()
        return {
          from: ref.columns.map((c) => c.name).join(','),
          table: getTableConfig(ref.foreignTable).name,
          to: ref.foreignColumns.map((c) => c.name).join(','),
          on_delete: (fk.onDelete ?? 'no action').toUpperCase(),
        }
      })
      .sort((a, b) => a.from.localeCompare(b.from)),
    unique: [
      ...config.columns.filter((c) => c.isUnique).map((c) => c.name),
      ...config.uniqueConstraints.map((u) => u.columns.map((c) => c.name).join(',')),
    ].sort(),
  }
}

/** The same table as the live database reports it. */
function live(raw: Database.Database, name: string) {
  const columns = (raw.prepare(`PRAGMA table_info(${name})`).all() as LiveColumn[])
    .map(({ name: n, type, notnull, dflt_value, pk }) => ({
      name: n,
      type,
      // SQLite reports a PRIMARY KEY column as nullable; Drizzle as not-null.
      notnull: pk > 0 ? 1 : notnull,
      dflt_value,
      pk: pk > 0 ? 1 : 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const indexList = raw.prepare(`PRAGMA index_list(${name})`).all() as { name: string; unique: number; origin: string }[]
  const columnsOf = (index: string): string[] =>
    (raw.prepare(`PRAGMA index_info(${index})`).all() as { name: string }[]).map((c) => c.name)
  const indexes = indexList
    .filter((i) => i.origin === 'c')
    .map((i) => ({ name: i.name, columns: columnsOf(i.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const unique = indexList
    .filter((i) => i.origin === 'u')
    .map((i) => columnsOf(i.name).join(','))
    .sort()
  const foreignKeys = (
    raw.prepare(`PRAGMA foreign_key_list(${name})`).all() as { from: string; table: string; to: string; on_delete: string }[]
  )
    .map(({ from, table, to, on_delete }) => ({ from, table, to, on_delete }))
    .sort((a, b) => a.from.localeCompare(b.from))
  return { columns, indexes, foreignKeys, unique }
}

describe('drizzle table definitions', () => {
  const raw = new Database(':memory:')
  migrate(raw)

  for (const table of Object.values(projectTables)) {
    const name = getTableConfig(table).name
    it(`mirror the project table ${name}`, () => {
      expect(declared(table)).toEqual(live(raw, name))
    })
  }

  it('cover every table the project schema creates', () => {
    const created = (
      raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]
    ).map((r) => r.name)
    const declaredNames = Object.values(projectTables)
      .map((t) => getTableConfig(t).name)
      .sort()
    expect(declaredNames).toEqual(created)
  })

  it('mirror the user-level database', () => {
    const global = new Database(':memory:')
    global.exec(GLOBAL_SCHEMA_SQL)
    for (const table of Object.values(globalTables)) {
      expect(declared(table)).toEqual(live(global, getTableConfig(table).name))
    }
  })
})
