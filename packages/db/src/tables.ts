import { index, integer, sqliteTable, text, unique, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

/**
 * The project and user-level databases as Drizzle sees them. These definitions
 * are what every repository query is built from; they mirror the DDL in
 * schema.ts (and the additive columns migrate.ts adds) column for column, so a
 * database created by any earlier build is read without a conversion step.
 * `tables.test.ts` holds the two in step: it migrates a fresh database and
 * compares its live shape against these definitions.
 *
 * The DDL stays the source of creation rather than Drizzle's generator because
 * migrate.ts upgrades old engagements in place, and those steps are written
 * against the exact SQL each older build shipped.
 */

export const schemaVersion = sqliteTable('schema_version', {
  version: integer('version').notNull(),
})

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const targets = sqliteTable(
  'targets',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    value: text('value').notNull().unique(),
    apex: text('apex'),
    parentId: text('parent_id').references((): AnySQLiteColumn => targets.id, { onDelete: 'set null' }),
    source: text('source').notNull(),
    scopeStatus: text('scope_status').notNull().default('unknown'),
    scopeReason: text('scope_reason').notNull().default(''),
    firstSeen: text('first_seen').notNull(),
    lastSeen: text('last_seen').notNull(),
  },
  (t) => [
    index('ix_targets_parent').on(t.parentId),
    index('ix_targets_apex').on(t.apex),
    index('ix_targets_scope').on(t.scopeStatus),
  ],
)

export const scopeRules = sqliteTable(
  'scope_rules',
  {
    id: text('id').primaryKey(),
    effect: text('effect').notNull(),
    pattern: text('pattern').notNull(),
    note: text('note').notNull().default(''),
    source: text('source').notNull().default('manual'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [unique().on(t.effect, t.pattern)],
)

export const targetFacts = sqliteTable(
  'target_facts',
  {
    id: text('id').primaryKey(),
    targetId: text('target_id')
      .notNull()
      .references(() => targets.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    executionId: text('execution_id'),
    nodeId: text('node_id'),
    collectedAt: text('collected_at').notNull(),
    data: text('data').notNull(),
  },
  (t) => [index('ix_facts_target_kind').on(t.targetId, t.kind)],
)

export const workflows = sqliteTable('workflows', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  graph: text('graph').notNull(),
  source: text('source').notNull().default('local'),
  registryRef: text('registry_ref'),
  version: text('version'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const executions = sqliteTable(
  'executions',
  {
    id: text('id').primaryKey(),
    // A user-level workflow id: no foreign key across database files.
    workflowId: text('workflow_id'),
    targetId: text('target_id').references(() => targets.id, { onDelete: 'set null' }),
    status: text('status').notNull(),
    backend: text('backend').notNull().default('local'),
    testMode: integer('test_mode', { mode: 'boolean' }).notNull().default(false),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    error: text('error'),
  },
  (t) => [index('ix_executions_workflow').on(t.workflowId)],
)

export const nodeExecutions = sqliteTable(
  'node_executions',
  {
    id: text('id').primaryKey(),
    executionId: text('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    status: text('status').notNull(),
    exitCode: integer('exit_code'),
    stdoutPath: text('stdout_path'),
    stderrPath: text('stderr_path'),
    parsedOutput: text('parsed_output'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    // Added by migrate.ts on open rather than declared in the base DDL.
    params: text('params'),
    backendProfileId: text('backend_profile_id'),
  },
  (t) => [index('ix_node_executions_execution').on(t.executionId)],
)

export const backendProfiles = sqliteTable('backend_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  config: text('config').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const findings = sqliteTable(
  'findings',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    severity: text('severity').notNull(),
    status: text('status').notNull().default('open'),
    description: text('description').notNull().default(''),
    details: text('details').notNull().default(''),
    targetId: text('target_id').references(() => targets.id, { onDelete: 'set null' }),
    source: text('source').notNull().default('manual'),
    executionId: text('execution_id'),
    nodeId: text('node_id'),
    evidencePath: text('evidence_path'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('ix_findings_target').on(t.targetId), index('ix_findings_status').on(t.status)],
)

export const secrets = sqliteTable('secrets', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const customNodes = sqliteTable('custom_nodes', {
  id: text('id').primaryKey(),
  definition: text('definition').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const schedules = sqliteTable(
  'schedules',
  {
    id: text('id').primaryKey(),
    // A user-level workflow id; see the note on executions.
    workflowId: text('workflow_id').notNull(),
    targetId: text('target_id').references(() => targets.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    intervalSeconds: integer('interval_seconds'),
    targetKind: text('target_kind'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('ix_schedules_workflow').on(t.workflowId), index('ix_schedules_kind').on(t.kind)],
)

export const savedAgents = sqliteTable('saved_agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  agent: text('agent').notNull(),
  prompt: text('prompt').notNull(),
  model: text('model'),
  tools: text('tools'),
  members: text('members'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const assistantConversations = sqliteTable(
  'assistant_conversations',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id'),
    agent: text('agent').notNull(),
    sessionId: text('session_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('ix_assistant_conversations_workflow').on(t.workflowId)],
)

export const assistantMessages = sqliteTable(
  'assistant_messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => assistantConversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    proposal: text('proposal'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('ix_assistant_messages_conversation').on(t.conversationId)],
)

/** Every table of the project database, in the order schema.ts creates them. */
export const projectTables = {
  schemaVersion,
  meta,
  targets,
  scopeRules,
  targetFacts,
  workflows,
  executions,
  nodeExecutions,
  backendProfiles,
  findings,
  secrets,
  customNodes,
  schedules,
  savedAgents,
  assistantConversations,
  assistantMessages,
}

/** The user-level database holds only the tables shared by every engagement. */
export const globalTables = { workflows, customNodes, backendProfiles, secrets }
