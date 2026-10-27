/**
 * SQL DDL for a project database, version 1.
 *
 * Design note: the eight per-attribute tables from the previous Postgres schema
 * (open_ports, technologies, http_headers, screenshots, whois_records,
 * vulnerabilities, geolocation, raw_tool_outputs) all shared an identical shape,
 * so they collapse into `target_facts` with a `kind` discriminator. A node
 * manifest's [emit] block writes rows here, and adding a new fact type needs no
 * migration.
 *
 * Large tool output is never stored inline. `node_executions` holds paths into
 * the project's evidence/ directory instead.
 */
export const SCHEMA_VERSION = 4

/**
 * Workflows, the custom nodes they are built from, connections and secrets are
 * USER-level, not engagement-level: the same SSH host, the same Shodan key and
 * the same workflow are wanted in every engagement — and a shared workflow only
 * runs everywhere if the nodes it names travel with it. Their DDL is named here
 * so the global database (see `openGlobalDatabase`) can create the very same
 * tables and the very same repositories can drive them.
 */
export const WORKFLOWS_DDL = `CREATE TABLE IF NOT EXISTS workflows (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  graph        TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'local',
  registry_ref TEXT,
  version      TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
`

export const CUSTOM_NODES_DDL = `CREATE TABLE IF NOT EXISTS custom_nodes (
  id         TEXT PRIMARY KEY,
  definition TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

export const FINDINGS_DDL = `CREATE TABLE IF NOT EXISTS findings (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  severity      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',
  description   TEXT NOT NULL DEFAULT '',
  details       TEXT NOT NULL DEFAULT '',
  -- Nullable on purpose: a finding can outlive the target it was found on, and
  -- an agent may record one before the asset it belongs to is known.
  target_id     TEXT REFERENCES targets(id) ON DELETE SET NULL,
  source        TEXT NOT NULL DEFAULT 'manual',
  execution_id  TEXT,
  node_id       TEXT,
  evidence_path TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
`

/**
 * The engagement's boundary, as rules rather than prose. A scope paste is
 * turned into rows here so that every later write can be judged against it —
 * a `docs/SCOPE.md` cannot stop a tool from filing a third party's host.
 */
export const SCOPE_RULES_DDL = `CREATE TABLE IF NOT EXISTS scope_rules (
  id         TEXT PRIMARY KEY,
  effect     TEXT NOT NULL,
  pattern    TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  UNIQUE (effect, pattern)
);
`

export const BACKEND_PROFILES_DDL = `CREATE TABLE IF NOT EXISTS backend_profiles (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  config     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

export const SECRETS_DDL = `CREATE TABLE IF NOT EXISTS secrets (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

/** Key/value markers: one-time migrations and seeds record that they ran. */
const META_DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

/** The user-level database: only the tables shared across all engagements. */
export const GLOBAL_SCHEMA_SQL = `
${META_DDL}
${WORKFLOWS_DDL}
${CUSTOM_NODES_DDL}
${BACKEND_PROFILES_DDL}
${SECRETS_DDL}
`

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

${META_DDL}

CREATE TABLE IF NOT EXISTS targets (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  -- Unique on the value alone, not on (kind, value): the kind is derived from
  -- the value, so letting it into the identity is what let one host be stored
  -- twice, once as a domain and once as a subdomain, splitting its facts and
  -- findings between two rows.
  value      TEXT NOT NULL UNIQUE,
  -- Registrable domain the asset belongs under; null for an ip or a network.
  apex       TEXT,
  parent_id  TEXT REFERENCES targets(id) ON DELETE SET NULL,
  source     TEXT NOT NULL,
  scope_status TEXT NOT NULL DEFAULT 'unknown',
  scope_reason TEXT NOT NULL DEFAULT '',
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_targets_parent ON targets(parent_id);
CREATE INDEX IF NOT EXISTS ix_targets_apex ON targets(apex);
CREATE INDEX IF NOT EXISTS ix_targets_scope ON targets(scope_status);

${SCOPE_RULES_DDL}

CREATE TABLE IF NOT EXISTS target_facts (
  id           TEXT PRIMARY KEY,
  target_id    TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  execution_id TEXT,
  node_id      TEXT,
  collected_at TEXT NOT NULL,
  data         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_facts_target_kind ON target_facts(target_id, kind);

-- Legacy: workflows are user-level now. The table stays so an engagement
-- written by an older build still parses and can hand its rows over.
${WORKFLOWS_DDL}

CREATE TABLE IF NOT EXISTS executions (
  id          TEXT PRIMARY KEY,
  -- The workflow lives in the user-level database, so this is a plain id: no
  -- foreign key, and no cascade (routes/workflows.ts does that deletion).
  workflow_id TEXT,
  target_id   TEXT REFERENCES targets(id) ON DELETE SET NULL,
  status      TEXT NOT NULL,
  backend     TEXT NOT NULL DEFAULT 'local',
  test_mode   INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT,
  finished_at TEXT,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS ix_executions_workflow ON executions(workflow_id);

CREATE TABLE IF NOT EXISTS node_executions (
  id            TEXT PRIMARY KEY,
  execution_id  TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  node_id       TEXT NOT NULL,
  status        TEXT NOT NULL,
  exit_code     INTEGER,
  stdout_path   TEXT,
  stderr_path   TEXT,
  parsed_output TEXT,
  started_at    TEXT,
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS ix_node_executions_execution ON node_executions(execution_id);

${BACKEND_PROFILES_DDL}

${FINDINGS_DDL}
CREATE INDEX IF NOT EXISTS ix_findings_target ON findings(target_id);
CREATE INDEX IF NOT EXISTS ix_findings_status ON findings(status);

${SECRETS_DDL}

-- Legacy: custom nodes are user-level now, for the same reason as workflows.
${CUSTOM_NODES_DDL}
CREATE TABLE IF NOT EXISTS schedules (
  id               TEXT PRIMARY KEY,
  -- A user-level workflow id; see the note on executions.
  workflow_id      TEXT NOT NULL,
  target_id        TEXT REFERENCES targets(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL,
  interval_seconds INTEGER,
  target_kind      TEXT,
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_schedules_workflow ON schedules(workflow_id);
CREATE INDEX IF NOT EXISTS ix_schedules_kind ON schedules(kind);

CREATE TABLE IF NOT EXISTS saved_agents (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  agent       TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  model       TEXT,
  tools       TEXT,
  members     TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assistant_conversations (
  id          TEXT PRIMARY KEY,
  workflow_id TEXT,
  agent       TEXT NOT NULL,
  session_id  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_assistant_conversations_workflow ON assistant_conversations(workflow_id);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  proposal        TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_assistant_messages_conversation ON assistant_messages(conversation_id);
`
