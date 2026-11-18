import type { JSX } from 'react'
import { ArrowRight, CirclePlus, Clock, Trash2 } from 'lucide-react'
import type { Action } from '../../api/actions.js'
import type { BackendProfile } from '../../api/backends.js'
import type { TargetSummary } from '../../api/targets.js'
import type { WorkflowSummary } from '../../api/workflows.js'
import type { ActionTool } from '../../components/actions/NewActionPanel.js'
import { Button } from '../../components/ui/button.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { Switch } from '../../components/ui/switch.js'
import { intervalText, kindWithArticle, runsOnText } from '../../lib/actions.js'
import { cn } from '../../lib/utils.js'

/** The names an action row needs to say what it does. */
export interface Names {
  workflows: WorkflowSummary[]
  tools: ActionTool[]
  targets: TargetSummary[]
  backends: BackendProfile[]
}

/** What an action runs, in words, and what kind of thing that is. */
export function describeRun(action: Action, names: Names): { title: string; kind: 'Workflow' | 'Tool' } {
  if (action.workflowId !== null) {
    const workflow = names.workflows.find((w) => w.id === action.workflowId)
    return { title: `Run ${workflow?.name ?? 'a workflow that no longer exists'}`, kind: 'Workflow' }
  }
  const tool = names.tools.find((t) => t.type === action.nodeType)
  return { title: `Run ${tool?.label ?? action.nodeType ?? 'a tool'}`, kind: 'Tool' }
}

export function ActionRow({
  action,
  on,
  names,
  onToggle,
  onDelete,
}: {
  action: Action
  /** Whether it fires here: for a default, this engagement's own switch. */
  on: boolean
  names: Names
  onToggle: (enabled: boolean) => void
  onDelete: () => void
}): JSX.Element {
  const timed = action.kind === 'interval'
  const run = describeRun(action, names)
  const target = action.targetId === null ? undefined : names.targets.find((t) => t.id === action.targetId)
  const kind = action.targetKind ?? 'target'

  return (
    <li className={cn('group flex items-center gap-4 px-4 py-3', !on && 'text-muted-foreground')}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-glass-strong">
        {timed ? (
          <Clock className="size-4 text-muted-foreground" strokeWidth={1.75} />
        ) : (
          <CirclePlus className={cn('size-4', on ? 'text-activity' : 'text-muted-foreground')} strokeWidth={1.75} />
        )}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13.5px] font-medium">
          {timed ? (
            intervalText(action.intervalSeconds)
          ) : (
            `When ${kindWithArticle(kind)} is added`
          )}
        </span>
        <span className="truncate text-[12px] text-muted-foreground">
          {timed ? 'In this engagement' : action.inScopeOnly ? 'Only if it is in scope' : 'Any scope'}
          {!on && ' · switched off'}
        </span>
      </div>

      <ArrowRight className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13.5px] font-medium">
          {run.title}
          {target !== undefined && (
            <>
              {' '}
              on <span className="font-mono text-[12.5px]">{target.value}</span>
            </>
          )}
        </span>
        <span className="truncate text-[12px] text-muted-foreground">
          {run.kind} · {runsOnText(action.backendProfileId, names.backends)}
        </span>
      </div>

      <Switch checked={on} onCheckedChange={onToggle} aria-label={on ? 'Switch this action off' : 'Switch this action on'} />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Delete action"
        className="text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        onClick={onDelete}
      >
        <Trash2 className="size-4" strokeWidth={1.75} />
      </Button>
    </li>
  )
}

/** A section's title with the one line that says what belongs in it. */
export function SectionHeading({ title, hint }: { title: string; hint: string }): JSX.Element {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      <span className="text-[12.5px] text-muted-foreground">{hint}</span>
    </div>
  )
}

/** A titled list of action rows, or the line that says why it is empty. */
export function Section({
  title,
  hint,
  empty,
  children,
}: {
  title: string
  hint: string
  empty: string
  children: JSX.Element[]
}): JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <SectionHeading title={title} hint={hint} />
      {children.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-glass-border px-4 py-5 text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-glass-border overflow-hidden rounded-[14px] border border-glass-border bg-glass">{children}</ul>
      )}
    </section>
  )
}


/** The page while the actions load: two sections of rows in the shape of the real ones. */
export function ActionsSkeleton(): JSX.Element {
  return (
    <div role="status" aria-label="Loading actions" className="flex flex-col gap-7">
      {[2, 1].map((count) => (
        <div key={count} className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-40" />
          <div className="divide-y divide-glass-border overflow-hidden rounded-[14px] border border-glass-border bg-glass">
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
