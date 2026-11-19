import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { TargetDetail } from '../../api/targets.js'
import { Button } from '../ui/button.js'
import { Input } from '../ui/input.js'
import { Select, type SelectOption } from '../ui/select.js'
import { Spinner } from '../ui/spinner.js'

const KINDS = ['domain', 'subdomain', 'ip', 'cidr', 'url'] as const

export interface TargetRenamePatch {
  kind?: string
  value?: string
}

export interface TargetEditBarProps {
  target: TargetDetail
  onRename?: ((patch: TargetRenamePatch) => void) | undefined
  onDelete?: (() => void) | undefined
  renaming?: boolean | undefined
  deleting?: boolean | undefined
}

/** The rename fields: kind, value and a save that sends only what changed. */
function RenameFields({
  target,
  onRename,
  renaming,
}: {
  target: TargetDetail
  onRename: (patch: TargetRenamePatch) => void
  renaming: boolean
}): JSX.Element {
  const [value, setValue] = useState(target.value)
  const [kind, setKind] = useState(target.kind)

  // Keyed on what the server says, not on the object: a live refresh that
  // changes only the findings must leave a half-typed value alone.
  useEffect(() => {
    setValue(target.value)
    setKind(target.kind)
  }, [target.id, target.value, target.kind])

  const trimmed = value.trim()
  const dirty = trimmed !== target.value || kind !== target.kind

  const submit = (): void => {
    if (trimmed === '') return
    const patch: TargetRenamePatch = {}
    if (trimmed !== target.value) patch.value = trimmed
    if (kind !== target.kind) patch.kind = kind
    if (patch.value === undefined && patch.kind === undefined) return
    onRename(patch)
  }

  // A kind the engine knows but this list does not still has to be selectable.
  const options: SelectOption[] = [
    ...KINDS.map((k): SelectOption => ({ value: k, label: k })),
    ...(KINDS.includes(target.kind as (typeof KINDS)[number]) ? [] : [{ value: target.kind, label: target.kind }]),
  ]

  return (
    <>
      <Select
        ariaLabel="Target kind"
        value={kind}
        onValueChange={setKind}
        className="h-8 w-auto min-w-28 rounded-control border-glass-border bg-glass px-3.5"
        options={options}
      />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        className="h-8 max-w-sm flex-1 font-mono text-[13px]"
        aria-label="Target value"
      />
      <Button size="sm" variant="glass" disabled={renaming || !dirty || trimmed === ''} onClick={submit}>
        {renaming && <Spinner size="sm" />}
        {renaming ? 'Saving' : 'Save'}
      </Button>
    </>
  )
}

/** Delete, behind one confirmation because it takes the subtree with it. */
function DeleteControl({
  targetId,
  onDelete,
  deleting,
}: {
  targetId: string
  onDelete: () => void
  deleting: boolean
}): JSX.Element {
  const [confirming, setConfirming] = useState(false)

  // A confirmation raised for one target must not carry over to the next.
  useEffect(() => {
    setConfirming(false)
  }, [targetId])

  if (!confirming) {
    return (
      <Button size="sm" variant="glass" className="ml-auto" onClick={() => setConfirming(true)}>
        <Trash2 strokeWidth={1.75} />
        Delete
      </Button>
    )
  }
  return (
    <div className="ml-auto flex items-center gap-2">
      <span className="text-[12.5px] text-muted-foreground">Delete target and all subdomains?</span>
      <Button size="sm" variant="destructive" disabled={deleting} onClick={onDelete}>
        {deleting && <Spinner size="sm" />}
        {deleting ? 'Deleting' : 'Confirm'}
      </Button>
      <Button size="sm" variant="ghost" disabled={deleting} onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  )
}

/** The edit row under the header. Renders nothing when the pane is read only. */
export function TargetEditBar({ target, onRename, onDelete, renaming, deleting }: TargetEditBarProps): JSX.Element | null {
  if (onRename === undefined && onDelete === undefined) return null
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {onRename !== undefined && <RenameFields target={target} onRename={onRename} renaming={renaming === true} />}
      {onDelete !== undefined && <DeleteControl targetId={target.id} onDelete={onDelete} deleting={deleting === true} />}
    </div>
  )
}
