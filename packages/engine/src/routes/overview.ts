import { Hono } from 'hono'
import { SEVERITIES } from '@exe/db'
import { readConfig, readProgramDescription, type Project } from '@exe/project'

/** How many days of history the activity chart covers, today included. */
export const ACTIVITY_DAYS = 14

/** `2026-09-22` from an ISO timestamp, or null when there isn't one. */
function dayOf(iso: string | null | undefined): string | null {
  return typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : null
}

/** The last `ACTIVITY_DAYS` calendar days (UTC), oldest first. */
function recentDays(now: Date): string[] {
  const out: string[] = []
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 86_400_000)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/** Worst first, so a severity ranking never has to be recomputed downstream. */
const SEVERITY_ORDER = SEVERITIES

/**
 * `GET /project/overview` — one aggregate read behind the About page.
 *
 * Everything the page shows comes from here in a single round trip: the
 * engagement's identity and its own description, the counts a hunter judges
 * progress by, and a day-by-day activity series. The rows come from the
 * overview repository, which reads only the narrow columns this needs.
 */
export function overviewRoutes(project: Project): Hono {
  const app = new Hono()

  app.get('/project/overview', (c) => {
    const config = readConfig(project.root)
    const { targets, findings, runs, factsByKind, factsByTarget, rulesByEffect } = project.overview.rows()

    // ----- targets -------------------------------------------------------
    const byScope = { in: 0, unknown: 0, out: 0 }
    const byKind: Record<string, number> = {}
    let lastSeenAt: string | null = null
    for (const t of targets) {
      if (t.scopeStatus === 'in' || t.scopeStatus === 'out' || t.scopeStatus === 'unknown') {
        byScope[t.scopeStatus] += 1
      }
      byKind[t.kind] = (byKind[t.kind] ?? 0) + 1
      if (lastSeenAt === null || t.lastSeen > lastSeenAt) lastSeenAt = t.lastSeen
    }

    // ----- findings ------------------------------------------------------
    const bySeverity: Record<string, number> = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0]))
    const byStatus: Record<string, number> = { open: 0, confirmed: 0, false_positive: 0, discarded: 0, fixed: 0 }
    const perTargetFindings = new Map<string, { count: number; worst: string }>()
    let lastFindingAt: string | null = null
    for (const f of findings) {
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1
      byStatus[f.status] = (byStatus[f.status] ?? 0) + 1
      if (lastFindingAt === null || f.createdAt > lastFindingAt) lastFindingAt = f.createdAt
      if (f.targetId === null) continue
      const prev = perTargetFindings.get(f.targetId)
      const rank = (s: string): number => {
        const i = SEVERITY_ORDER.indexOf(s as (typeof SEVERITY_ORDER)[number])
        return i === -1 ? SEVERITY_ORDER.length : i
      }
      perTargetFindings.set(f.targetId, {
        count: (prev?.count ?? 0) + 1,
        worst: prev === undefined || rank(f.severity) < rank(prev.worst) ? f.severity : prev.worst,
      })
    }

    // The assets worth opening first: most findings, worst severity breaking ties.
    const valueById = new Map(targets.map((t) => [t.id, t.value]))
    const topTargets = [...perTargetFindings.entries()]
      .map(([id, v]) => ({ id, value: valueById.get(id) ?? '', findings: v.count, worst: v.worst }))
      .sort((a, b) => b.findings - a.findings || a.value.localeCompare(b.value))
      .slice(0, 5)

    // ----- coverage of the in-scope surface ------------------------------
    const coverage = { withFindings: 0, reconOnly: 0, untouched: 0 }
    for (const t of targets) {
      if (t.scopeStatus !== 'in') continue
      if ((perTargetFindings.get(t.id)?.count ?? 0) > 0) coverage.withFindings += 1
      else if ((factsByTarget[t.id] ?? 0) > 0) coverage.reconOnly += 1
      else coverage.untouched += 1
    }

    // ----- runs ----------------------------------------------------------
    const runCounts = { total: runs.length, running: 0, succeeded: 0, failed: 0, cancelled: 0 }
    let lastRunAt: string | null = null
    for (const r of runs) {
      if (r.status === 'running') runCounts.running += 1
      else if (r.status === 'succeeded' || r.status === 'success') runCounts.succeeded += 1
      else if (r.status === 'cancelled') runCounts.cancelled += 1
      else runCounts.failed += 1
      const at = r.finishedAt ?? r.startedAt
      if (at !== null && (lastRunAt === null || at > lastRunAt)) lastRunAt = at
    }

    // ----- activity ------------------------------------------------------
    const days = recentDays(new Date())
    const blank = (): { findings: number; runs: number; targets: number } => ({ findings: 0, runs: 0, targets: 0 })
    const series = new Map(days.map((d) => [d, blank()]))
    const bump = (day: string | null, key: 'findings' | 'runs' | 'targets'): void => {
      if (day === null) return
      const slot = series.get(day)
      if (slot !== undefined) slot[key] += 1
    }
    for (const f of findings) bump(dayOf(f.createdAt), 'findings')
    for (const r of runs) bump(dayOf(r.startedAt), 'runs')
    for (const t of targets) bump(dayOf(t.firstSeen), 'targets')

    return c.json({
      engagement: {
        root: project.root,
        name: config.name,
        icon: config.icon ?? null,
        createdAt: config.createdAt,
        defaultBackend: config.defaultBackend,
        description: readProgramDescription(project.root),
      },
      targets: { total: targets.length, byScope, byKind, coverage, lastSeenAt },
      findings: { total: findings.length, bySeverity, byStatus, topTargets, lastAt: lastFindingAt },
      runs: { ...runCounts, lastAt: lastRunAt },
      scope: {
        rules: (rulesByEffect.include ?? 0) + (rulesByEffect.exclude ?? 0),
        includes: rulesByEffect.include ?? 0,
        excludes: rulesByEffect.exclude ?? 0,
      },
      facts: { total: Object.values(factsByKind).reduce((a, n) => a + n, 0), byKind: factsByKind },
      automation: {
        workflows: project.workflows.list().length,
        schedules: project.schedules.list().length,
        savedAgents: project.savedAgents.list().length,
      },
      activity: days.map((date) => ({ date, ...(series.get(date) ?? blank()) })),
    })
  })

  return app
}
