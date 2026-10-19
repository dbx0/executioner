import type { Database } from 'better-sqlite3'
import { canonicaliseAsset, isCanonicalAsset, isoNow, newId } from '@exe/protocol'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js'

/**
 * Bring a project database to the current schema.
 *
 * This file is the one place in the data layer that speaks SQL directly, and
 * deliberately so: it is DDL and one-off data migration, not querying. Each
 * step is written against the exact table shape an older build left behind
 * (which the Drizzle definitions in tables.ts no longer describe), and the
 * rebuilds follow SQLite's own alter-table procedure, which needs PRAGMAs and
 * statement-level control Drizzle's query builder does not offer. Every value
 * a step writes is still a bound parameter; the only interpolated names are
 * the fixed table and column identifiers below.
 */
export function migrate(raw: Database): void {
  raw.pragma('journal_mode = WAL')
  raw.pragma('foreign_keys = ON')
  // Before the schema runs: it indexes columns the old findings table does not
  // have yet, so the table has to reach its current shape first.
  widenFindings(raw)
  // Before the schema runs too: it declares targets.value UNIQUE, which an old
  // tree carrying one host under two kinds cannot satisfy until they are merged.
  rebuildTargets(raw)
  raw.exec(SCHEMA_SQL)
  addColumnIfMissing(raw, 'saved_agents', 'members', 'TEXT')
  // The params a single-node run was started with, as JSON. Standalone runs
  // replay from this; rows written before it exists simply carry NULL.
  addColumnIfMissing(raw, 'node_executions', 'params', 'TEXT')
  // The saved connection a standalone run used, so a replay picks that exact
  // profile back rather than the first one of the same kind.
  addColumnIfMissing(raw, 'node_executions', 'backend_profile_id', 'TEXT')
  dropWorkflowForeignKeys(raw)

  const row = raw.prepare('SELECT version FROM schema_version').get() as
    | { version: number }
    | undefined

  if (row === undefined) {
    raw.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION)
    return
  }

  if (row.version > SCHEMA_VERSION) {
    throw new Error(
      `Project database is version ${row.version}, this build understands ${SCHEMA_VERSION}. Upgrade Executioner.`,
    )
  }

  if (row.version < SCHEMA_VERSION) {
    raw.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION)
  }
}

/** True when the database has a table of this name. */
function tableExists(raw: Database, table: string): boolean {
  const row = raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined
  return row !== undefined
}

/**
 * Add a nullable column to an existing table when it is missing. Additive and
 * idempotent, so a DB created before the column gains it on next open without a
 * schema-version bump (the column is optional everywhere it's read).
 */
function addColumnIfMissing(raw: Database, table: string, column: string, type: string): void {
  const cols = raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) {
    raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
}

/** True when `table` still declares a foreign key into the local workflows table. */
function referencesWorkflows(raw: Database, table: string): boolean {
  const fks = raw.prepare(`PRAGMA foreign_key_list(${table})`).all() as { table: string }[]
  return fks.some((f) => f.table === 'workflows')
}

const EXECUTIONS_REBUILD = `
CREATE TABLE executions_new (
  id          TEXT PRIMARY KEY,
  workflow_id TEXT,
  target_id   TEXT REFERENCES targets(id) ON DELETE SET NULL,
  status      TEXT NOT NULL,
  backend     TEXT NOT NULL DEFAULT 'local',
  test_mode   INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT,
  finished_at TEXT,
  error       TEXT
);
INSERT INTO executions_new (id, workflow_id, target_id, status, backend, test_mode, started_at, finished_at, error)
  SELECT id, workflow_id, target_id, status, backend, test_mode, started_at, finished_at, error FROM executions;
DROP TABLE executions;
ALTER TABLE executions_new RENAME TO executions;
CREATE INDEX IF NOT EXISTS ix_executions_workflow ON executions(workflow_id);
`

const SCHEDULES_REBUILD = `
CREATE TABLE schedules_new (
  id               TEXT PRIMARY KEY,
  workflow_id      TEXT NOT NULL,
  target_id        TEXT REFERENCES targets(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL,
  interval_seconds INTEGER,
  target_kind      TEXT,
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL
);
INSERT INTO schedules_new (id, workflow_id, target_id, kind, interval_seconds, target_kind, enabled, created_at)
  SELECT id, workflow_id, target_id, kind, interval_seconds, target_kind, enabled, created_at FROM schedules;
DROP TABLE schedules;
ALTER TABLE schedules_new RENAME TO schedules;
CREATE INDEX IF NOT EXISTS ix_schedules_workflow ON schedules(workflow_id);
CREATE INDEX IF NOT EXISTS ix_schedules_kind ON schedules(kind);
`

/**
 * Workflows moved to the user-level database, so an engagement's `executions`
 * and `schedules` can no longer point a foreign key at them — SQLite cannot
 * enforce one across database files, and the constraint would reject every run
 * of a workflow that is no longer stored here.
 *
 * Rebuilds the two tables without that constraint, following SQLite's own
 * procedure for altering a table: foreign keys off, copy into a new table
 * inside a transaction, then swap. `node_executions` keeps referencing
 * `executions`, which exists again under the same name by the time keys are
 * back on. Runs only on a database that still has the old shape.
 */
