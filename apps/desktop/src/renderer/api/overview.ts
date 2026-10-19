import type { AxiosInstance } from 'axios'

/** One day of the activity window (UTC calendar days, oldest first). */
export interface ActivityDay {
  date: string
  findings: number
  runs: number
  targets: number
}

/** The engagement at a glance, as `GET /project/overview` aggregates it. */
export interface Overview {
  engagement: {
    root: string
    name: string
    icon: string | null
    createdAt: string
    defaultBackend: string
    /** The `## Program` body of HUNT.md; empty when it was never filled in. */
    description: string
  }
  targets: {
    total: number
    byScope: { in: number; unknown: number; out: number }
    byKind: Record<string, number>
    /** How much of the in-scope surface has been looked at. */
    coverage: { withFindings: number; reconOnly: number; untouched: number }
    lastSeenAt: string | null
  }
  findings: {
    total: number
    bySeverity: Record<string, number>
    byStatus: Record<string, number>
    topTargets: { id: string; value: string; findings: number; worst: string }[]
    lastAt: string | null
  }
  runs: {
    total: number
    running: number
    succeeded: number
    failed: number
    cancelled: number
    lastAt: string | null
  }
  scope: { rules: number; includes: number; excludes: number }
  facts: { total: number; byKind: Record<string, number> }
  automation: { workflows: number; schedules: number; savedAgents: number }
  activity: ActivityDay[]
}

export const overviewApi = (client: AxiosInstance) => ({
  get: () => client.get<Overview>('/project/overview').then((r) => r.data),
})
