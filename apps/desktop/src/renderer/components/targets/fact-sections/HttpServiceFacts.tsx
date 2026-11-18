import type { JSX } from 'react'
import type { TargetFact } from '../../../api/targets.js'
import { RecordCard, RecordList, str } from './primitives.js'

export function HttpServiceFacts({ facts }: { facts: TargetFact[] }): JSX.Element {
  return (
    <RecordList>
      {facts.map((f) => (
        <RecordCard key={f.id} fact={f}>
          <div className="flex flex-col gap-1">
            {Object.entries(f.data).map(([k, v]) => (
              <div key={k} className="flex gap-2 text-[12.5px]">
                <span className="w-40 shrink-0 text-muted-foreground">{k}</span>
                <span className="min-w-0 break-words font-mono">{str(v)}</span>
              </div>
            ))}
          </div>
        </RecordCard>
      ))}
    </RecordList>
  )
}