function dropWorkflowForeignKeys(raw: Database): void {
  const executions = referencesWorkflows(raw, 'executions')
  const schedules = referencesWorkflows(raw, 'schedules')
  if (!executions && !schedules) return

  // PRAGMA foreign_keys is a no-op inside a transaction, so it goes outside.
  raw.pragma('foreign_keys = OFF')
  try {
    raw.exec('BEGIN')
    try {
      if (executions) raw.exec(EXECUTIONS_REBUILD)
      if (schedules) raw.exec(SCHEDULES_REBUILD)
      raw.exec('COMMIT')
    } catch (cause) {
      raw.exec('ROLLBACK')
      throw new Error('Could not migrate this engagement to user-level workflows', { cause })
    }
  } finally {
    raw.pragma('foreign_keys = ON')
  }
}

const FINDINGS_REBUILD = `
CREATE TABLE findings_new (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  severity      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',
  description   TEXT NOT NULL DEFAULT '',
  details       TEXT NOT NULL DEFAULT '',
  target_id     TEXT REFERENCES targets(id) ON DELETE SET NULL,
  source        TEXT NOT NULL DEFAULT 'manual',
  execution_id  TEXT,
  node_id       TEXT,
  evidence_path TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
INSERT INTO findings_new (id, title, severity, status, description, details, target_id, source, evidence_path, created_at, updated_at)
  SELECT id, title, severity, 'open', '', '', target_id, 'agent', evidence_path, created_at, created_at FROM findings;
DROP TABLE findings;
ALTER TABLE findings_new RENAME TO findings;
CREATE INDEX IF NOT EXISTS ix_findings_target ON findings(target_id);
CREATE INDEX IF NOT EXISTS ix_findings_status ON findings(status);
`

/**
 * Grow the findings table from the three-column stub (target, severity, title)
 * into a record you can actually triage: description, details, status, where it
 * came from, and a target that may now be absent — a finding outlives the asset
 * it was found on, and the old NOT NULL plus ON DELETE CASCADE meant deleting a
 * target silently deleted its findings.
 *
 * The rows that exist could only have come from an agent's `add_finding`, so
 * they are attributed to `agent` and start `open`. Same table-rebuild procedure
 * as {@link dropWorkflowForeignKeys}; runs only on the old shape.
 */
function widenFindings(raw: Database): void {
  const cols = raw.prepare('PRAGMA table_info(findings)').all() as { name: string }[]
  // No table yet (a fresh engagement) or already widened: nothing to carry over.
  if (cols.length === 0 || cols.some((c) => c.name === 'status')) return

  raw.pragma('foreign_keys = OFF')
  try {
    raw.exec('BEGIN')
    try {
      raw.exec(FINDINGS_REBUILD)
      raw.exec('COMMIT')
    } catch (cause) {
      raw.exec('ROLLBACK')
      throw new Error('Could not migrate this engagement\'s findings', { cause })
    }
  } finally {
    raw.pragma('foreign_keys = ON')
  }
}

const TARGETS_REBUILD = `
CREATE TABLE targets_new (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  value      TEXT NOT NULL UNIQUE,
  apex       TEXT,
  parent_id  TEXT REFERENCES targets(id) ON DELETE SET NULL,
  source     TEXT NOT NULL,
  scope_status TEXT NOT NULL DEFAULT 'unknown',
  scope_reason TEXT NOT NULL DEFAULT '',
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);
`

interface LegacyTargetRow {
  id: string
  kind: string
  value: string
  parent_id: string | null
  source: string
  first_seen: string
  last_seen: string
}

/**
 * Re-house the target tree on canonical identity.
 *
 * Version 3 made (kind, value) the identity, so the kind — which every tool and
 * agent had to guess — became part of what a host WAS. The SMARTFIT engagement
 * shows the result: nine hosts stored twice, once as a domain and once as a
 * subdomain, with their facts and findings split between the copies, its apex
 * `smartfit.com.br` filed as a subdomain of nothing, and two thirds of the tree
 * sitting at the root because nobody computed a parent.
 *
 * So each row is folded to its canonical value. Rows that fold together merge:
 * the oldest survives (it holds the true first_seen), the others hand over their
 * facts, findings and children before they go. Kind, apex and parent are then
 * re-derived from the value, inventing the apex rows that subdomains need.
 *
 * Every row lands `unknown`: an upgraded engagement has no scope rules yet, and
 * guessing a boundary from whatever happens to be in the tree would be inventing
 * a decision the operator never made.
 *
 * Runs only on the old shape, following SQLite's own alter-table procedure.
 */
