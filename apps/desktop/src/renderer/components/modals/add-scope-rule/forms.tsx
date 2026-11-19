import type { JSX, RefObject } from 'react'
import { cn } from '../../../lib/utils.js'
import { Input } from '../../ui/input.js'
import { segmentClass } from '../../ui/segmented.js'
import { Textarea } from '../../ui/textarea.js'
import { FieldHint, FieldLabel } from '../field-label.js'

export type Effect = 'include' | 'exclude'

const EFFECTS: readonly Effect[] = ['include', 'exclude']

/** One rule by hand: its effect, the pattern and an optional note. */
export function ManualRuleForm({
  effect,
  setEffect,
  pattern,
  setPattern,
  note,
  setNote,
  patternRef,
  onSubmit,
}: {
  effect: Effect
  setEffect: (v: Effect) => void
  pattern: string
  setPattern: (v: string) => void
  note: string
  setNote: (v: string) => void
  patternRef: RefObject<HTMLInputElement | null>
  onSubmit: () => void
}): JSX.Element {
  return (
    <>
      <FieldLabel>Effect</FieldLabel>
      {/* A capsule of pressed buttons, not a radiogroup: the pressed-button semantics are what callers and tests name. */}
      <div role="group" aria-label="Effect" className="glass-capsule mb-3 inline-flex h-8 w-fit items-center gap-0.5 p-[3px]">
        {EFFECTS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={effect === value}
            onClick={() => setEffect(value)}
            className={cn(segmentClass(effect === value), 'h-[26px] px-3 text-xs capitalize')}
          >
            {value}
          </button>
        ))}
      </div>

      <FieldLabel htmlFor="scope-pattern">Pattern</FieldLabel>
      <Input
        id="scope-pattern"
        ref={patternRef}
        value={pattern}
        onChange={(e) => setPattern(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        placeholder="*.example.com · example.com · 10.0.0.0/8 · */admin/*"
        className="mb-3 font-mono text-[13px]"
      />

      <FieldLabel htmlFor="scope-note">Note</FieldLabel>
      <Input
        id="scope-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        placeholder="Why this rule exists, quoted from the program if you can"
        className="text-[13px]"
      />
      <FieldHint>An exclusion always wins over an inclusion that also matches.</FieldHint>
    </>
  )
}

/** The pasted program scope the agent turns into rules. */
export function AiScopeForm({ scope, setScope }: { scope: string; setScope: (v: string) => void }): JSX.Element {
  return (
    <>
      <FieldLabel htmlFor="scope-paste">Scope</FieldLabel>
      <Textarea
        id="scope-paste"
        rows={9}
        value={scope}
        onChange={(e) => setScope(e.target.value)}
        placeholder={'*.example.com\napi.example.com\n10.0.0.0/24\n\nOut of scope: shop.example.com (third party)'}
      />
      <FieldHint>
        Paste the scope from HackerOne/Bugcrowd/etc. The agent writes the include and exclude rules, then records the
        hosts it lists.
      </FieldHint>
    </>
  )
}
