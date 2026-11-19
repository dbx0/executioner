import type { JSX } from 'react'
import { Textarea } from '../../ui/textarea.js'
import { FieldLabel } from '../field-label.js'

/** `KEY=VALUE` lines exported before the command (SSH) or passed as `-e` (Docker). */
export function EnvField({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <div className="mt-2">
      <FieldLabel htmlFor="backend-env">Environment (optional)</FieldLabel>
      <Textarea
        id="backend-env"
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={'KEY=VALUE per line\nPATH=/home/user/go/bin:/usr/bin:/bin'}
        className="font-mono text-[12px]"
      />
      <p className="mt-1 text-[11px] text-muted-foreground">
        Exported before the command (SSH) or passed as <code>-e</code> (Docker). Use to fix PATH so tools like
        httpx are found.
      </p>
    </div>
  )
}
