import type { JSX } from 'react'
import type { SavedAgentScope } from '../../../api/saved-agents.js'
import { Segmented } from '../../ui/segmented.js'
import { FieldLabel } from '../field-label.js'

const SCOPES = [
  { value: 'global', label: 'Global' },
  { value: 'local', label: 'Local' },
] as const

/** Global (shared across engagements) vs local (this engagement only). */
export function ScopeField({
  scope,
  onChange,
}: {
  scope: SavedAgentScope
  onChange: (s: SavedAgentScope) => void
}): JSX.Element {
  return (
    <>
      <FieldLabel>Scope</FieldLabel>
      <Segmented label="Scope" options={SCOPES} value={scope} onChange={onChange} />
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Global agents are shared across engagements; local agents live only in this engagement.
      </p>
    </>
  )
}
