import type { JSX } from 'react'
import type { BackendProfile } from '../../api/backends.js'
import type { TargetNode } from '../../api/targets.js'
import { Button } from '../../components/ui/button.js'
import { Checkbox } from '../../components/ui/checkbox.js'
import { Select, type SelectOption } from '../../components/ui/select.js'
import { Spinner } from '../../components/ui/spinner.js'
import { TargetPicker } from '../../components/canvas/TargetPicker.js'
import { FloatingPanel, SectionTitle } from '../../components/canvas/surface.js'

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
  starting = false,
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
  /** The run is being saved and launched: the Run button spins and cannot be pressed again. */
  starting?: boolean
}): JSX.Element {
  return (
    <FloatingPanel className="absolute right-0 top-0 z-10 w-72 overflow-visible p-3.5">
      <div className="mb-3 text-[13px] font-semibold tracking-[-0.01em]">Run workflow</div>
      <SectionTitle className="mb-1.5">Target</SectionTitle>
      <div className="mb-3">
        <TargetPicker targets={targets} value={targetId} onChange={onTargetChange} />
      </div>
      <div className="mb-1.5 flex items-center justify-between">
        <SectionTitle>Backend</SectionTitle>
        <button
          type="button"
          onClick={onManageBackends}
          className="rounded-control px-1.5 text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
          onCheckedChange={onStepModeChange}
          className="size-3.5"
        />
        <span>Step through (pause between nodes)</span>
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={targetId === undefined || starting} onClick={onRun}>
          {starting && <Spinner size="sm" />}
          {stepMode ? 'Start stepping' : 'Run'}
        </Button>
      </div>
    </FloatingPanel>
  )
}
