import type { JSX } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from '../../ui/button.js'
import { Input } from '../../ui/input.js'
import { IconPicker } from '../../IconPicker.js'

export function FieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode
  htmlFor?: string | undefined
}): JSX.Element {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
      {children}
    </label>
  )
}

/** Badge (photo or emoji) + name + folder row shared by the AI and Manual tabs. */
export function IdentityFields(props: {
  name: string
  setName: (v: string) => void
  icon: string | undefined
  setIcon: (v: string | undefined) => void
  photo: string | undefined
  setPhoto: (v: string | undefined) => void
  dir: string | undefined
  onPickFolder: () => void
  disabled: boolean
}): JSX.Element {
  return (
    <div className="mb-3 flex items-end gap-3">
      <div>
        <FieldLabel>Icon</FieldLabel>
        <IconPicker
          value={{ ...(props.icon !== undefined ? { icon: props.icon } : {}), ...(props.photo !== undefined ? { photo: props.photo } : {}) }}
          onChange={(next) => {
            props.setIcon(next.icon)
            props.setPhoto(next.photo)
          }}
          aria-label="Engagement icon"
        />
      </div>
      <div className="min-w-0 flex-1">
        <FieldLabel>Name</FieldLabel>
        <Input value={props.name} onChange={(e) => props.setName(e.target.value)} placeholder="acme-2026" disabled={props.disabled} />
      </div>
      <div className="min-w-0 flex-1">
        <FieldLabel>Folder</FieldLabel>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start truncate font-normal"
          onClick={props.onPickFolder}
          disabled={props.disabled}
        >
          <FolderOpen className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <span className="truncate">{props.dir === undefined ? 'Choose folder…' : props.dir}</span>
        </Button>
      </div>
    </div>
  )
}
