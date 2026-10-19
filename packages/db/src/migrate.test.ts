import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { SCHEMA_VERSION } from './schema.js'

/**
 * A migrated database as a raw handle. These tests inspect the schema itself,
 * so they read it below the repositories; nothing outside packages/db can.
 */
function openMigrated(path: string): { raw: Database.Database; close: () => void } {
  const raw = new Database(path)
  migrate(raw)
  return { raw, close: () => raw.close() }
}

describe('migrate on open', () => {
  it('creates every table on a fresh in-memory database', () => {
    const { raw, close } = openMigrated(':memory:')
    const rows = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const names = rows.map((r) => r.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'executions',
        'meta',
        'node_executions',
        'schema_version',
        'target_facts',
        'targets',
        'workflows',
      ]),
    )
    close()
  })

  it('is idempotent when opened twice against the same file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'exe-db-'))
    const path = join(dir, 'project.sqlite')

    const first = openMigrated(path)
    first.raw
      .prepare("INSERT INTO targets (id, kind, value, parent_id, source, first_seen, last_seen) VALUES (?,?,?,?,?,?,?)")
      .run('a', 'domain', 'example.com', null, 'manual', 'now', 'now')
    first.close()

    const second = openMigrated(path)
    const version = second.raw.prepare('SELECT version FROM schema_version').get() as { version: number }
    expect(version.version).toBe(SCHEMA_VERSION)
    const rows = second.raw.prepare('SELECT count(*) as n FROM schema_version').get() as { n: number }
    expect(rows.n).toBe(1)
    const targets = second.raw.prepare('SELECT count(*) as n FROM targets').get() as { n: number }
    expect(targets.n).toBe(1)
    second.close()

    rmSync(dir, { recursive: true, force: true })
  })

  it('enforces uniqueness of kind and value on targets', () => {
    const { raw, close } = openMigrated(':memory:')
    const insert = raw.prepare(
      "INSERT INTO targets (id, kind, value, parent_id, source, first_seen, last_seen) VALUES (?,?,?,?,?,?,?)",
    )
    insert.run('a', 'domain', 'example.com', null, 'manual', 'now', 'now')
    expect(() => insert.run('b', 'domain', 'example.com', null, 'manual', 'now', 'now')).toThrow()
    close()
  })

  it('turns foreign keys on even when they start disabled', () => {
    const raw = new Database(':memory:')
    raw.pragma('foreign_keys = OFF')
    expect(
      (raw.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys,
    ).toBe(0)
    migrate(raw)
    expect(
      (raw.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys,
    ).toBe(1)
    raw.close()
  })
})

/** An engagement as an older build wrote it: workflows local, and referenced. */
function openLegacyDatabase(): InstanceType<typeof Database> {
  const raw = new Database(':memory:')
  raw.exec(`
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (1);
    CREATE TABLE targets (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, value TEXT NOT NULL,
      parent_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
      source TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
      UNIQUE (kind, value)
    );
    CREATE TABLE workflows (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, graph TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'local', registry_ref TEXT, version TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE executions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT REFERENCES workflows(id) ON DELETE CASCADE,
      target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
      status TEXT NOT NULL, backend TEXT NOT NULL DEFAULT 'local',
      test_mode INTEGER NOT NULL DEFAULT 0,
      started_at TEXT, finished_at TEXT, error TEXT
    );
    CREATE TABLE node_executions (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
      node_id TEXT NOT NULL, status TEXT NOT NULL, exit_code INTEGER,
      stdout_path TEXT, stderr_path TEXT, parsed_output TEXT,
      started_at TEXT, finished_at TEXT
    );
    CREATE TABLE schedules (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
      kind TEXT NOT NULL, interval_seconds INTEGER, target_kind TEXT,
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    INSERT INTO workflows (id, name, graph, created_at, updated_at) VALUES ('wf-1','recon','{}','t','t');
    INSERT INTO executions (id, workflow_id, status) VALUES ('ex-1','wf-1','ok');
    INSERT INTO node_executions (id, execution_id, node_id, status) VALUES ('ne-1','ex-1','a','ok');
    INSERT INTO schedules (id, workflow_id, kind, created_at) VALUES ('sc-1','wf-1','interval','t');
  `)
  return raw
}

