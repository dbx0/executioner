import type { JSX } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { SavedAgentMember, TeamBase } from '../../../api/saved-agents.js'
import { Button } from '../../ui/button.js'
import { Input } from '../../ui/input.js'
import { Select } from '../../ui/select.js'
import { Textarea } from '../../ui/textarea.js'
import { Tip } from '../../ui/tip.js'
import { FieldLabel } from '../field-label.js'
import { TEAM_MEMBER_MODELS } from './constants.js'

/** The sub-agent roster of a team: one card per member, plus the add button. */
export function TeamMembersEditor({
  members,
  teamBase,
  onAdd,
  onUpdate,
  onRemove,
}: {
  members: SavedAgentMember[]
  teamBase: TeamBase
  onAdd: () => void
  onUpdate: (i: number, patch: Partial<SavedAgentMember>) => void
  onRemove: (i: number) => void
}): JSX.Element {
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center justify-between">
        <FieldLabel className="mb-0">Sub-agents</FieldLabel>
        <Button variant="ghost" size="xs" onClick={onAdd}>
          <Plus className="size-3.5" strokeWidth={2} />
          Add sub-agent
        </Button>
      </div>
      {members.length === 0 && (
        <p className="rounded-[14px] border border-dashed border-glass-border px-3 py-4 text-center text-[12px] text-muted-foreground">
          No sub-agents yet. Add at least one for the lead to delegate to.
        </p>
      )}
      <div className="flex flex-col gap-2.5">
        {members.map((m, i) => (
          <div key={i} className="rounded-[14px] border border-glass-border bg-glass p-2.5">
            <div className="mb-2 flex items-center gap-2">
              <Input
                value={m.name}
                onChange={(e) => onUpdate(i, { name: e.target.value.replace(/\s+/g, '-').toLowerCase() })}
                placeholder="recon"
                aria-label="Sub-agent name"
                className="h-8 flex-1"
              />
              {teamBase === 'claude' ? (
                <Select
                  value={m.model === undefined || m.model === '' ? 'default' : m.model}
                  onValueChange={(v) => onUpdate(i, { model: v === 'default' ? '' : v })}
                  options={TEAM_MEMBER_MODELS}
                  ariaLabel="Sub-agent model"
                  className="h-8 w-36"
                />
              ) : (
                <Input
                  value={m.model ?? ''}
                  onChange={(e) => onUpdate(i, { model: e.target.value })}
                  placeholder="provider/model"
                  aria-label="Sub-agent model"
                  className="h-8 w-44"
                />
              )}
              <Tip label="Remove sub-agent">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove sub-agent"
                  onClick={() => onRemove(i)}
                  className="text-muted-foreground hover:text-status-error"
                >
                  <Trash2 className="size-4" strokeWidth={1.75} />
                </Button>
              </Tip>
            </div>
            <Input
              value={m.description}
              onChange={(e) => onUpdate(i, { description: e.target.value })}
              placeholder="When the lead should delegate to this sub-agent"
              aria-label="Sub-agent description"
              className="mb-2 h-8"
            />
            <Textarea
              value={m.prompt}
              onChange={(e) => onUpdate(i, { prompt: e.target.value })}
              rows={3}
              placeholder="System prompt for this sub-agent…"
              aria-label="Sub-agent prompt"
              className="text-[13px]"
            />
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[10.5px] text-muted-foreground">
        Each sub-agent has a delegation name, a when-to-delegate description, and its own prompt. Set a{' '}
        {teamBase === 'claude' ? 'model' : 'provider/model'} to pin it, or leave it blank to inherit the
        lead&apos;s. Sub-agents inherit all of the lead&apos;s tools.
      </p>
    </div>
  )
}
