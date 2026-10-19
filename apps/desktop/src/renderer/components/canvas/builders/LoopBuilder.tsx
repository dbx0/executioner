import type { JSX } from 'react'
import { cn } from '../../../lib/utils.js'

const inputClass =
  'rounded-md border border-input bg-transparent px-2 py-1 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

/** Loop iteration references the engine exposes to body nodes. */
const LOOP_CHIPS = ['{{ loop.item }}', '{{ loop.index }}', '{{ loop.count }}']

/**
 * Visual builder for an engine LOOP node. Configures only the `source` param (a
 * template string that the engine interpolates then JSON-parses as an array or
 * newline-splits) and surfaces the iteration reference chips.
 */
export function LoopBuilder({
  value,
  onChange,
  chips,
}: {
  value: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  chips?: string[]
}): JSX.Element {
  const source = typeof value.source === 'string' ? value.source : ''
  const insertChips = chips !== undefined ? [...LOOP_CHIPS, ...chips] : LOOP_CHIPS

  const appendToSource = (chip: string): void => {
    onChange('source', `${source}${source === '' ? '' : ' '}${chip}`)
  }

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <div className="flex flex-col gap-1">
        <span>Source</span>
        <textarea
          aria-label="source"
          rows={4}
          value={source}
          onChange={(e) => onChange('source', e.target.value)}
          className={cn(inputClass, 'resize-y font-mono text-[12px]')}
        />
        <span className="text-[11px] text-muted-foreground">
          Newline-split into items, or a JSON array. Templates are interpolated before parsing.
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Iteration references</span>
        <div className="flex flex-wrap gap-1">
          {insertChips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => appendToSource(chip)}
              className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
            >
              {chip}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground">
          Reference these inside loop body nodes: {'{{ loop.index }}'} is 0-based.
        </span>
      </div>
    </div>
  )
}
