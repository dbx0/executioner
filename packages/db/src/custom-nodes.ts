import { asc, eq } from 'drizzle-orm'
import { isoNow, toolManifestSchema, type ToolManifest } from '@exe/protocol'
import type { ProjectDatabase } from './orm.js'
import { customNodes } from './tables.js'

/** Parse the stored JSON back into a validated ToolManifest. */
function toManifest(r: { definition: string }): ToolManifest {
  return toolManifestSchema.parse(JSON.parse(r.definition))
}

/**
 * Store of user-authored tool nodes. The project wires this against the
 * USER-level database: a workflow is user-level too, and a shared workflow can
 * only run everywhere if the node types it names are there as well. A custom node IS a
 * ToolManifest: the row id equals the manifest id and the full manifest JSON is
 * kept in `definition`. These are merged with the bundled registry wherever tool
 * manifests are consumed (GET /nodes and the workflow executor), so a graph node
 * whose type equals a custom node id runs via the normal tool path.
 */
export class CustomNodeRepository {
  private readonly orm: ProjectDatabase['orm']

  constructor(db: ProjectDatabase) {
    this.orm = db.orm
  }

  list(): ToolManifest[] {
    return this.orm.select().from(customNodes).orderBy(asc(customNodes.createdAt)).all().map(toManifest)
  }

  get(id: string): ToolManifest | undefined {
    const row = this.orm.select().from(customNodes).where(eq(customNodes.id, id)).get()
    return row === undefined ? undefined : toManifest(row)
  }

  /** Persist a new custom node. `definition.id` becomes the row id. */
  create(definition: ToolManifest): ToolManifest {
    const manifest = toolManifestSchema.parse(definition)
    const now = isoNow()
    this.orm
      .insert(customNodes)
      .values({ id: manifest.id, definition: JSON.stringify(manifest), createdAt: now, updatedAt: now })
      .run()
    return manifest
  }

  update(id: string, definition: ToolManifest): ToolManifest | undefined {
    const existing = this.orm.select({ id: customNodes.id }).from(customNodes).where(eq(customNodes.id, id)).get()
    if (existing === undefined) return undefined
    const manifest = toolManifestSchema.parse({ ...definition, id })
    this.orm
      .update(customNodes)
      .set({ definition: JSON.stringify(manifest), updatedAt: isoNow() })
      .where(eq(customNodes.id, id))
      .run()
    return manifest
  }

  remove(id: string): void {
    this.orm.delete(customNodes).where(eq(customNodes.id, id)).run()
  }
}
