import type { JSX } from 'react'
import { useState } from 'react'
import { Button } from '../ui/button.js'
import { Switch } from '../ui/switch.js'

/**
 * A small in-app confirmation modal (replaces window.confirm). Optionally shows
 * a checkbox whose value is passed to onConfirm.
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6" onClick={onCancel}>
      <div
        className="flex w-[420px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3 text-[14px] font-medium">{title}</div>
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="text-[13px] text-muted-foreground">{message}</p>
          {checkboxLabel !== undefined && (
            <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-[13px]">
              <span className="min-w-0 flex-1">{checkboxLabel}</span>
              <Switch checked={checked} onCheckedChange={setChecked} aria-label={checkboxLabel} />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} size="sm" onClick={() => onConfirm(checked)}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
