import type { JSX } from 'react'
import type { TargetFact } from '../../../api/targets.js'
import { RecordMeta } from './primitives.js'

export function RawOutputFacts({ facts }: { facts: TargetFact[] }): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {facts.map((f) => (
        <div key={f.id} className="rounded-md border border-border p-3">
          <pre className="max-h-64 overflow-auto scrollbar-sleek rounded-md bg-surface-1 p-2 font-mono text-[11px]">
            {JSON.stringify(f.data, null, 2)}
          </pre>
          <div className="mt-2">
            <RecordMeta collectedAt={f.collectedAt} nodeId={f.nodeId} executionId={f.executionId} />
          </div>
        </div>
      ))}
    </div>
  )
}
