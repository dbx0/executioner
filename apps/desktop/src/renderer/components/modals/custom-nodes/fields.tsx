import type { JSX } from 'react'
import { Input } from '../../ui/input.js'
import { Select } from '../../ui/select.js'
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
      <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">{label}</label>
      <Input
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
      <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">{label}</label>
      <textarea
        className={cn(
          'w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-[13px] outline-none focus:border-ring',
          mono === true && 'font-mono text-[12px]',
        )}
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
      <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">{label}</label>
      <Select
        ariaLabel={label}
        value={value}
        onValueChange={(v) => onChange(v)}
        options={options.map((o) => ({ value: o, label: o }))}
      />
    </div>
  )
}