function rebuildTargets(raw: Database): void {
  const cols = raw.prepare('PRAGMA table_info(targets)').all() as { name: string }[]
  if (cols.length === 0 || cols.some((c) => c.name === 'apex')) return

  const rows = raw
    .prepare('SELECT * FROM targets ORDER BY first_seen, rowid')
    .all() as LegacyTargetRow[]

  interface Merged {
    row: LegacyTargetRow
    kind: string
    value: string
    apex: string | null
    /** The hostname a url lives on, used to find its parent. */
    host: string | null
  }

  const survivors = new Map<string, Merged>()
  /** Old id -> the id that now carries its facts, findings and children. */
  const redirect = new Map<string, string>()
  const dropped: string[] = []

  for (const row of rows) {
    const asset = canonicaliseAsset({ kind: row.kind, value: row.value })
    if (!isCanonicalAsset(asset)) {
      // A value the canonical form rejects (a wildcard someone stored as a host,
      // a malformed address) is kept verbatim rather than deleted: losing an
      // operator's row is worse than carrying one that cannot be parsed.
      const key = row.value.trim()
      if (!survivors.has(key)) {
        survivors.set(key, { row, kind: row.kind, value: key, apex: null, host: null })
      } else {
        redirect.set(row.id, (survivors.get(key) as Merged).row.id)
        dropped.push(row.id)
      }
      continue
    }

    const existing = survivors.get(asset.value)
    if (existing === undefined) {
      survivors.set(asset.value, {
        row,
        kind: asset.kind,
        value: asset.value,
        apex: asset.apex,
        host: asset.host,
      })
      continue
    }

    // Rows arrive oldest first, so the one already here is the survivor.
    redirect.set(row.id, existing.row.id)
    dropped.push(row.id)
    existing.row.last_seen = row.last_seen > existing.row.last_seen ? row.last_seen : existing.row.last_seen
  }

  // Apex and host rows the tree needs as parents but never had. Worked as a
  // queue rather than one pass: the host derived for a url is itself usually a
  // subdomain, and it needs its own apex, or it is left dangling at the root
  // looking like a registrable domain it is not.
  const now = isoNow()
  const pending = [...survivors.values()]
  while (pending.length > 0) {
    const entry = pending.pop() as Merged
    const owner = entry.kind === 'url' ? entry.host : entry.kind === 'subdomain' ? entry.apex : null
    if (owner === null || owner === entry.value || survivors.has(owner)) continue

    const derived = canonicaliseAsset({ kind: 'domain', value: owner })
    if (!isCanonicalAsset(derived)) continue

    const created: Merged = {
      row: {
        id: newId(),
        kind: derived.kind,
        value: derived.value,
        parent_id: null,
        source: 'derived',
        first_seen: now,
        last_seen: now,
      },
      kind: derived.kind,
      value: derived.value,
      apex: derived.apex,
      host: derived.host,
    }
    survivors.set(derived.value, created)
    pending.push(created)
  }

  const idByValue = new Map([...survivors.values()].map((entry) => [entry.value, entry.row.id]))

  raw.pragma('foreign_keys = OFF')
  try {
    raw.exec('BEGIN')
    try {
      raw.exec(TARGETS_REBUILD)
      const insert = raw.prepare(
        `INSERT INTO targets_new (id, kind, value, apex, parent_id, source, scope_status, scope_reason, first_seen, last_seen)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )

      for (const entry of survivors.values()) {
        const owner = entry.kind === 'url' ? entry.host : entry.kind === 'subdomain' ? entry.apex : null
        // A parent that was merged away is followed to whatever absorbed it.
        const inherited =
          entry.row.parent_id === null ? null : redirect.get(entry.row.parent_id) ?? entry.row.parent_id
        const derivedParent = owner === null || owner === entry.value ? null : idByValue.get(owner) ?? null
        const parentId = derivedParent ?? inherited
        insert.run(
          entry.row.id,
          entry.kind,
          entry.value,
          entry.apex,
          parentId === entry.row.id ? null : parentId,
          entry.row.source,
          'unknown',
          'no scope rules defined yet',
          entry.row.first_seen,
          entry.row.last_seen,
        )
      }

      // Move everything the merged-away rows owned onto their survivor before
      // the old table — and its ON DELETE CASCADE — goes. Either table may not
      // exist yet: the schema that creates them has not run at this point.
      for (const table of ['target_facts', 'findings']) {
        if (!tableExists(raw, table)) continue
        const move = raw.prepare(`UPDATE ${table} SET target_id = ? WHERE target_id = ?`)
        for (const [from, to] of redirect) move.run(to, from)
      }
      for (const id of dropped) raw.prepare('DELETE FROM targets WHERE id = ?').run(id)

      raw.exec('DROP TABLE targets')
      raw.exec('ALTER TABLE targets_new RENAME TO targets')
      raw.exec('CREATE INDEX IF NOT EXISTS ix_targets_parent ON targets(parent_id)')
      raw.exec('CREATE INDEX IF NOT EXISTS ix_targets_apex ON targets(apex)')
      raw.exec('CREATE INDEX IF NOT EXISTS ix_targets_scope ON targets(scope_status)')
      raw.exec('COMMIT')
    } catch (cause) {
      raw.exec('ROLLBACK')
      throw new Error("Could not migrate this engagement's target tree", { cause })
    }
  } finally {
    raw.pragma('foreign_keys = ON')
  }
}
