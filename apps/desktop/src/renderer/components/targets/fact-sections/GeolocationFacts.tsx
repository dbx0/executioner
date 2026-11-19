import type { JSX } from 'react'
import type { TargetFact } from '../../../api/targets.js'
import { KeyValueGrid, RecordCard, RecordList } from './primitives.js'

export function GeolocationFacts({ facts }: { facts: TargetFact[] }): JSX.Element {
  return (
    <RecordList>
      {facts.map((f) => {
        const entries = Object.entries(f.data).filter(([, v]) => v !== null && v !== undefined && v !== '')
        return (
          <RecordCard key={f.id} fact={f}>
            <KeyValueGrid entries={entries} />
          </RecordCard>
        )
      })}
    </RecordList>
  )
}
