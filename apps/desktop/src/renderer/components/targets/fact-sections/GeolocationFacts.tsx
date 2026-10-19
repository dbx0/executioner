import type { JSX } from 'react'
import type { TargetFact } from '../../../api/targets.js'
import { KeyValueGrid, RecordMeta } from './primitives.js'

export function GeolocationFacts({ facts }: { facts: TargetFact[] }): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {facts.map((f) => {
        const entries = Object.entries(f.data).filter(([, v]) => v !== null && v !== undefined && v !== '')
        return (
          <div key={f.id} className="rounded-md border border-border p-3">
            <KeyValueGrid entries={entries} />
            <div className="mt-2">
              <RecordMeta collectedAt={f.collectedAt} nodeId={f.nodeId} executionId={f.executionId} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
