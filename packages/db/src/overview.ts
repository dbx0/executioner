import { count } from 'drizzle-orm'
import type { ProjectDatabase } from './orm.js'
import { executions, findings, scopeRules, targetFacts, targets } from './tables.js'

/** The slice of a target the overview counts by. */
export interface OverviewTarget {
  id: string
  value: string
  kind: string
  scopeStatus: string
  firstSeen: string
  lastSeen: string
}

export interface OverviewFinding {
  severity: string
  status: string
  targetId: string | null
  createdAt: string
}

export interface OverviewRun {
  status: string
  startedAt: string | null
  finishedAt: string | null
}

/** Everything the engagement overview aggregates, read in one place. */
export interface OverviewRows {
  targets: OverviewTarget[]
  findings: OverviewFinding[]
  runs: OverviewRun[]
  /** Fact count per fact kind. */
  factsByKind: Record<string, number>
  /** Fact count per target id. */
  factsByTarget: Record<string, number>
  /** Scope rule count per effect. */
  rulesByEffect: Record<string, number>
}

const tally = (rows: { key: string; n: number }[]): Record<string, number> =>
  Object.fromEntries(rows.map((r) => [r.key, r.n]))

/**
 * The narrow reads behind the About page. The heavy columns are never selected
 * (a screenshot fact's data blob would dwarf the rest), and the two genuinely
 * large tables are counted with GROUP BY rather than read.
 */
export class OverviewRepository {
  private readonly orm: ProjectDatabase['orm']

  constructor(db: ProjectDatabase) {
    this.orm = db.orm
  }

  rows(): OverviewRows {
    return this.orm.transaction((tx) => ({
      targets: tx
        .select({
          id: targets.id,
          value: targets.value,
          kind: targets.kind,
          scopeStatus: targets.scopeStatus,
          firstSeen: targets.firstSeen,
          lastSeen: targets.lastSeen,
        })
        .from(targets)
        .all(),
      findings: tx
        .select({
          severity: findings.severity,
          status: findings.status,
          targetId: findings.targetId,
          createdAt: findings.createdAt,
        })
        .from(findings)
        .all(),
      runs: tx
        .select({ status: executions.status, startedAt: executions.startedAt, finishedAt: executions.finishedAt })
        .from(executions)
        .all(),
      factsByKind: tally(
        tx.select({ key: targetFacts.kind, n: count() }).from(targetFacts).groupBy(targetFacts.kind).all(),
      ),
      factsByTarget: tally(
        tx.select({ key: targetFacts.targetId, n: count() }).from(targetFacts).groupBy(targetFacts.targetId).all(),
      ),
      rulesByEffect: tally(
        tx.select({ key: scopeRules.effect, n: count() }).from(scopeRules).groupBy(scopeRules.effect).all(),
      ),
    }))
  }
}
