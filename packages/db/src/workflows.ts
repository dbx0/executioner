import { desc, eq } from 'drizzle-orm'
import { isoNow, newId } from '@exe/protocol'
import type { ProjectDatabase } from './orm.js'
import { workflows } from './tables.js'

/** A saved workflow. `graph` is the serialized graph JSON, parsed by the caller. */
export interface Workflow {
  id: string
  name: string
  graph: string
  createdAt: string
  updatedAt: string
}

/** What a listing shows: everything but the graph. */
export type WorkflowSummary = Omit<Workflow, 'graph'>

/** What a listing reads; registry provenance is not surfaced. */
const summaryColumns = {
  id: workflows.id,
  name: workflows.name,
  createdAt: workflows.createdAt,
  updatedAt: workflows.updatedAt,
}

const workflowColumns = { ...summaryColumns, graph: workflows.graph }

/**
 * CRUD for the user's saved workflows. The project wires this against the
 * USER-level database, so a workflow built in one engagement is there in all of
 * them; the runs it produced stay with the engagement that ran them.
 *
 * The graph is kept as text: this package has no opinion about its shape, and
 * the routes validate it before it gets here.
 */
export class WorkflowRepository {
  private readonly orm: ProjectDatabase['orm']

  constructor(db: ProjectDatabase) {
    this.orm = db.orm
  }

  /** Most recently updated first — the order the workflow list is shown in. */
  list(): WorkflowSummary[] {
    return this.orm.select(summaryColumns).from(workflows).orderBy(desc(workflows.updatedAt)).all()
  }

  get(id: string): Workflow | undefined {
    return this.orm.select(workflowColumns).from(workflows).where(eq(workflows.id, id)).get()
  }

  exists(id: string): boolean {
    return this.orm.select({ id: workflows.id }).from(workflows).where(eq(workflows.id, id)).get() !== undefined
  }

  /**
   * Save a new workflow. `id` keeps a known identity, as an import from another
   * library or a fixture needs; omitted, a fresh one is minted.
   */
  create(name: string, graph: string, options: { id?: string } = {}): Workflow {
    const now = isoNow()
    const workflow: Workflow = { id: options.id ?? newId(), name, graph, createdAt: now, updatedAt: now }
    this.orm.insert(workflows).values(workflow).run()
    return workflow
  }

  update(id: string, name: string, graph: string): Workflow | undefined {
    const existing = this.get(id)
    if (existing === undefined) return undefined
    const updatedAt = isoNow()
    this.orm.update(workflows).set({ name, graph, updatedAt }).where(eq(workflows.id, id)).run()
    return { ...existing, name, graph, updatedAt }
  }

  /** Copy a workflow under a new id, named "<name> (copy)". */
  duplicate(id: string): Workflow | undefined {
    const existing = this.get(id)
    if (existing === undefined) return undefined
    return this.create(`${existing.name} (copy)`, existing.graph)
  }

  remove(id: string): void {
    this.orm.delete(workflows).where(eq(workflows.id, id)).run()
  }
}
