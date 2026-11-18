import type { JSX } from 'react'
import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { cn } from '../../lib/utils.js'
import type { NodeListing } from '../../api/nodes.js'
import type { TargetSummary } from '../../api/targets.js'
import { AddTargetInline } from './AddTargetInline.js'
import { listRowClass } from './list-row.js'
import { SearchField } from './SearchField.js'

/**
 * The form's target section: search the targets this tool can take, pick one
 * or several, or add a new one without leaving the form.
 */
export function RunTargets({
  node,
  eligible,
  targetIds,
  onTargetIds,
  onAddTarget,
}: {
  node: NodeListing
  /** The targets of a kind this tool accepts. */
  eligible: TargetSummary[]
  /** Every target the run goes to: one run per target, in this order. */
  targetIds: string[]
  onTargetIds: (ids: string[]) => void
  /** Create a target and add it to the picked ones; rejects with the reason. */
  onAddTarget: (kind: string, value: string) => Promise<void>
}): JSX.Element {
  const [targetQuery, setTargetQuery] = useState('')
  const [adding, setAdding] = useState(false)

  const needle = targetQuery.trim().toLowerCase()
  const shown = needle === '' ? eligible : eligible.filter((t) => t.value.toLowerCase().includes(needle))
  const toggle = (id: string): void =>
    onTargetIds(targetIds.includes(id) ? targetIds.filter((t) => t !== id) : [...targetIds, id])
  // Select-all works on what the search shows, so "search, then select all" is
  // how a batch gets picked.
  const allShown = shown.length > 0 && shown.every((t) => targetIds.includes(t.id))
  const toggleShown = (): void => {
    const ids = new Set(shown.map((t) => t.id))
    onTargetIds(
      allShown ? targetIds.filter((t) => !ids.has(t)) : [...targetIds, ...shown.map((t) => t.id).filter((t) => !targetIds.includes(t))],
    )
  }

  return (
    <div className="flex flex-col gap-2 border-b border-glass-border p-4 text-sm">
      <div className="flex items-center gap-2">
        <span>{targetIds.length > 1 ? `Targets (${targetIds.length})` : 'Target'}</span>
        <span className="ml-auto flex items-center gap-1">
          {eligible.length > 0 && (
            <Button variant="ghost" size="xs" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
              <Plus className="size-3" /> Add
            </Button>
          )}
          {eligible.length > 1 && shown.length > 1 && (
            <Button variant="ghost" size="xs" onClick={toggleShown}>
              {allShown ? 'Deselect shown' : needle === '' ? 'Select all' : 'Select shown'}
            </Button>
          )}
          {targetIds.length > 0 && (
            <Button variant="ghost" size="xs" onClick={() => onTargetIds([])}>
              Clear
            </Button>
          )}
        </span>
      </div>
      {/* With no target this tool can take, adding one is the only way
          forward, so the field is simply there. */}
      {(adding || eligible.length === 0) && (
        <AddTargetInline toolName={node.name} accepts={node.accepts} onAdd={onAddTarget} />
      )}
      {eligible.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No {node.accepts.join(', ')} target yet. Add one above.</p>
      ) : (
        <>
          <SearchField
            value={targetQuery}
            onChange={(e) => setTargetQuery(e.target.value)}
            placeholder="Search targets"
            aria-label="Search targets"
          />
          <div
            role="listbox"
            aria-label="Target"
            aria-multiselectable="true"
            className="scrollbar-sleek max-h-40 overflow-y-auto rounded-[14px] border border-glass-border bg-glass p-1"
          >
            {shown.length === 0 ? (
              <p className="px-2 py-2 text-[12px] text-muted-foreground">No target matches that.</p>
            ) : (
              shown.map((t) => {
                const picked = targetIds.includes(t.id)
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="option"
                    aria-selected={picked}
                    onClick={() => toggle(t.id)}
                    className={cn('flex w-full items-center gap-2 px-2 py-1 text-left text-[12.5px]', listRowClass(picked))}
                  >
                    {/* The option itself is the control; this is only its tick mark. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'grid size-3.5 shrink-0 place-items-center rounded-[4px] border',
                        picked ? 'border-transparent bg-primary text-primary-foreground' : 'border-glass-border bg-glass',
                      )}
                    >
                      {picked && <Check className="size-2.5" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground">{t.value}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{t.kind}</span>
                  </button>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}
