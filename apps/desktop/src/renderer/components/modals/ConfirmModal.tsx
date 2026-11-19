import type { JSX } from 'react'
import { useState } from 'react'
import { Button } from '../ui/button.js'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/dialog.js'
import { Switch } from '../ui/switch.js'

/**
 * A small in-app confirmation modal (replaces window.confirm). Optionally shows
 * a switch whose value is passed to onConfirm. It is raised, because it is
 * often opened from inside another modal.
 */
export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  destructive = false,
  checkboxLabel,
  checkboxDefault = false,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel?: string
  destructive?: boolean
  checkboxLabel?: string
  checkboxDefault?: boolean
  onConfirm: (checked: boolean) => void
  onCancel: () => void
}): JSX.Element {
  const [checked, setChecked] = useState(checkboxDefault)

  return (
    <Dialog onClose={onCancel} size="sm" raised>
      <DialogHeader title={title} />
      <DialogBody className="flex flex-col gap-3">
        <p className="text-[13px] text-muted-foreground">{message}</p>
        {checkboxLabel !== undefined && (
          <div className="flex items-center gap-3 rounded-[14px] border border-glass-border bg-glass px-3.5 py-2.5 text-[13px]">
            <span className="min-w-0 flex-1">{checkboxLabel}</span>
            <Switch checked={checked} onCheckedChange={setChecked} aria-label={checkboxLabel} />
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant={destructive ? 'destructive' : 'default'} size="sm" onClick={() => onConfirm(checked)}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
