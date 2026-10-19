import type { JSX } from 'react'
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
      <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
        Environment (optional)
      </label>
      <textarea
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={'KEY=VALUE per line\nPATH=/home/user/go/bin:/usr/bin:/bin'}
        className="h-auto w-full resize-y rounded-md border border-input bg-transparent px-2 py-1 font-mono text-[12px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <p className="mt-1 text-[11px] text-muted-foreground">
        Exported before the command (SSH) or passed as <code>-e</code> (Docker). Use to fix PATH so tools like
        httpx are found.
      </p>
    </div>
  )
}
