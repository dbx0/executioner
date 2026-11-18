import type { JSX } from 'react'
import { Input } from '../../ui/input.js'
import { Select } from '../../ui/select.js'
import { Textarea } from '../../ui/textarea.js'
import { FieldLabel } from '../field-label.js'
import { cn } from '../../../lib/utils.js'

export function Field({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string | undefined
  disabled?: boolean | undefined
}): JSX.Element {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <Input
        aria-label={label}
        className="h-8"
        value={value}
        disabled={disabled ?? false}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

export function TextareaField({
  label,
  value,
  onChange,
  placeholder,
  rows,
  mono,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string | undefined
  rows?: number | undefined
  mono?: boolean | undefined
}): JSX.Element {
  return (
    <div className="mt-2">
      <FieldLabel>{label}</FieldLabel>
      <Textarea
        aria-label={label}
        className={cn('text-[13px]', mono === true && 'font-mono text-[12px]')}
        value={value}
        rows={rows ?? 3}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <Select
        ariaLabel={label}
        value={value}
        onValueChange={(v) => onChange(v)}
        options={options.map((o) => ({ value: o, label: o }))}
      />
    </div>
  )
}
