import type { JSX } from 'react'
import type { Overview } from '../../api/overview.js'
import { relativeSince } from './summary.js'

function Stat({ label, value }: { label: string; value: number | string }): JSX.Element {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

/** What the engagement has configured and how its runs ended: the quiet totals
 *  that do not earn a chart, kept as one strip along the foot of the hero card. */
export function WiredUp({ data }: { data: Overview }): JSX.Element {
  return (
    <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-glass-border pt-3 text-xs">
      <h3 className="text-[10.5px] font-medium uppercase tracking-wider text-tertiary-foreground">Wired up</h3>
      <dl className="contents">
        <Stat label="Workflows" value={data.automation.workflows} />
        <Stat label="Schedules" value={data.automation.schedules} />
        <Stat label="Saved agents" value={data.automation.savedAgents} />
        <Stat label="Scope rules" value={data.scope.rules} />
        <Stat label="Runs succeeded" value={data.runs.succeeded} />
        <Stat label="Runs failed" value={data.runs.failed} />
        <Stat label="Runs cancelled" value={data.runs.cancelled} />
        <Stat label="Last run" value={relativeSince(data.runs.lastAt)} />
      </dl>
    </div>
  )
}
