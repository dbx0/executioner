import type { JSX } from 'react'
import { SEVERITIES, STATUSES, statusLabel } from '../../api/findings.js'
import type { SelectOption } from '../../components/ui/select.js'
import { SeverityDot, severityLabel, severityPillClass, statusPillClass } from './chips.js'
import { PillSelect } from './PillSelect.js'

const severityOptions: SelectOption[] = SEVERITIES.map((s) => ({
  value: s,
  label: severityLabel(s),
  icon: <SeverityDot severity={s} className="size-[7px]" />,
}))

const statusOptions: SelectOption[] = STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))

/**
 * The triage row under the title: how bad the finding is, where it stands, and
 * the asset it is on. Severity and status are pill menus tinted by their
 * current value, so the two calls read at a glance before any prose does.
 */
export function FindingTriage({
  severity,
  status,
  targetValue,
  onSeverityChange,
  onStatusChange,
}: {
  severity: string
  status: string
  /** The asset the finding is on, or null when it has none. */
  targetValue: string | null
  onSeverityChange: (severity: string) => void
  onStatusChange: (status: string) => void
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <PillSelect
        ariaLabel="Severity"
        value={severity}
        onValueChange={onSeverityChange}
        options={severityOptions}
        className={severityPillClass(severity)}
      />
      <PillSelect
        ariaLabel="Status"
        value={status}
        onValueChange={onStatusChange}
        options={statusOptions}
        className={statusPillClass(status)}
      />
      <span
        aria-label="Target"
        className="flex h-[30px] min-w-0 items-center rounded-control bg-glass-strong px-3 font-mono text-xs"
      >
        <span className="truncate">{targetValue ?? 'no target'}</span>
      </span>
    </div>
  )
}
