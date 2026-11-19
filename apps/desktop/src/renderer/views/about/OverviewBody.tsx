import type { JSX } from 'react'
import type { Overview } from '../../api/overview.js'
import { cn } from '../../lib/utils.js'
import { stagger } from '../../lib/motion.js'
import { AboutCard } from './Card.js'
import { AssetsCard } from './AssetsCard.js'
import { ActivityChart, ActivityLegend, RankedBars } from './charts.js'
import { Identity } from './Identity.js'
import { CARD_ROW_2, CARD_ROW_3, PAGE_STACK } from './layout.js'
import { StatTiles } from './StatTiles.js'
import { TopTargets } from './TopTargets.js'
import { TriageCard } from './TriageCard.js'
import { severitySlices, type AgentActivity } from './summary.js'

export interface OverviewBodyProps {
  data: Overview
  agents: AgentActivity
  onOpenTargets: () => void
  onOpenFindings: () => void
  onOpenTarget: (id: string) => void
}

/** The loaded page: hero, headline tiles, then two rows of cards. */
export function OverviewBody({ data, agents, onOpenTargets, onOpenFindings, onOpenTarget }: OverviewBodyProps): JSX.Element {
  const { findings } = data
  return (
    <div className={PAGE_STACK}>
      <Identity data={data} agents={agents} />
      <StatTiles
        data={data}
        agents={agents}
        onOpenTargets={onOpenTargets}
        onOpenFindings={onOpenFindings}
        style={stagger(1, 80, 100)}
      />
      <div className={cn(CARD_ROW_2, 'motion-safe:animate-enter')} style={stagger(2, 80, 100)}>
        <AboutCard title="Findings by severity" note={`${findings.byStatus.open ?? 0} open`}>
          <RankedBars slices={severitySlices(findings.bySeverity)} empty="Nothing proved yet." />
        </AboutCard>
        <AssetsCard targets={data.targets} />
      </div>
      <div className={cn(CARD_ROW_3, 'motion-safe:animate-enter')} style={stagger(3, 80, 100)}>
        <TriageCard data={data} />
        <AboutCard title="Most-hit assets" note="worst first">
          <TopTargets targets={findings.topTargets} onOpen={onOpenTarget} />
        </AboutCard>
        <AboutCard title="Last 14 days" actions={<ActivityLegend />}>
          <ActivityChart days={data.activity} />
        </AboutCard>
      </div>
    </div>
  )
}
