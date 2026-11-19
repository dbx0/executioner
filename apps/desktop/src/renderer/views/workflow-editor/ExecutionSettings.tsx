import type { JSX } from 'react'
import { Select } from '../../components/ui/select.js'
import { Switch } from '../../components/ui/switch.js'
import { NumericField } from '../../components/canvas/NumericField.js'
import { PanelSection, SectionTitle } from '../../components/canvas/surface.js'

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
  const saves = !(noSave === true || String(noSave ?? '') === 'true')
  const timeout = timeoutMs === undefined || timeoutMs === '' ? undefined : Number(timeoutMs)
  return (
    <PanelSection className="text-[13px]">
      <SectionTitle>Execution</SectionTitle>
      <div className="flex flex-col gap-1.5">
        <span className="font-medium">Timeout (ms)</span>
        <NumericField
          aria-label="Timeout (ms)"
          placeholder="default"
          value={timeout}
          onChange={(n) => onChange('__timeout_ms', n)}
          className="h-8 text-[13px]"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-medium">On failure</span>
        <Select
          ariaLabel="On failure"
          value={String(onFailure ?? 'continue')}
          onValueChange={(v) => onChange('__on_failure', v)}
          options={[
            { value: 'continue', label: 'Continue the workflow' },
            { value: 'stop', label: 'Stop the workflow' },
          ]}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="font-medium">Save results to target</span>
          <span className="block text-[11px] text-muted-foreground">Off: run the tool but don&apos;t persist its output.</span>
        </span>
        <Switch checked={saves} onCheckedChange={(on) => onChange('__no_save', on ? undefined : true)} aria-label="Save results to target" />
      </div>
    </PanelSection>
  )
}
