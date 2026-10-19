import type { JSX } from 'react'
import type { TargetFact } from '../../../api/targets.js'
import { RecordMeta, str } from './primitives.js'

export function HttpServiceFacts({ facts }: { facts: TargetFact[] }): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {facts.map((f) => (
        <div key={f.id} className="rounded-md border border-border p-3">
          <div className="flex flex-col gap-1">
            {Object.entries(f.data).map(([k, v]) => (
              <div key={k} className="flex gap-2 text-[12.5px]">
                <span className="w-40 shrink-0 text-muted-foreground">{k}</span>
                <span className="min-w-0 break-words font-mono">{str(v)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2">
            <RecordMeta collectedAt={f.collectedAt} nodeId={f.nodeId} executionId={f.executionId} />
          </div>
        </div>
      ))}
    </div>
  )
}
