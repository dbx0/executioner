import type { JSX } from 'react'
import type { Overview } from '../../api/overview.js'
import { stagger } from '../../lib/motion.js'
import { SeverityChip } from '../findings/chips.js'
import { CardEmpty } from './Card.js'

/** The assets carrying the most findings: where the engagement actually landed.
 *  The severity chip is the Findings page's own, so both pages color it alike. */
export function TopTargets({
  targets,
  onOpen,
}: {
  targets: Overview['findings']['topTargets']
  onOpen: (id: string) => void
}): JSX.Element {
  if (targets.length === 0) return <CardEmpty>No findings are attached to an asset yet.</CardEmpty>
  return (
    <ul className="-mx-1.5 flex flex-col gap-0.5">
      {targets.map((t, i) => (
        <li key={t.id} className="motion-safe:animate-enter-x" style={stagger(i, 60, 900)}>
          <button
            type="button"
            onClick={() => onOpen(t.id)}
            className="flex w-full items-center gap-2 rounded-control px-2 py-1 text-left outline-none transition-colors hover:bg-glass-strong focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <SeverityChip severity={t.worst} />
            <span className="truncate font-mono text-[12.5px]">{t.value}</span>
            <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
              {t.findings} {t.findings === 1 ? 'finding' : 'findings'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
