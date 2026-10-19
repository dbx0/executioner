import type { JSX } from 'react'
import type { BackendProfile } from '../../api/backends.js'
import type { TargetNode } from '../../api/targets.js'
import { Button } from '../../components/ui/button.js'
import { Checkbox } from '../../components/ui/checkbox.js'
import { Select, type SelectOption } from '../../components/ui/select.js'
import { TargetPicker } from '../../components/canvas/TargetPicker.js'

/** The floating "Run workflow" panel: target, backend and step-mode choices. */
export function RunPanel({
  targets,
  targetId,
  onTargetChange,
  profiles,
  backendId,
  onBackendChange,
  stepMode,
  onStepModeChange,
  onManageBackends,
  onCancel,
  onRun,
}: {
  targets: TargetNode[]
  targetId: string | undefined
  onTargetChange: (id: string | undefined) => void
  profiles: BackendProfile[]
  backendId: string
  onBackendChange: (id: string) => void
  stepMode: boolean
  onStepModeChange: (on: boolean) => void
  onManageBackends: () => void
  onCancel: () => void
  onRun: () => void
}): JSX.Element {
  return (
    <div className="absolute right-3 top-3 z-10 w-64 rounded-lg border border-border bg-popover p-3 shadow-floating">
      <div className="mb-2 text-[13px] font-medium">Run workflow</div>
      <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Target</label>
      <div className="mb-2">
        <TargetPicker targets={targets} value={targetId} onChange={onTargetChange} />
      </div>
      <div className="mb-1 flex items-center justify-between">
        <label className="block text-[11px] uppercase tracking-wide text-muted-foreground">Backend</label>
        <button
          type="button"
          onClick={onManageBackends}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          Manage
        </button>
      </div>
      <Select
        value={backendId}
        onValueChange={(v) => onBackendChange(v)}
        options={[
          { value: 'local', label: 'Local machine' },
          ...profiles.map(
            (p): SelectOption => ({ value: p.id, label: `${p.name} (${p.kind})` }),
          ),
        ]}
        className="mb-3"
      />
      <label className="mb-3 flex cursor-pointer items-center gap-2 text-[13px]">
        <Checkbox
          checked={stepMode}
          onChange={(e) => onStepModeChange(e.target.checked)}
          className="size-3.5"
        />
        <span>Step through (pause between nodes)</span>
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="xs" disabled={targetId === undefined} onClick={onRun}>
          {stepMode ? 'Start stepping' : 'Run'}
        </Button>
      </div>
    </div>
  )
}
