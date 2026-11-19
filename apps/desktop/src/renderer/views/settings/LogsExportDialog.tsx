import type { JSX } from 'react'
import { useState } from 'react'
import { Button } from '../../components/ui/button.js'
import { Checkbox } from '../../components/ui/checkbox.js'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../../components/ui/dialog.js'
import { Spinner } from '../../components/ui/spinner.js'

export interface LogsExportOptions {
  includeTargets: boolean
  includeAllSessions: boolean
}

/** The export dialog: what the bug-report zip may contain. Both extras are off by default. */
export function LogsExportDialog({
  onExport,
  onCancel,
  busy,
}: {
  onExport: (opts: LogsExportOptions) => void
  onCancel: () => void
  busy: boolean
}): JSX.Element {
  const [includeTargets, setIncludeTargets] = useState(false)
  const [includeAllSessions, setIncludeAllSessions] = useState(false)
  return (
    <Dialog onClose={onCancel} size="sm" className="w-[440px]" dismissable={!busy}>
      <DialogHeader title="Export logs for a bug report" />
      <DialogBody className="flex flex-col gap-3 text-[13px]">
        <p className="text-muted-foreground">
          Saves a zip you can attach to a bug report. Secrets are always masked. Targets, prompts and tool output are
          left out unless you include them.
        </p>
        <div>
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox checked={includeTargets} onCheckedChange={setIncludeTargets} />
            Include target details
          </label>
          <p className="ml-6 mt-1 text-xs text-muted-foreground">
            Also includes crash dumps, which can contain unscrubbed data. Only send this privately.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={includeAllSessions} onCheckedChange={setIncludeAllSessions} />
          Include all recent sessions
        </label>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy} onClick={() => onExport({ includeTargets, includeAllSessions })}>
          {busy && <Spinner size="sm" />}
          Export
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
