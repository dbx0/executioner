import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { wrapDatabase } from './orm.js'
import { TargetRepository } from './targets.js'

/**
 * A project database in the shape version 3 left behind, carrying the damage
 * found in the real SMARTFIT engagement: hosts filed under two kinds, an apex
 * filed as a subdomain, and facts and findings split across the copies.
 */
function legacyDatabase(): Database.Database {
  const raw = new Database(':memory:')
  raw.exec(`
    CREATE TABLE targets (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, value TEXT NOT NULL,
      parent_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
      source TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
      UNIQUE (kind, value)
    );
    CREATE TABLE target_facts (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, execution_id TEXT, node_id TEXT,
      collected_at TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE findings (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, severity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', description TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
      source TEXT NOT NULL DEFAULT 'manual', execution_id TEXT, node_id TEXT,
      evidence_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (3);
  `)

  const target = raw.prepare(
    'INSERT INTO targets (id, kind, value, parent_id, source, first_seen, last_seen) VALUES (?,?,?,?,?,?,?)',
  )
  // The same host, filed twice — the older row as a domain, the newer as a subdomain.
  target.run('dup-domain', 'domain', 'api-bf.bioritmo.com.br', null, 'agent', '2026-09-01', '2026-09-01')
  target.run('dup-sub', 'subdomain', 'api-bf.bioritmo.com.br', null, 'agent', '2026-09-05', '2026-09-05')
  // An apex filed as a subdomain, with a real subdomain orphaned beside it.
  target.run('apex', 'subdomain', 'smartfit.com.br', null, 'manual', '2026-09-01', '2026-09-01')
  target.run('sub', 'subdomain', 'app.smartfit.com.br', null, 'sub_nmap', '2026-09-02', '2026-09-02')
  // A third party's url nobody vouched for, and an unvalidated address.
  target.run('stray', 'url', 'https://qrfo5.appsync-api.us-east-1.amazonaws.com/graphql', null, 'agent', '2026-09-03', '2026-09-03')
  target.run('addr', 'ip', '54.234.85.144', null, 'agent', '2026-09-03', '2026-09-03')

  raw.prepare('INSERT INTO target_facts (id, target_id, kind, collected_at, data) VALUES (?,?,?,?,?)')
    .run('fact-on-loser', 'dup-sub', 'port', '2026-09-05', '{}')
  raw.prepare(
    'INSERT INTO findings (id, title, severity, target_id, created_at, updated_at) VALUES (?,?,?,?,?,?)',
  ).run('finding-on-loser', 'checkDocument PII', 'high', 'dup-sub', '2026-09-05', '2026-09-05')

  return raw
}

