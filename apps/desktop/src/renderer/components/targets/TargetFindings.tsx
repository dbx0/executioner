import type { JSX } from 'react'
import type { TargetDetail } from '../../api/targets.js'
import { useApp } from '../../store.js'
import { SeverityChip, StatusChip } from '../../views/findings/chips.js'
import { Hint } from './Hint.js'

/** This asset's findings, worst first; clicking one opens it on the Findings page. */
export function TargetFindings({ findings }: { findings: TargetDetail['findings'] }): JSX.Element {
  const openFinding = useApp((st) => st.openFinding)
  if (findings.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground">Nothing recorded against this target yet.</p>
  }
  return (
    <div className="-mx-2 flex flex-col">
      {findings.map((f) => (
        <Hint key={f.id} label="Open on the Findings page">
          <button
            type="button"
            onClick={() => openFinding(f.id)}
            className="flex w-full min-w-0 items-center gap-2 h-9 rounded-lg px-2 text-left outline-none transition-colors hover:bg-glass-strong focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <SeverityChip severity={f.severity} />
            <span className="min-w-0 flex-1 truncate text-[13px]">{f.title}</span>
            <StatusChip status={f.status} />
          </button>
        </Hint>
      ))}
    </div>
  )
}
