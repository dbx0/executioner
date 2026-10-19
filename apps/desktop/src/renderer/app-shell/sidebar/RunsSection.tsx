import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useApp } from '../../store.js'
import { executionsApi, type ExecutionSummary } from '../../api/executions.js'
import { cn } from '../../lib/utils.js'

function runDotClass(status: string): string {
  if (status === 'succeeded' || status === 'success') return 'bg-status-success'
  if (status === 'running') return 'bg-status-running animate-pulse'
  return 'bg-status-error'
}

/** The most recent runs, in an expandable footer section. Shows the latest 5,
 *  scrollable when the list is tall; clicking a run opens it in the Workflows
 *  hub's runs list. Always starts collapsed — the section sits under the whole
 *  sidebar, and an auto-expanded list shoves the nav around on every launch. */
export function RunsSection(): JSX.Element {
  const client = useApp((s) => s.client)
  const openExecution = useApp((s) => s.openExecution)
  const api = useMemo(() => (client === null ? null : executionsApi(client)), [client])
  const [runs, setRuns] = useState<ExecutionSummary[]>([])
  const [collapsed, setCollapsed] = useState(true)

  useEffect(() => {
    if (api === null) return
    let alive = true
    const tick = (): void => {
      void api
        .list()
        .then((list) => alive && setRuns(list.slice(0, 5)))
        .catch(() => {})
    }
    tick()
    const t = setInterval(tick, 2500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [api])

  if (runs.length === 0) return <></>
  return (
    <div className="shrink-0 border-t border-sidebar-border px-2 pb-2">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1 px-1 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-sidebar-foreground"
      >
        <ChevronDown className={cn('size-3.5 transition-transform', collapsed && '-rotate-90')} strokeWidth={2} />
        <span>Runs</span>
      </button>
      {!collapsed && (
        <div className="scrollbar-sleek flex max-h-44 flex-col gap-0.5 overflow-y-auto">
          {runs.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => openExecution(r.id)}
              className="group flex h-7 w-full shrink-0 items-center gap-2 rounded-md px-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-surface-2"
            >
              <span className={cn('size-2 shrink-0 rounded-full', runDotClass(r.status))} />
              <span className="truncate font-mono text-[11.5px]">{r.id.slice(0, 8)}</span>
              <span className="ml-auto shrink-0 truncate text-[11px] capitalize text-muted-foreground">{r.status}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
