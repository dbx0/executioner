import type { CSSProperties, JSX } from 'react'
import type { Overview } from '../../api/overview.js'
import { StatTile } from './StatTile.js'
import type { AgentActivity } from './summary.js'

/** The shared grid of the six headline tiles, so the skeleton lines up with it. */
export const STAT_GRID = 'grid shrink-0 grid-cols-2 gap-panel sm:grid-cols-3 xl:grid-cols-6'

/** The six headline numbers. Three of them open the page they are counted from. */
export function StatTiles({
  data,
  agents,
  onOpenTargets,
  onOpenFindings,
  style,
}: {
  data: Overview
  agents: AgentActivity
  onOpenTargets: () => void
  onOpenFindings: () => void
  style?: CSSProperties
}): JSX.Element {
  const { targets, findings, runs, facts } = data
  const serious = (findings.bySeverity.critical ?? 0) + (findings.bySeverity.high ?? 0)
  return (
    <div className={`${STAT_GRID} motion-safe:animate-enter`} style={style}>
      <StatTile index={0} label="In scope" value={targets.byScope.in} sub={`of ${targets.total} assets`} onClick={onOpenTargets} />
      <StatTile
        index={1}
        label="Open findings"
        value={findings.byStatus.open ?? 0}
        sub={`${findings.total} recorded`}
        onClick={onOpenFindings}
      />
      <StatTile
        index={2}
        label="Critical + high"
        value={serious}
        sub="worth reporting first"
        tone={serious > 0 ? 'text-status-error' : undefined}
        onClick={onOpenFindings}
      />
      <StatTile
        index={3}
        label="Agents working"
        value={agents.working}
        sub={`${agents.open} open · ${agents.subagents} sub-agents`}
        tone={agents.working > 0 ? 'text-ai' : undefined}
      />
      <StatTile
        index={4}
        label="Runs"
        value={runs.running}
        sub={`running of ${runs.total}`}
        tone={runs.running > 0 ? 'text-status-running' : undefined}
      />
      <StatTile index={5} label="Recon facts" value={facts.total} sub={`${Object.keys(facts.byKind).length} kinds collected`} />
    </div>
  )
}
