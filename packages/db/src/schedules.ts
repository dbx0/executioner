import { asc, eq } from 'drizzle-orm'
import { isoNow, newId } from '@exe/protocol'
import type { ProjectDatabase } from './orm.js'
import { schedules } from './tables.js'

/**
 * How a schedule fires:
 * - `interval`: run the workflow every `intervalSeconds` seconds.
 * - `on_create`: run the workflow whenever a target of `targetKind` is created.
 */
export type ScheduleKind = 'interval' | 'on_create'

export interface Schedule {
  id: string
  workflowId: string
  /** Target the workflow runs against. For on_create this is filled in from the created target. */
  targetId: string | null
  kind: ScheduleKind
  intervalSeconds: number | null
  targetKind: string | null
  enabled: boolean
  createdAt: string
}

export interface ScheduleInput {
  workflowId: string
  targetId?: string | null | undefined
  kind: ScheduleKind
  intervalSeconds?: number | null | undefined
  targetKind?: string | null | undefined
  enabled?: boolean | undefined
}

const toSchedule = (r: typeof schedules.$inferSelect): Schedule => ({ ...r, kind: r.kind as ScheduleKind })

/**
 * CRUD for the engagement's workflow schedules (interval / on_create triggers).
 * The engine's Scheduler reads enabled rows on startup; the desktop app manages
 * them through the /api/schedules routes.
 */
export class ScheduleRepository {
  private readonly orm: ProjectDatabase['orm']

  constructor(db: ProjectDatabase) {
    this.orm = db.orm
  }

  list(): Schedule[] {
    return this.orm.select().from(schedules).orderBy(asc(schedules.createdAt)).all().map(toSchedule)
  }

  get(id: string): Schedule | undefined {
    const row = this.orm.select().from(schedules).where(eq(schedules.id, id)).get()
    return row === undefined ? undefined : toSchedule(row)
  }

  create(input: ScheduleInput): Schedule {
    const schedule: Schedule = {
      id: newId(),
      workflowId: input.workflowId,
      targetId: input.targetId ?? null,
      kind: input.kind,
      intervalSeconds: input.intervalSeconds ?? null,
      targetKind: input.targetKind ?? null,
      enabled: input.enabled ?? true,
      createdAt: isoNow(),
    }
    this.orm.insert(schedules).values(schedule).run()
    return schedule
  }

  setEnabled(id: string, enabled: boolean): Schedule | undefined {
    this.orm.update(schedules).set({ enabled }).where(eq(schedules.id, id)).run()
    return this.get(id)
  }

  remove(id: string): void {
    this.orm.delete(schedules).where(eq(schedules.id, id)).run()
  }

  /** Drop every schedule of a deleted workflow: nothing is left for them to fire. */
  removeForWorkflow(workflowId: string): void {
    this.orm.delete(schedules).where(eq(schedules.workflowId, workflowId)).run()
  }
}
