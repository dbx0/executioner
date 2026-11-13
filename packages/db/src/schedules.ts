import { asc, eq } from 'drizzle-orm'
import { isoNow, newId } from '@exe/protocol'
import { MetaRepository } from './adopt.js'
import type { ProjectDatabase } from './orm.js'
import { defaultActions, schedules, workflows } from './tables.js'

/**
 * How a schedule fires:
 * - `interval`: run every `intervalSeconds` seconds.
 * - `on_create`: run whenever a target of `targetKind` is created.
 */
export type ScheduleKind = 'interval' | 'on_create'

/**
 * One action: a trigger and what it runs. It runs either a saved workflow
 * (`workflowId`) or a single node (`nodeType` with `nodeParams`), never both.
 */
export interface Schedule {
  id: string
  /** The workflow to run, or null when the action runs a single node. */
  workflowId: string | null
  /** Target it runs against. For on_create this is filled in from the created target. */
  targetId: string | null
  kind: ScheduleKind
  intervalSeconds: number | null
  targetKind: string | null
  /** A saved backend profile id to run on, or null for the engagement default. */
  backendProfileId: string | null
  /** The node to run, or null when the action runs a workflow. */
  nodeType: string | null
  /** That node's params, as the node would carry them on a canvas. */
  nodeParams: Record<string, unknown> | null
  /** on_create only: fire just for targets the scope rules include. */
  inScopeOnly: boolean
  enabled: boolean
  createdAt: string
}

export interface ScheduleInput {
  workflowId?: string | null | undefined
  targetId?: string | null | undefined
  kind: ScheduleKind
  intervalSeconds?: number | null | undefined
  targetKind?: string | null | undefined
  backendProfileId?: string | null | undefined
  nodeType?: string | null | undefined
  nodeParams?: Record<string, unknown> | null | undefined
  inScopeOnly?: boolean | undefined
  enabled?: boolean | undefined
}

type Row = typeof schedules.$inferSelect

