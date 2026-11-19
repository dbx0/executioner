import type { JSX } from 'react'
import type { TeamBase } from '../../../api/saved-agents.js'
import { AgentIcon } from '../../brand/AgentIcon.js'
import { Select } from '../../ui/select.js'
import { FieldLabel } from '../field-label.js'
import { TEAM_BASES } from './constants.js'

/** Which CLI a team runs on. Locked to a read-only row once the team exists. */
export function TeamBaseField({
  teamBase,
  locked,
  choices,
  onChange,
}: {
  teamBase: TeamBase
  locked: boolean
  choices: { id: TeamBase; label: string }[]
  onChange: (v: TeamBase) => void
}): JSX.Element {
  return (
    <>
      <FieldLabel>Runs on</FieldLabel>
      {locked ? (
        <div className="mb-2 flex h-9 items-center gap-2 rounded-control border border-glass-border bg-glass px-3.5 text-[13px] text-muted-foreground">
          <AgentIcon agent={teamBase} className="size-4" />
          {TEAM_BASES.find((b) => b.id === teamBase)?.label ?? teamBase}
        </div>
      ) : (
        <Select
          className="mb-2"
          ariaLabel="Runs on"
          value={teamBase}
          onValueChange={(v) => onChange(v as TeamBase)}
          options={choices.map((b) => ({
            value: b.id,
            label: b.label,
            icon: <AgentIcon agent={b.id} className="size-4" />,
          }))}
        />
      )}
      <p className="mb-3 text-[10.5px] text-muted-foreground">
        {teamBase === 'claude'
          ? 'A Claude lead session delegates to the sub-agents below via the Task tool.'
          : 'An OpenCode lead delegates to the sub-agents below (written to .opencode/agent at launch).'}
      </p>
    </>
  )
}
