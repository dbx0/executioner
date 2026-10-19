import { eq } from 'drizzle-orm'
import { isoNow } from '@exe/protocol'
import type { ProjectDatabase } from './orm.js'
import { backendProfiles, customNodes, meta, secrets, workflows } from './tables.js'

/** The `meta` key marking an engagement whose workflows/connections/secrets were adopted. */
export const ADOPTED_KEY = 'globals_adopted'

export interface AdoptResult {
  workflows: number
  customNodes: number
  backends: number
  secrets: number
}

/** The engagement's key/value `meta` table. */
export class MetaRepository {
  private readonly orm: ProjectDatabase['orm']

  constructor(db: ProjectDatabase) {
    this.orm = db.orm
  }

  get(key: string): string | undefined {
    return this.orm.select({ value: meta.value }).from(meta).where(eq(meta.key, key)).get()?.value
  }

  set(key: string, value: string): void {
    this.orm.insert(meta).values({ key, value }).onConflictDoUpdate({ target: meta.key, set: { value } }).run()
  }

  remove(key: string): void {
    this.orm.delete(meta).where(eq(meta.key, key)).run()
  }
}

/**
 * One-time hand-over of an engagement's own workflows, custom nodes, connections
 * and secrets to the user-level database, run the first time a pre-existing
 * engagement is opened by a build that keeps them globally. The rows stay in the
 * project database untouched — nothing reads them any more, but an older build
 * still can.
 *
 * Conflicts resolve in favour of what is already global: a secret keeps its
 * global value, and a workflow or connection already present with the same name
 * and content is not duplicated. Ids are preserved, so this engagement's runs
 * and schedules still resolve the workflow they name, and a workflow pinned to
 * a backend profile still resolves it.
 *
 * The `meta` marker makes this idempotent and one-way: a connection deleted
 * globally is not resurrected the next time the engagement that once held it
 * is opened.
 */
export function adoptProjectGlobals(project: ProjectDatabase, global: ProjectDatabase): AdoptResult {
  const marker = new MetaRepository(project)
  if (marker.get(ADOPTED_KEY) !== undefined) return { workflows: 0, customNodes: 0, backends: 0, secrets: 0 }

  const from = project.orm
  const to = global.orm
  const result: AdoptResult = { workflows: 0, customNodes: 0, backends: 0, secrets: 0 }

  const workflowShape = (r: { name: string; graph: string }): string => `${r.name} ${r.graph}`
  const savedWorkflows = to.select({ id: workflows.id, name: workflows.name, graph: workflows.graph }).from(workflows).all()
  const workflowIds = new Set(savedWorkflows.map((r) => r.id))
  const workflowShapes = new Set(savedWorkflows.map(workflowShape))
  for (const row of from.select().from(workflows).all()) {
    if (workflowIds.has(row.id) || workflowShapes.has(workflowShape(row))) continue
    to.insert(workflows).values(row).run()
    workflowIds.add(row.id)
    workflowShapes.add(workflowShape(row))
    result.workflows += 1
  }

  // A custom node keeps its id: that id is the node type a graph names.
  for (const row of from.select().from(customNodes).all()) {
    result.customNodes += to.insert(customNodes).values(row).onConflictDoNothing().run().changes
  }

  const shapeOf = (r: { name: string; kind: string; config: string }): string => `${r.name}\0${r.kind}\0${r.config}`
  const existing = to
    .select({ id: backendProfiles.id, name: backendProfiles.name, kind: backendProfiles.kind, config: backendProfiles.config })
    .from(backendProfiles)
    .all()
  const byId = new Set(existing.map((r) => r.id))
  const byShape = new Set(existing.map(shapeOf))
  for (const row of from.select().from(backendProfiles).all()) {
    if (byId.has(row.id) || byShape.has(shapeOf(row))) continue
    to.insert(backendProfiles).values(row).run()
    byId.add(row.id)
    byShape.add(shapeOf(row))
    result.backends += 1
  }

  for (const row of from.select().from(secrets).all()) {
    result.secrets += to.insert(secrets).values(row).onConflictDoNothing().run().changes
  }

  marker.set(ADOPTED_KEY, isoNow())
  return result
}
