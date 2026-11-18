import type { JSX } from 'react'
import type { Overview } from '../../api/overview.js'
import { AboutCard, CardNote, CardSection } from './Card.js'
import { StackedBar } from './charts.js'
import { scopeSlices, statusSlices } from './summary.js'

/**
 * The two verdicts the operator hands out: what each finding turned out to be,
 * and which side of the boundary each asset falls on.
 */
export function TriageCard({ data }: { data: Overview }): JSX.Element {
  const { findings, targets, scope } = data
  return (
    <AboutCard title="Triage" note={`${findings.total} ${findings.total === 1 ? 'finding' : 'findings'}`}>
      <StackedBar slices={statusSlices(findings.byStatus)} empty="No findings to triage yet." />
      <CardSection title="Scope verdicts" note={`${scope.includes} include · ${scope.excludes} exclude`}>
        <StackedBar slices={scopeSlices(targets.byScope)} empty="No assets registered yet." />
        {scope.rules === 0 && targets.total > 0 && (
          <CardNote>No scope rules, so every asset reads as unscoped. Add the boundary on the Scope page.</CardNote>
        )}
      </CardSection>
    </AboutCard>
  )
}
