import type { JSX } from 'react'
import { Check, Download } from 'lucide-react'
import { FieldLabel } from '../field-label.js'
import { Field } from './Field.js'
import { HintChip } from './HintChip.js'
import type { FormState } from './form-state.js'
import { RECOMMENDED_IMAGES, useConnectionHints } from './use-connection-hints.js'

/**
 * The Docker half of the backend form: image and container workdir. Images you
 * have already pulled are offered first (those cost nothing to run), followed by
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
          <FieldLabel>Already pulled</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {hints.dockerImages.map((image) => (
              <HintChip key={image} hint={image} onClick={() => set({ image })}>
                <Check className="size-3 shrink-0 text-status-success" />
                {image}
              </HintChip>
            ))}
          </div>
        </div>
      )}

      {recommended.length > 0 && (
        <div>
          <FieldLabel>Recommended</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {recommended.map((r) => (
              <HintChip key={r.image} hint={`${r.blurb}. Pulled on the first run.`} onClick={() => set({ image: r.image })} dashed>
                <Download className="size-3 shrink-0" strokeWidth={1.75} />
                {r.image}
              </HintChip>
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