describe('migrate — repairing a version 3 target tree', () => {
  it('merges a host that was filed under two kinds into one row', () => {
    const raw = legacyDatabase()
    migrate(raw)

    const rows = raw
      .prepare("SELECT id, kind FROM targets WHERE value = 'api-bf.bioritmo.com.br'")
      .all() as { id: string; kind: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('subdomain')
  })

  it('keeps the oldest row as the survivor so first_seen is not lost', () => {
    const raw = legacyDatabase()
    migrate(raw)
    const row = raw
      .prepare("SELECT id, first_seen FROM targets WHERE value = 'api-bf.bioritmo.com.br'")
      .get() as { id: string; first_seen: string }
    expect(row.id).toBe('dup-domain')
    expect(row.first_seen).toBe('2026-09-01')
  })

  it('carries facts from a merged-away copy onto the survivor', () => {
    const raw = legacyDatabase()
    migrate(raw)
    const fact = raw.prepare("SELECT target_id FROM target_facts WHERE id = 'fact-on-loser'").get() as {
      target_id: string
    }
    expect(fact.target_id).toBe('dup-domain')
  })

  it('carries findings from a merged-away copy onto the survivor', () => {
    const raw = legacyDatabase()
    migrate(raw)
    const finding = raw.prepare("SELECT target_id FROM findings WHERE id = 'finding-on-loser'").get() as {
      target_id: string
    }
    expect(finding.target_id).toBe('dup-domain')
  })

  it('corrects an apex that had been filed as a subdomain', () => {
    const raw = legacyDatabase()
    migrate(raw)
    const row = raw.prepare("SELECT kind, apex, parent_id FROM targets WHERE value = 'smartfit.com.br'").get() as {
      kind: string
      apex: string
      parent_id: string | null
    }
    expect(row.kind).toBe('domain')
    expect(row.apex).toBe('smartfit.com.br')
    expect(row.parent_id).toBeNull()
  })

  it('re-parents an orphaned subdomain under its apex', () => {
    const raw = legacyDatabase()
    migrate(raw)
    const row = raw.prepare("SELECT parent_id FROM targets WHERE value = 'app.smartfit.com.br'").get() as {
      parent_id: string | null
    }
    expect(row.parent_id).toBe('apex')
  })

  it('creates the missing apex a merged host needs as a parent', () => {
    const raw = legacyDatabase()
    migrate(raw)
    const apex = raw.prepare("SELECT id, source FROM targets WHERE value = 'bioritmo.com.br'").get() as
      | { id: string; source: string }
      | undefined
    expect(apex?.source).toBe('derived')

    const host = raw.prepare("SELECT parent_id FROM targets WHERE value = 'api-bf.bioritmo.com.br'").get() as {
      parent_id: string
    }
    expect(host.parent_id).toBe(apex?.id)
  })

  it('parents a url under the host it lives on', () => {
    const raw = legacyDatabase()
    migrate(raw)
    const host = raw
      .prepare("SELECT id FROM targets WHERE value = 'qrfo5.appsync-api.us-east-1.amazonaws.com'")
      .get() as { id: string } | undefined
    const url = raw.prepare("SELECT parent_id FROM targets WHERE id = 'stray'").get() as {
      parent_id: string | null
    }
    expect(url.parent_id).toBe(host?.id)
  })

  it('marks everything unknown, inventing no boundary the operator did not set', () => {
    const raw = legacyDatabase()
    migrate(raw)
    const statuses = raw.prepare('SELECT DISTINCT scope_status FROM targets').all() as {
      scope_status: string
    }[]
    expect(statuses).toEqual([{ scope_status: 'unknown' }])
  })

  it('leaves the tree able to take new writes through the repository', () => {
    const raw = legacyDatabase()
    migrate(raw)
    const repo = new TargetRepository(wrapDatabase(raw))
    const again = repo.upsert({ kind: 'domain', value: 'api-bf.bioritmo.com.br', source: 'agent' })
    expect(again.id).toBe('dup-domain')
  })

  it('is idempotent when the migration runs a second time', () => {
    const raw = legacyDatabase()
    migrate(raw)
    const before = raw.prepare('SELECT count(*) as n FROM targets').get() as { n: number }
    migrate(raw)
    const after = raw.prepare('SELECT count(*) as n FROM targets').get() as { n: number }
    expect(after.n).toBe(before.n)
  })
})

describe('migrate — deriving parents all the way up', () => {
  /** A v3 tree holding nothing but a url on a host several labels deep. */
  function urlOnlyDatabase(): Database.Database {
    const raw = new Database(':memory:')
    raw.exec(`
      CREATE TABLE targets (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, value TEXT NOT NULL,
        parent_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
        source TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
        UNIQUE (kind, value)
      );
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (3);
    `)
    raw.prepare(
      'INSERT INTO targets (id, kind, value, parent_id, source, first_seen, last_seen) VALUES (?,?,?,?,?,?,?)',
    ).run('u', 'url', 'https://a.b.example.com/graphql', null, 'agent', '2026-09-01', '2026-09-01')
    return raw
  }

  it('derives the host a url lives on and that host\'s apex too', () => {
    const raw = urlOnlyDatabase()
    migrate(raw)

    const host = raw.prepare("SELECT id, kind, parent_id FROM targets WHERE value = 'a.b.example.com'").get() as
      | { id: string; kind: string; parent_id: string | null }
      | undefined
    const apex = raw.prepare("SELECT id, kind FROM targets WHERE value = 'example.com'").get() as
      | { id: string; kind: string }
      | undefined

    expect(host?.kind).toBe('subdomain')
    expect(apex?.kind).toBe('domain')
    // The chain is url -> host -> apex, with nothing dangling at the root.
    expect(host?.parent_id).toBe(apex?.id)
    expect(raw.prepare("SELECT parent_id FROM targets WHERE id = 'u'").get()).toEqual({ parent_id: host?.id })
  })

  it('leaves only true apexes at the root', () => {
    const raw = urlOnlyDatabase()
    migrate(raw)
    const roots = raw.prepare('SELECT value FROM targets WHERE parent_id IS NULL').all() as { value: string }[]
    expect(roots).toEqual([{ value: 'example.com' }])
  })

  it('rewrites a url to its canonical form without losing the row', () => {
    const raw = new Database(':memory:')
    raw.exec(`
      CREATE TABLE targets (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, value TEXT NOT NULL,
        parent_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
        source TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
        UNIQUE (kind, value)
      );
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (3);
    `)
    raw.prepare(
      'INSERT INTO targets (id, kind, value, parent_id, source, first_seen, last_seen) VALUES (?,?,?,?,?,?,?)',
    ).run('u', 'url', 'https://bapp-oicdb-cron.bioritmo.io', null, 'agent', '2026-09-01', '2026-09-01')

    migrate(raw)

    // The empty path becomes '/', but it is the same row: same id, so whatever
    // was attached to it stays attached.
    const row = raw.prepare("SELECT value FROM targets WHERE id = 'u'").get() as { value: string }
    expect(row.value).toBe('https://bapp-oicdb-cron.bioritmo.io/')
  })
})
