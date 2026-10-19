import type { JSX } from 'react'
import { Input } from '../../ui/input.js'

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
      <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">{label}</label>
      <Input className="h-8" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}