describe('migrating an engagement to user-level workflows', () => {
  it('frees runs and schedules from the workflow foreign key, keeping their rows', () => {
    const raw = openLegacyDatabase()
    migrate(raw)

    const fks = (table: string): string[] =>
      (raw.prepare(`PRAGMA foreign_key_list(${table})`).all() as { table: string }[]).map((f) => f.table)
    expect(fks('executions')).not.toContain('workflows')
    expect(fks('schedules')).not.toContain('workflows')
    // The target reference is the one that still makes sense locally.
    expect(fks('executions')).toContain('targets')

    expect(raw.prepare('SELECT workflow_id FROM executions WHERE id = ?').get('ex-1')).toEqual({ workflow_id: 'wf-1' })
    expect(raw.prepare('SELECT count(*) AS n FROM node_executions').get()).toEqual({ n: 1 })
    expect(raw.prepare('SELECT count(*) AS n FROM schedules').get()).toEqual({ n: 1 })
    expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    raw.close()
  })

  it('records a run of a workflow that is no longer stored here', () => {
    const raw = openLegacyDatabase()
    migrate(raw)
    expect(() =>
      raw.prepare('INSERT INTO executions (id, workflow_id, status) VALUES (?,?,?)').run('ex-2', 'wf-global', 'ok'),
    ).not.toThrow()
    raw.close()
  })

  it('still cascades a deleted execution to its node rows', () => {
    const raw = openLegacyDatabase()
    migrate(raw)
    raw.prepare('DELETE FROM executions WHERE id = ?').run('ex-1')
    expect(raw.prepare('SELECT count(*) AS n FROM node_executions').get()).toEqual({ n: 0 })
    raw.close()
  })

  it('leaves an already-migrated database alone', () => {
    const raw = openLegacyDatabase()
    migrate(raw)
    migrate(raw)
    expect(raw.prepare('SELECT count(*) AS n FROM executions').get()).toEqual({ n: 1 })
    expect(raw.prepare('SELECT version FROM schema_version').get()).toEqual({ version: SCHEMA_VERSION })
    raw.close()
  })
})

/** An engagement whose findings are still the three-column stub. */
function openLegacyFindings(): InstanceType<typeof Database> {
  const raw = new Database(':memory:')
  raw.exec(`
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (2);
    CREATE TABLE targets (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, value TEXT NOT NULL,
      parent_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
      source TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
      UNIQUE (kind, value)
    );
    CREATE TABLE findings (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      evidence_path TEXT,
      created_at TEXT NOT NULL
    );
    INSERT INTO targets (id, kind, value, parent_id, source, first_seen, last_seen)
      VALUES ('t1', 'domain', 'example.com', NULL, 'manual', 'then', 'then');
    INSERT INTO findings (id, target_id, severity, title, evidence_path, created_at)
      VALUES ('f1', 't1', 'high', 'Open admin panel', '/ev/f1.txt', 'then');
  `)
  return raw
}

describe('migrating findings into a record you can triage', () => {
  it('keeps the rows and fills in the new fields', () => {
    const raw = openLegacyFindings()
    migrate(raw)

    const row = raw.prepare('SELECT * FROM findings WHERE id = ?').get('f1') as Record<string, unknown>
    expect(row).toMatchObject({
      id: 'f1',
      title: 'Open admin panel',
      severity: 'high',
      status: 'open',
      description: '',
      details: '',
      target_id: 't1',
      // MCP add_finding was the only writer that existed.
      source: 'agent',
      evidence_path: '/ev/f1.txt',
      created_at: 'then',
      updated_at: 'then',
    })
    raw.close()
  })

  it('records a finding that has no target at all', () => {
    const raw = openLegacyFindings()
    migrate(raw)
    expect(() =>
      raw
        .prepare('INSERT INTO findings (id, title, severity, status, description, details, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run('f2', 'Scope note', 'info', 'open', '', '', 'manual', 'now', 'now'),
    ).not.toThrow()
    raw.close()
  })

  it('keeps a finding when its target is deleted, rather than cascading it away', () => {
    const raw = openLegacyFindings()
    migrate(raw)

    raw.prepare('DELETE FROM targets WHERE id = ?').run('t1')

    const row = raw.prepare('SELECT target_id FROM findings WHERE id = ?').get('f1')
    expect(row).toEqual({ target_id: null })
    raw.close()
  })

  it('leaves an already-migrated database alone', () => {
    const raw = openLegacyFindings()
    migrate(raw)
    raw.prepare('UPDATE findings SET status = ? WHERE id = ?').run('confirmed', 'f1')
    migrate(raw)
    expect(raw.prepare('SELECT status FROM findings WHERE id = ?').get('f1')).toEqual({ status: 'confirmed' })
    raw.close()
  })
})
