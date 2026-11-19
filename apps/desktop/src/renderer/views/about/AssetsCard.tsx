import type { JSX } from 'react'
import type { Overview } from '../../api/overview.js'
import { AboutCard, CardNote, CardSection } from './Card.js'
import { RankedBars, StackedBar } from './charts.js'
import { coverageSlices, kindSlices } from './summary.js'

/**
 * What the asset list is made of, and under it how much of the in-scope part
 * has actually been worked. Both are about the same set, so they share a card.
 */
export function AssetsCard({ targets }: { targets: Overview['targets'] }): JSX.Element {
  return (
    <AboutCard title="Assets by kind" note={`${targets.total} total`}>
      <RankedBars slices={kindSlices(targets.byKind)} empty="No assets registered yet." />
      <CardSection title="In-scope coverage" note={`${targets.byScope.in} assets`}>
        <StackedBar slices={coverageSlices(targets.coverage)} empty="Nothing is in scope yet." />
        <CardNote>Untouched assets have no recon facts and no findings against them.</CardNote>
      </CardSection>
    </AboutCard>
  )
}
