import { and, asc, eq } from 'drizzle-orm'
import { isoNow, newId, type TargetFact, type TargetFactKind } from '@exe/protocol'
import type { ProjectDatabase } from './orm.js'
import { targetFacts } from './tables.js'

export interface RecordFactInput {
  targetId: string
  kind: TargetFactKind
  executionId: string | null
  nodeId: string | null
  data: Record<string, unknown>
}

type FactRow = typeof targetFacts.$inferSelect

/**
 * The natural identity of each enrichment fact kind — the fields that make a row
 * unique, so re-emitting it replaces the latest version rather than duplicating.
 * An empty list means "one per target" (a singleton). A kind absent from this map
 * (e.g. raw_output) falls back to exact-data de-dup: distinct payloads are kept,
 * exact repeats are not.
 */
const FACT_IDENTITY: Record<string, string[]> = {
  whois: [],
  geolocation: [],
  port: ['port', 'protocol'],
  http_service: ['url'],
  screenshot: ['url', 'path'],
  technology: ['technology', 'name', 'plugin', 'value'],
  vulnerability: ['id', 'template', 'title', 'type', 'param', 'payload'],
}

const toFact = (row: FactRow): TargetFact => ({
  ...row,
  kind: row.kind as TargetFactKind,
  data: decodeData(row.data),
})

/**
 * A fact's payload, decoded. Rows are written by this repository as a JSON
 * object, but the column is plain text that an older build or a hand edit may
 * have left as something else; that reads as an empty payload rather than
 * throwing out of every listing that touches the target.
 */
function decodeData(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export class FactRepository {
  private readonly orm: ProjectDatabase['orm']

  constructor(db: ProjectDatabase) {
    this.orm = db.orm
  }

  record(input: RecordFactInput): TargetFact {
    // Enrichment facts are SINGLETONS keyed by a natural identity, not append-only
    // logs: whois/geolocation are one per target, a port is one per (port,protocol),
    // etc. Re-emitting one (a tool AND a save node, or a re-run with a newer value)
    // must REPLACE the existing row with the latest version, never add a duplicate.
    const identity = FACT_IDENTITY[input.kind]
    const dataJson = JSON.stringify(input.data)

    let match: FactRow | undefined
    if (identity !== undefined) {
      const present = identity.filter((f) => input.data[f] !== undefined && input.data[f] !== '')
      const rows = this.orm
        .select()
        .from(targetFacts)
        .where(and(eq(targetFacts.targetId, input.targetId), eq(targetFacts.kind, input.kind)))
        .all()
      if (identity.length === 0) {
        // Singleton per (target, kind) — one whois/geolocation record per target.
        match = rows[0]
      } else if (present.length > 0) {
        match = rows.find((row) => {
          const d = decodeData(row.data)
          return present.every((f) => String(d[f]) === String(input.data[f]))
        })
      }
    }
    if (match === undefined && identity === undefined) {
      // Unmapped kinds (raw_output): exact-data de-dup only, so distinct outputs
      // are kept but exact repeats are not.
      match = this.orm
        .select()
        .from(targetFacts)
        .where(
          and(
            eq(targetFacts.targetId, input.targetId),
            eq(targetFacts.kind, input.kind),
            eq(targetFacts.data, dataJson),
          ),
        )
        .limit(1)
        .get()
    }

    if (match !== undefined) {
      // Replace with the latest version (data + freshest collection metadata).
      const collectedAt = isoNow()
      this.orm
        .update(targetFacts)
        .set({ data: dataJson, collectedAt, executionId: input.executionId, nodeId: input.nodeId })
        .where(eq(targetFacts.id, match.id))
        .run()
      return { ...toFact(match), data: input.data, executionId: input.executionId, nodeId: input.nodeId, collectedAt }
    }

    const fact: TargetFact = {
      id: newId(),
      targetId: input.targetId,
      kind: input.kind,
      executionId: input.executionId,
      nodeId: input.nodeId,
      collectedAt: isoNow(),
      data: input.data,
    }
    this.orm
      .insert(targetFacts)
      .values({ ...fact, data: JSON.stringify(fact.data) })
      .run()
    return fact
  }

  /** A node's [emit] block can produce hundreds of facts, so they land in one transaction. */
  recordMany(inputs: RecordFactInput[]): TargetFact[] {
    return this.orm.transaction(() => inputs.map((item) => this.record(item)))
  }

  forTarget(targetId: string, kind?: TargetFactKind): TargetFact[] {
    return this.orm
      .select()
      .from(targetFacts)
      .where(
        kind === undefined
          ? eq(targetFacts.targetId, targetId)
          : and(eq(targetFacts.targetId, targetId), eq(targetFacts.kind, kind)),
      )
      .orderBy(asc(targetFacts.collectedAt))
      .all()
      .map(toFact)
  }
}
