import type { JSX } from 'react'
import { useState } from 'react'
import { NumberField } from '../ui/number-field.js'

/**
 * A number field bound to a numeric value instead of the field text. It keeps
 * the text the user is typing ("1.", "-", an empty field) for as long as that
 * text still stands for the stored number, so a half-typed value is not
 * rewritten under the caret, while a change from outside (undo, another node
 * selected) replaces it.
 */
export function NumericField({
  value,
  onChange,
  emptyAs,
  placeholder,
  className,
  'aria-label': ariaLabel,
}: {
  value: number | undefined
  onChange: (value: number | undefined) => void
  /** What an empty or unreadable field means. Defaults to no value at all. */
  emptyAs?: number
  placeholder?: string
  className?: string
  'aria-label'?: string
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const parse = (text: string): number | undefined =>
    text.trim() === '' || !Number.isFinite(Number(text)) ? emptyAs : Number(text)
  const shown = draft !== null && parse(draft) === value ? draft : value === undefined ? '' : String(value)
  return (
    <NumberField
      value={shown}
      onValueChange={(text) => {
        setDraft(text)
        onChange(parse(text))
      }}
      {...(placeholder === undefined ? {} : { placeholder })}
      {...(className === undefined ? {} : { className })}
      {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
    />
  )
}
