import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, ShieldCheck, ShieldX } from 'lucide-react'
import { useApp } from '../store.js'
import { stagger, useNewIds } from '../lib/motion.js'
import { targetsApi, type Rejudge, type ScopeRule } from '../api/targets.js'
import { cn } from '../lib/utils.js'
import { Button } from '../components/ui/button.js'
import { GlassPanel } from '../components/ui/glass-panel.js'
import { Page, PageBody, PageToolbar } from '../components/ui/page.js'
import { Skeleton } from '../components/ui/skeleton.js'
import { Spinner } from '../components/ui/spinner.js'
import { AddScopeRuleModal } from '../components/modals/AddScopeRuleModal.js'

const describeRejudged = ({ rejudged, inScope, outOfScope }: Rejudge): string | null =>
  rejudged === 0
    ? null
    : `Re-judged ${rejudged} ${rejudged === 1 ? 'target' : 'targets'}. ${inScope} in scope, ${outOfScope} out of scope.`

/** Placeholder rows in the shape of a rule (icon, pattern, source), so the list does not jump when rules land. */
function ScopeRulesSkeleton(): JSX.Element {
  return (
    <div role="status" aria-label="Loading scope rules" className="flex flex-col gap-0.5">
      {['w-48', 'w-64', 'w-40', 'w-56'].map((width) => (
        <div key={width} className="flex h-10 items-center gap-2 px-3">
          <Skeleton className="size-3.5 rounded-full" />
          <Skeleton className={cn('h-3', width)} />
          <Skeleton className="ml-auto h-3 w-12" />
        </div>
      ))}
    </div>
  )
}

/**
 * The engagement's boundary, as an editable list.
 *
 * Every write re-judges the whole tree, and the page says how many verdicts
 * moved: an operator adding an exclusion wants to see that it reached the assets
 * already sitting in the tree, not only the ones discovered next.
 */
export function ScopeView(): JSX.Element {
  const client = useApp((s) => s.client)
  const api = useMemo(() => (client === null ? null : targetsApi(client)), [client])

  const activeRoot = useApp((s) => s.activeRoot)
  const [rules, setRules] = useState<ScopeRule[] | null>(null)
  // Which engagement the loaded rules belong to, so a switch never diffs against the old one.
  const [loadedRoot, setLoadedRoot] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The rule being removed, so its own button carries the spinner.
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    if (api === null) return
    try {
      setRules(await api.scopeRules())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
      setRules([])
    }
    setLoadedRoot(activeRoot)
  }, [api, activeRoot])

  useEffect(() => {
    void load()
  }, [load])

  const applied = useCallback(
    (rejudge: Rejudge | null) => {
      setError(null)
      setStatus(rejudge === null ? null : describeRejudged(rejudge))
      void load()
    },
    [load],
  )

  const remove = async (rule: ScopeRule): Promise<void> => {
    if (api === null) return
    setBusy(true)
    setRemoving(rule.id)
    setError(null)
    setStatus(null)
    try {
      const { rejudged, inScope, outOfScope } = await api.removeScopeRule(rule.id)
      setStatus(describeRejudged({ rejudged, inScope, outOfScope }))
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setRemoving(null)
    }
  }

  const sorted = useMemo(
    () =>
      (rules ?? [])
        .slice()
        .sort((a, b) => (a.effect === b.effect ? a.pattern.localeCompare(b.pattern) : a.effect === 'exclude' ? -1 : 1)),
    [rules],
  )

  const newIds = useNewIds(
    useMemo(() => (loadedRoot === activeRoot ? sorted.map((r) => r.id) : []), [sorted, loadedRoot, activeRoot]),
    activeRoot,
    rules !== null && loadedRoot === activeRoot,
  )
  // Stagger by position among the new rows, so a lone rule never waits on its row number.
  const newOrder = useMemo(() => new Map([...newIds].map((id, i) => [id, i])), [newIds])

  return (
    <Page>
      <PageToolbar
        title="Scope"
        meta={rules === null ? undefined : sorted.length}
        actions={
          <Button
            size="sm"
            data-tour="scope-add"
            disabled={client === null || busy}
            onClick={() => setShowAdd(true)}
          >
            <Plus className="size-4" strokeWidth={2} />
            Add rule
          </Button>
        }
      />

      <PageBody>
        <GlassPanel className="flex min-w-0 flex-1 flex-col">
          {error !== null && (
            <div role="alert" className="shrink-0 border-b border-glass-border bg-destructive/10 px-4 py-2 text-[12px] text-destructive">
              {error}
            </div>
          )}
          {error === null && status !== null && (
            <div role="status" className="shrink-0 border-b border-glass-border px-4 py-2 text-[12px] text-muted-foreground">
              {status}
            </div>
          )}

          <div data-tour="scope-rules" className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto p-2">
            {rules === null ? (
              <ScopeRulesSkeleton />
            ) : sorted.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                No scope rules yet. Every asset will be flagged as unscoped until you add one.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {sorted.map((rule) => (
                  <li
                    key={rule.id}
                    data-new={newIds.has(rule.id) ? 'true' : undefined}
                    className={cn(
                      'flex items-center gap-2 rounded-[10px] py-1 pl-3 pr-1 transition-colors hover:bg-glass-strong',
                      newIds.has(rule.id) && 'motion-safe:animate-enter-x',
                    )}
                    style={newIds.has(rule.id) ? stagger(newOrder.get(rule.id) ?? 0, 70) : undefined}
                  >
                    {rule.effect === 'exclude' ? (
                      <ShieldX className="size-3.5 shrink-0 text-destructive" strokeWidth={1.75} />
                    ) : (
                      <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    )}
                    <span className="truncate font-mono text-[12.5px]">{rule.pattern}</span>
                    {rule.note !== '' && <span className="truncate text-[11.5px] text-muted-foreground">{rule.note}</span>}
                    <span className="ml-auto shrink-0 text-[10.5px] uppercase tracking-wide text-muted-foreground">
                      {rule.source}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      aria-label={`Remove ${rule.pattern}`}
                      onClick={() => void remove(rule)}
                    >
                      {removing === rule.id ? <Spinner size="sm" /> : <Trash2 className="size-3.5" strokeWidth={1.75} />}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </GlassPanel>
      </PageBody>

      {showAdd && (
        <AddScopeRuleModal onClose={() => setShowAdd(false)} onApplied={applied} />
      )}
    </Page>
  )
}