/** Params are written by this repository as a JSON object; anything else reads as none. */
function decodeParams(text: string | null): Record<string, unknown> | null {
  if (text === null || text === '') return null
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const toSchedule = (r: Row): Schedule => ({
  ...r,
  // The column is NOT NULL; a single-node action stores the empty string there.
  workflowId: r.workflowId === '' ? null : r.workflowId,
  kind: r.kind as ScheduleKind,
  nodeParams: decodeParams(r.nodeParams),
})

/**
 * CRUD for a table of actions. The engagement's own live in `schedules`; the
 * ones every engagement shares live in the user-level `default_actions`, which
 * has the same columns (see {@link DefaultActionRepository}). The engine's
 * Scheduler reads enabled rows; the desktop app manages them through /api/actions.
 */
export class ScheduleRepository {
  protected readonly orm: ProjectDatabase['orm']

  constructor(
    db: ProjectDatabase,
    private readonly table: typeof schedules = schedules,
  ) {
    this.orm = db.orm
  }

  list(): Schedule[] {
    return this.orm.select().from(this.table).orderBy(asc(this.table.createdAt)).all().map(toSchedule)
  }

  get(id: string): Schedule | undefined {
    const row = this.orm.select().from(this.table).where(eq(this.table.id, id)).get()
    return row === undefined ? undefined : toSchedule(row)
  }

  create(input: ScheduleInput): Schedule {
    const schedule: Schedule = {
      id: newId(),
      workflowId: input.workflowId ?? null,
      targetId: input.targetId ?? null,
      kind: input.kind,
      intervalSeconds: input.intervalSeconds ?? null,
      targetKind: input.targetKind ?? null,
      backendProfileId: input.backendProfileId ?? null,
      nodeType: input.nodeType ?? null,
      nodeParams: input.nodeType == null ? null : (input.nodeParams ?? {}),
      inScopeOnly: input.inScopeOnly ?? false,
      enabled: input.enabled ?? true,
      createdAt: isoNow(),
    }
    this.orm
      .insert(this.table)
      .values({
        ...schedule,
        workflowId: schedule.workflowId ?? '',
        nodeParams: schedule.nodeParams === null ? null : JSON.stringify(schedule.nodeParams),
      })
      .run()
    return schedule
  }

  setEnabled(id: string, enabled: boolean): Schedule | undefined {
    this.orm.update(this.table).set({ enabled }).where(eq(this.table.id, id)).run()
    return this.get(id)
  }

  remove(id: string): void {
    this.orm.delete(this.table).where(eq(this.table.id, id)).run()
  }

  /** Drop every action that ran a deleted workflow: nothing is left for them to fire. */
  removeForWorkflow(workflowId: string): void {
    // The empty id is how a single-node action is stored; it names no workflow.
    if (workflowId === '') return
    this.orm.delete(this.table).where(eq(this.table.workflowId, workflowId)).run()
  }
}

/**
 * The actions every engagement runs, kept in the user-level database. The two
 * tables are column-for-column the same; only the name differs, and that the
 * engagement's one points `target_id` at its own targets.
 */
export class DefaultActionRepository extends ScheduleRepository {
  constructor(globalDb: ProjectDatabase) {
    super(globalDb, defaultActions as unknown as typeof schedules)
  }
}

/** The engagement `meta` key holding its own on/off choice per default action. */
export const DEFAULT_OVERRIDES_KEY = 'actions.default_overrides'

/**
 * One engagement's own choice about each default action. A default belongs to
 * every engagement, so switching it here must not switch it in the others: the
 * choice is kept with the engagement, not with the default. No entry means the
 * engagement has not chosen and the default's own `enabled` stands, which is
 * how a default that ships switched off stays off until someone turns it on.
 */
export class DefaultOverrides {
  private readonly meta: MetaRepository

  constructor(db: ProjectDatabase) {
    this.meta = new MetaRepository(db)
  }

  private all(): Record<string, boolean> {
    try {
      const parsed: unknown = JSON.parse(this.meta.get(DEFAULT_OVERRIDES_KEY) ?? '{}')
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
    } catch {
      return {}
    }
  }

  /** This engagement's choice for a default, or undefined when it has made none. */
  get(id: string): boolean | undefined {
    return this.all()[id]
  }

  set(id: string, enabled: boolean): void {
    this.meta.set(DEFAULT_OVERRIDES_KEY, JSON.stringify({ ...this.all(), [id]: enabled }))
  }

  /** Forget the choice, as when the default itself is deleted. */
  clear(id: string): void {
    const { [id]: _gone, ...rest } = this.all()
    this.meta.set(DEFAULT_OVERRIDES_KEY, JSON.stringify(rest))
  }
}

/** The user-level `meta` key marking that the shipped default actions were handed out. */
export const DEFAULT_ACTIONS_SEEDED_KEY = 'default_actions_seeded'

/** The basic recon starter: whois, DNS, subdomains and an HTTP probe. */
const BASIC_RECON_WORKFLOW = 'starter-domain-recon'

/**
 * Hand a fresh install its one default action: basic recon on every new
 * in-scope domain. It ships switched off, since a tool that starts running the
 * moment a target is typed in is the operator's decision to make, not ours;
 * it is there to be seen and turned on. One-way, like the starter workflows: a
 * default the user deleted is left deleted. Returns how many were written.
 */
export function seedDefaultActions(global: ProjectDatabase): number {
  const marker = new MetaRepository(global)
  if (marker.get(DEFAULT_ACTIONS_SEEDED_KEY) !== undefined) return 0
  marker.set(DEFAULT_ACTIONS_SEEDED_KEY, isoNow())
  // Nothing to run if the workflow is gone (deleted, or never seeded here).
  const exists = global.orm.select({ id: workflows.id }).from(workflows).where(eq(workflows.id, BASIC_RECON_WORKFLOW)).get()
  if (exists === undefined) return 0
  new DefaultActionRepository(global).create({
    workflowId: BASIC_RECON_WORKFLOW,
    kind: 'on_create',
    targetKind: 'domain',
    inScopeOnly: true,
    enabled: false,
  })
  return 1
}
