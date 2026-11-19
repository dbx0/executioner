import type { JSX } from 'react'
import { Input } from '../../ui/input.js'
import { FieldLabel } from '../field-label.js'

export function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string | undefined
}): JSX.Element {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <Input aria-label={label} className="h-8" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}
