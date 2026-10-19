import type { JSX } from 'react'
import type { SavedAgentScope } from '../../../api/saved-agents.js'
import { cn } from '../../../lib/utils.js'

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
      <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Scope</label>
      <div className="flex gap-1">
        {(['global', 'local'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs capitalize',
              scope === s
                ? 'selected-surface border-transparent'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {s}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Global agents are shared across engagements; local agents live only in this engagement.
      </p>
    </>
  )
}
