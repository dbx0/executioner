import type { JSX } from 'react'
import { Select } from '../../components/ui/select.js'
import { Switch } from '../../components/ui/switch.js'

/** Per-node execution settings (timeout, on-failure, save policy), stored as reserved params. */
export function ExecutionSettings({
  timeoutMs,
  onFailure,
  noSave,
  onChange,
}: {
  timeoutMs: unknown
  onFailure: unknown
  noSave: unknown
  onChange: (key: string, value: unknown) => void
}): JSX.Element {
  const inputClass =
    'rounded-md border border-input bg-transparent px-2 py-1 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
  const saves = !(noSave === true || String(noSave ?? '') === 'true')
  return (
    <div className="flex flex-col gap-3 border-t border-border p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Execution</div>
      <label className="flex flex-col gap-1 text-sm">
        <span>Timeout (ms)</span>
        <input
          type="number"
          className={inputClass}
          placeholder="default"
          value={timeoutMs === undefined || timeoutMs === '' ? '' : String(timeoutMs)}
          onChange={(e) => onChange('__timeout_ms', e.target.value === '' ? undefined : Number(e.target.value))}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>On failure</span>
        <Select
          value={String(onFailure ?? 'continue')}
          onValueChange={(v) => onChange('__on_failure', v)}
          options={[
            { value: 'continue', label: 'Continue the workflow' },
            { value: 'stop', label: 'Stop the workflow' },
          ]}
        />
      </label>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0">
          Save results to target
          <span className="block text-[11px] text-muted-foreground">Off: run the tool but don&apos;t persist its output.</span>
        </span>
        <Switch checked={saves} onCheckedChange={(on) => onChange('__no_save', on ? undefined : true)} aria-label="Save results to target" />
      </div>
    </div>
  )
}
