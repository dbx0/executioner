import type { JSX } from 'react'
import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Input } from '../../components/ui/input.js'
import { Tip } from '../../components/ui/tip.js'
import { cn } from '../../lib/utils.js'
import { SECTION_LABEL } from './list-row.js'
import { matchesPreset, type ParamPreset } from './presets.js'

/** Saved param sets for this tool: pick one, save the form as one, or drop one. */
export function PresetBar({
  presets,
  params,
  onApply,
  onSave,
  onDelete,
}: {
  presets: ParamPreset[]
  params: Record<string, unknown>
  onApply: (preset: ParamPreset) => void
  onSave: (name: string) => void
  onDelete: (name: string) => void
}): JSX.Element {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  // The defaults need no preset: there is nothing to save until a param changes.
  const canSave = Object.keys(params).length > 0
  const save = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') return
    onSave(trimmed)
    setName('')
    setNaming(false)
  }
  const saveButton = (
    <Button variant="ghost" size="xs" disabled={!canSave} onClick={() => setNaming(true)}>
      <Plus className="size-3" /> Save preset
    </Button>
  )
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-glass-border px-4 py-2">
      <span className={cn('mr-1', SECTION_LABEL)}>Presets</span>
      {presets.map((preset) => {
        const on = matchesPreset(params, preset)
        return (
          <span
            key={preset.name}
            className={cn(
              'inline-flex h-6 items-center rounded-control border text-[12px] transition-colors',
              on ? 'border-transparent bg-glass-active' : 'border-glass-border hover:bg-glass-strong',
            )}
          >
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onApply(preset)}
              className="h-full rounded-l-control pl-2.5 pr-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {preset.name}
            </button>
            <button
              type="button"
              aria-label={`Delete preset ${preset.name}`}
              onClick={() => onDelete(preset.name)}
              className="inline-flex h-full items-center rounded-r-control pl-0.5 pr-2 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <X aria-hidden className="size-3" strokeWidth={2} />
            </button>
          </span>
        )
      })}
      {naming ? (
        <form
          className="inline-flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <Input
            // Opened by a click on Save preset, so taking focus is what was asked for.
            autoFocus
            aria-label="Preset name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              setNaming(false)
              setName('')
            }}
            placeholder="Name"
            className="h-6 w-32 px-2.5 text-[12px]"
          />
          <Button type="submit" variant="glass" size="xs" disabled={name.trim() === ''}>
            Save
          </Button>
        </form>
      ) : canSave ? (
        saveButton
      ) : (
        // A disabled button takes no pointer events, so the hint hangs on a wrapper.
        <Tip label="Change a param to save it as a preset">
          <span className="inline-flex">{saveButton}</span>
        </Tip>
      )}
    </div>
  )
}
