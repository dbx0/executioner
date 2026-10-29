import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { isoNow, newId } from '@exe/protocol'
import type { ProjectDatabase } from './orm.js'
import { findings } from './tables.js'

/** Worst first — the order a findings list is worth reading in. */
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const
export type Severity = (typeof SEVERITIES)[number]

/** Where a finding is in triage. `open` is where everything starts. */
export const FINDING_STATUSES = ['open', 'confirmed', 'false_positive', 'discarded', 'fixed'] as const
export type FindingStatus = (typeof FINDING_STATUSES)[number]

/** What produced it: a workflow node, an agent, or a person typing it in. */
export const FINDING_SOURCES = ['workflow', 'agent', 'manual'] as const
export type FindingSource = (typeof FINDING_SOURCES)[number]

export interface Finding {
  id: string
  title: string
  severity: string
  status: string
  /** The short what-and-why, shown under the title. */
  description: string
  /** Long form: the matched secret, the request/response, working notes. */
  details: string
  targetId: string | null
  source: string
  /** The run and node that recorded it, when a workflow did. */
  executionId: string | null
  nodeId: string | null
  evidencePath: string | null
  createdAt: string
  updatedAt: string
}

export interface FindingInput {
  title: string
  severity: string
  status?: string
  description?: string
  details?: string
  targetId?: string | null
  source?: string
  executionId?: string | null
  nodeId?: string | null
  evidencePath?: string | null
}

/** Narrows a findings list; every field is optional and ANDed. */
export interface FindingFilter {
  status?: string
  severity?: string
  targetId?: string
}

/** Sort key so `critical` leads and an unknown severity sorts last. */
const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const rankOf = (severity: string): number => RANK[severity.toLowerCase()] ?? 5

/**
 * The engagement's findings: what the work actually proved. Workflows write here
 * through the `save_to_finding` node, agents through the MCP tools, and people
 * through the Findings page.
 *
 * Severities and statuses are stored as given rather than constrained by the
 * schema — the callers validate, and a stray value from an older build must
 * still be readable rather than crash the list.
 */
export class FindingRepository {
  private readonly orm: ProjectDatabase['orm']

  constructor(db: ProjectDatabase) {
    this.orm = db.orm
  }

  /** Worst severity first, then most recently seen. */
  list(filter: FindingFilter = {}): Finding[] {
    const where: SQL[] = []
    if (filter.status !== undefined) where.push(eq(findings.status, filter.status))
    if (filter.severity !== undefined) where.push(eq(findings.severity, filter.severity))
    if (filter.targetId !== undefined) where.push(eq(findings.targetId, filter.targetId))
    const rows = this.orm
      .select()
      .from(findings)
      .where(and(...where))
      .all()
    return rows.sort((a, b) => {
      const bySeverity = rankOf(a.severity) - rankOf(b.severity)
      return bySeverity !== 0 ? bySeverity : b.updatedAt.localeCompare(a.updatedAt)
    })
  }

  get(id: string): Finding | undefined {
    return this.orm.select().from(findings).where(eq(findings.id, id)).get()
  }

  forTarget(targetId: string): Finding[] {
    return this.list({ targetId })
  }

  /** How many findings a run recorded. */
  countForExecution(executionId: string): number {
    return this.orm.select({ n: sql<number>`count(*)` }).from(findings).where(eq(findings.executionId, executionId)).get()?.n ?? 0
  }

  create(input: FindingInput): Finding {
    const now = isoNow()
    const finding: Finding = {
      id: newId(),
      title: input.title,
      severity: input.severity,
      status: input.status ?? 'open',
      description: input.description ?? '',
      details: input.details ?? '',
      targetId: input.targetId ?? null,
      source: input.source ?? 'manual',
      executionId: input.executionId ?? null,
      nodeId: input.nodeId ?? null,
      evidencePath: input.evidencePath ?? null,
      createdAt: now,
      updatedAt: now,
    }
    this.orm.insert(findings).values(finding).run()
    return finding
  }

  /** The same finding, seen again: matched on its target and title, case-insensitively. */
  private match(targetId: string | null, title: string): Finding | undefined {
    return this.orm
      .select()
      .from(findings)
      .where(
        and(
          targetId === null ? isNull(findings.targetId) : eq(findings.targetId, targetId),
          // Drizzle has no lower() helper; the title is still a bound parameter.
          sql`lower(${findings.title}) = lower(${title})`,
        ),
      )
      .get()
  }

  /**
   * Record a sighting: create the finding, or refresh the one that is already
   * there. This is what a re-run goes through, which is why it refreshes the
   * evidence but NEVER touches a status a person has set — once you have marked
   * something a false positive or fixed, a nightly scan must not reopen it.
   *
   * `created` says which happened, so a caller can report "3 new, 12 updated".
   */
  record(input: FindingInput): { finding: Finding; created: boolean } {
    const existing = this.match(input.targetId ?? null, input.title)
    if (existing === undefined) return { finding: this.create(input), created: true }

    const updatedAt = isoNow()
    const next: Finding = {
      ...existing,
      severity: input.severity,
      description: input.description ?? existing.description,
      details: input.details ?? existing.details,
      evidencePath: input.evidencePath ?? existing.evidencePath,
      executionId: input.executionId ?? existing.executionId,
      nodeId: input.nodeId ?? existing.nodeId,
      source: input.source ?? existing.source,
      updatedAt,
    }
    this.orm
      .update(findings)
      .set({
        severity: next.severity,
        description: next.description,
        details: next.details,
        evidencePath: next.evidencePath,
        executionId: next.executionId,
        nodeId: next.nodeId,
        source: next.source,
        updatedAt: next.updatedAt,
      })
      .where(eq(findings.id, next.id))
      .run()
    return { finding: next, created: false }
  }

  /** Apply a partial edit. Unknown ids return undefined rather than throwing. */
  update(id: string, patch: Partial<FindingInput>): Finding | undefined {
    const existing = this.get(id)
    if (existing === undefined) return undefined
    const next: Finding = {
      ...existing,
      title: patch.title ?? existing.title,
      severity: patch.severity ?? existing.severity,
      status: patch.status ?? existing.status,
      description: patch.description ?? existing.description,
      details: patch.details ?? existing.details,
      targetId: patch.targetId === undefined ? existing.targetId : patch.targetId,
      evidencePath: patch.evidencePath === undefined ? existing.evidencePath : patch.evidencePath,
      updatedAt: isoNow(),
    }
    this.orm
      .update(findings)
      .set({
        title: next.title,
        severity: next.severity,
        status: next.status,
        description: next.description,
        details: next.details,
        targetId: next.targetId,
        evidencePath: next.evidencePath,
        updatedAt: next.updatedAt,
      })
      .where(eq(findings.id, id))
      .run()
    return next
  }

  remove(id: string): void {
    this.orm.delete(findings).where(eq(findings.id, id)).run()
  }
}
