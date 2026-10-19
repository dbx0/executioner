import type { JSX } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { useApp } from '../../../store.js'
import { EngagementBadge } from '../../EngagementBadge.js'
import type { TabId } from './constants.js'

type ScopeRunState = ReturnType<typeof useApp.getState>['scopeRuns'][string] | undefined

/** The ephemeral "phone-message" bubble stack: newest at the bottom, older ones fade. */
export function RunningPage({ scopeRun }: { scopeRun: ScopeRunState }): JSX.Element {
  const bubbles = scopeRun?.bubbles ?? []
  const recent = bubbles.slice(-5)
  return (
    <div className="flex min-h-[220px] flex-col">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-medium">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
        Parsing scope and adding targets…
      </div>
      <div className="flex flex-1 flex-col justify-end gap-1.5 rounded-lg border border-border bg-surface-1 p-3">
        {recent.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">Starting…</div>
        ) : (
          recent.map((b, i) => {
            // Fade older bubbles; the newest is full strength.
            const depth = recent.length - 1 - i
            const opacity = Math.max(0.25, 1 - depth * 0.22)
            return (
              <div
                key={b.id}
                style={{ opacity }}
                className="animate-zoom-in self-start rounded-lg rounded-bl-sm border border-border bg-card px-3 py-1.5 text-[12.5px] shadow-sm transition-opacity"
              >
                {b.message}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export function ConfirmationPage(props: {
  tab: TabId
  scopeRun: ScopeRunState
  manualSummary: { count: number } | null
  name: string
  icon: string | undefined
  photo: string | undefined
}): JSX.Element {
  const summary = props.scopeRun?.summary
  const targetCount = props.tab === 'manual' ? (props.manualSummary?.count ?? 0) : (summary?.total ?? 0)
  const targets = summary?.targets ?? []

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex items-center gap-3">
        <EngagementBadge
          name={props.name}
          icon={props.icon}
          photo={props.photo}
          className="size-11 rounded-xl bg-primary text-primary-foreground"
          fallback={<Check className="size-5" strokeWidth={2.5} />}
        />
        <div>
          <div className="text-[15px] font-medium">{props.name} is ready</div>
          <div className="text-[12.5px] text-muted-foreground">
            {targetCount} {targetCount === 1 ? 'target' : 'targets'} added · methodology folders created
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Created</div>
        <ul className="space-y-1 text-[12.5px]">
          <li className="flex items-center gap-2">
            <Check className="size-3.5 text-status-success" strokeWidth={2.5} /> HUNT.md, docs/SCOPE.md
          </li>
          <li className="flex items-center gap-2">
            <Check className="size-3.5 text-status-success" strokeWidth={2.5} /> recon/, vuln/, notes/, evidence/
          </li>
          {targetCount > 0 && (
            <li className="flex items-center gap-2">
              <Check className="size-3.5 text-status-success" strokeWidth={2.5} /> {targetCount} target
              {targetCount === 1 ? '' : 's'}
            </li>
          )}
        </ul>
        {targets.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {targets.slice(0, 24).map((t) => (
              <span
                key={`${t.kind}:${t.value}`}
                className="rounded-md border border-border bg-surface-1 px-2 py-0.5 text-[11.5px]"
              >
                {t.value}
              </span>
            ))}
          </div>
        )}
        {props.scopeRun?.error === true && (
          <p className="mt-2 text-[12px] text-muted-foreground">The AI parse did not complete; targets were added by the built-in parser.</p>
        )}
      </div>
    </div>
  )
}
