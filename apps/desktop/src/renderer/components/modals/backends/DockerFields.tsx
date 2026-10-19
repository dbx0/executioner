import type { JSX } from 'react'
import { Check, Download } from 'lucide-react'
import { Field } from './Field.js'
import type { FormState } from './form-state.js'
import { RECOMMENDED_IMAGES, useConnectionHints } from './use-connection-hints.js'

/**
 * The Docker half of the backend form: image and container workdir. Images you
 * have already pulled are offered first — those cost nothing to run — followed by
 * the recommended bases, so the field is a click rather than a typing exercise.
 */
export function DockerFields({
  form,
  set,
}: {
  form: FormState
  set: (patch: Partial<FormState>) => void
}): JSX.Element {
  const hints = useConnectionHints()
  const local = new Set(hints.dockerImages)
  // Recommended images already on disk would be listed twice otherwise.
  const recommended = RECOMMENDED_IMAGES.filter((r) => !local.has(r.image))

  return (
    <div className="flex flex-col gap-2">
      <Field
        label="Image"
        value={form.image}
        onChange={(v) => set({ image: v })}
        placeholder="kalilinux/kali-rolling"
      />

      {hints.dockerImages.length > 0 && (
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
            Already pulled
          </label>
          <div className="flex flex-wrap gap-1.5">
            {hints.dockerImages.map((image) => (
              <button
                key={image}
                type="button"
                onClick={() => set({ image })}
                title={image}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 font-mono text-[11.5px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <Check className="size-3 shrink-0 text-status-success" />
                {image}
              </button>
            ))}
          </div>
        </div>
      )}

      {recommended.length > 0 && (
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Recommended</label>
          <div className="flex flex-wrap gap-1.5">
            {recommended.map((r) => (
              <button
                key={r.image}
                type="button"
                onClick={() => set({ image: r.image })}
                title={`${r.blurb} — pulled on the first run`}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-0.5 font-mono text-[11.5px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <Download className="size-3 shrink-0" strokeWidth={1.75} />
                {r.image}
              </button>
            ))}
          </div>
        </div>
      )}

      <Field
        label="Container workdir (optional)"
        value={form.workdir}
        onChange={(v) => set({ workdir: v })}
        placeholder="/work"
      />
    </div>
  )
}
