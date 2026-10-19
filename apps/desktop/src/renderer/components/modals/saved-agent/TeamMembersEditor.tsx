import type { JSX } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { SavedAgentMember, TeamBase } from '../../../api/saved-agents.js'
import { Button } from '../../ui/button.js'
import { Input } from '../../ui/input.js'
import { Select } from '../../ui/select.js'
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
        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">Sub-agents</label>
        <Button variant="ghost" size="xs" onClick={onAdd}>
          <Plus className="size-3.5" strokeWidth={2} />
          Add sub-agent
        </Button>
      </div>
      {members.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
          No sub-agents yet. Add at least one for the lead to delegate to.
        </p>
      )}
      <div className="flex flex-col gap-2.5">
        {members.map((m, i) => (
          <div key={i} className="rounded-lg border border-border bg-card/40 p-2.5">
            <div className="mb-2 flex items-center gap-2">
              <Input
                value={m.name}
                onChange={(e) => onUpdate(i, { name: e.target.value.replace(/\s+/g, '-').toLowerCase() })}
                placeholder="recon"
                className="h-8 flex-1"
              />
              {teamBase === 'claude' ? (
                <Select
                  value={m.model === undefined || m.model === '' ? 'default' : m.model}
                  onValueChange={(v) => onUpdate(i, { model: v === 'default' ? '' : v })}
                  options={TEAM_MEMBER_MODELS}
                  className="h-8 w-36"
                />
              ) : (
                <Input
                  value={m.model ?? ''}
                  onChange={(e) => onUpdate(i, { model: e.target.value })}
                  placeholder="provider/model"
                  className="h-8 w-44"
                />
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove sub-agent"
                title="Remove sub-agent"
                onClick={() => onRemove(i)}
                className="text-muted-foreground hover:text-status-error"
              >
                <Trash2 className="size-4" strokeWidth={1.75} />
              </Button>
            </div>
            <Input
              value={m.description}
              onChange={(e) => onUpdate(i, { description: e.target.value })}
              placeholder="When the lead should delegate to this sub-agent"
              className="mb-2 h-8"
            />
            <textarea
              value={m.prompt}
              onChange={(e) => onUpdate(i, { prompt: e.target.value })}
              rows={3}
              placeholder="System prompt for this sub-agent…"
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
