import type { JSX } from 'react'
import type { TargetFact } from '../../../api/targets.js'
import { CodeBlock, RecordCard, RecordList } from './primitives.js'

export function RawOutputFacts({ facts }: { facts: TargetFact[] }): JSX.Element {
  return (
    <RecordList>
      {facts.map((f) => (
        <RecordCard key={f.id} fact={f}>
          <CodeBlock>{JSON.stringify(f.data, null, 2)}</CodeBlock>
        </RecordCard>
      ))}
    </RecordList>
  )
}
