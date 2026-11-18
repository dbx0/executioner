import type { JSX } from 'react'
import { Check } from 'lucide-react'
import type { ScopeProposal } from '../../../api/scope.js'
import { stagger } from '../../../lib/motion.js'
import { cn } from '../../../lib/utils.js'

/** The agent's drafted boundary, shown for the operator to confirm before anything is saved. */
export function ProposalReview({ proposal, error }: { proposal: ScopeProposal; error: string | null }): JSX.Element {
  return (
    <>
      <div className="mb-2 text-[13px] font-medium">Review what the agent found</div>
      <ul className="flex flex-col gap-1.5">
        {proposal.rules.map((r, i) => (
          <li
            key={`${r.effect}:${r.pattern}`}
            className="flex items-baseline gap-2.5 rounded-[14px] border border-glass-border bg-glass px-3 py-2 motion-safe:animate-enter"
            // The delay is computed per row, which a class cannot express.
            style={stagger(i, 140)}
          >
            <span
              className={cn(
                'shrink-0 rounded-control px-2 py-0.5 text-[11px] font-medium capitalize',
                r.effect === 'include' ? 'bg-glass-active text-foreground' : 'bg-status-error/15 text-status-error',
              )}
            >
              {r.effect}
            </span>
            <span className="font-mono text-[13px]">{r.pattern}</span>
            {r.note !== undefined && r.note !== '' && (
              <span className="min-w-0 truncate text-[12px] text-muted-foreground">{r.note}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-muted-foreground">
        {proposal.targets.length} {proposal.targets.length === 1 ? 'target' : 'targets'} to record. Nothing is saved
        until you add it.
      </p>
      {error !== null && <p className="mt-3 text-[12px] text-status-error">{error}</p>}
    </>
  )
}

/** What the write left behind: rules added and targets recorded. */
export function DoneSummary({
  rulesAdded,
  targetsAdded,
  unfinished,
}: {
  rulesAdded: number
  targetsAdded: number
  /** The agent stopped before it finished. */
  unfinished: boolean
}): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
        <Check className="size-4" strokeWidth={2.5} />
      </div>
      <div>
        <div className="text-[14px] font-medium">
          {rulesAdded} {rulesAdded === 1 ? 'rule' : 'rules'} added
        </div>
        <div className="text-[12.5px] text-muted-foreground">
          {targetsAdded} {targetsAdded === 1 ? 'target' : 'targets'} recorded from the same paste
          {unfinished ? ' · the agent did not finish' : ''}
        </div>
      </div>
    </div>
  )
}
