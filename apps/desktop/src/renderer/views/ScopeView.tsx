import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, ShieldCheck, ShieldX } from 'lucide-react'
import { useApp } from '../store.js'
import { targetsApi, type ScopeRule } from '../api/targets.js'
import { Button } from '../components/ui/button.js'
import { Badge } from '../components/ui/badge.js'
import { AddScopeRuleModal } from '../components/modals/AddScopeRuleModal.js'

const describeRejudged = (n: number): string | null =>
  n === 0 ? null : `Re-judged ${n} ${n === 1 ? 'target' : 'targets'}.`

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

  const [rules, setRules] = useState<ScopeRule[] | null>(null)
  const [busy, setBusy] = useState(false)
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
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const applied = useCallback(
    (rejudged: number | null) => {
      setError(null)
      setStatus(rejudged === null ? null : describeRejudged(rejudged))
      void load()
    },
    [load],
  )

  const remove = async (rule: ScopeRule): Promise<void> => {
    if (api === null) return
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const { rejudged } = await api.removeScopeRule(rule.id)
      setStatus(describeRejudged(rejudged))
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const sorted = useMemo(
    () =>
      (rules ?? [])
        .slice()
        .sort((a, b) => (a.effect === b.effect ? a.pattern.localeCompare(b.pattern) : a.effect === 'exclude' ? -1 : 1)),
    [rules],
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <h1 className="text-sm font-medium">Scope</h1>
        <Badge variant="outline">{sorted.length}</Badge>
        <Button
          size="sm"
          className="ml-auto shrink-0"
          disabled={client === null || busy}
          onClick={() => setShowAdd(true)}
        >
          <Plus className="size-4" strokeWidth={2} />
          Add rule
        </Button>
      </div>

      {error !== null && (
        <div className="shrink-0 border-b border-border bg-destructive/10 px-4 py-1.5 text-[12px] text-destructive">
          {error}
        </div>
      )}
      {error === null && status !== null && (
        <div className="shrink-0 border-b border-border px-4 py-1.5 text-[12px] text-muted-foreground">{status}</div>
      )}

      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {rules === null ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            No scope rules yet — every asset will be flagged as unscoped until you add one.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {sorted.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2"
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
                  <Trash2 className="size-3.5" strokeWidth={1.75} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showAdd && (
        <AddScopeRuleModal onClose={() => setShowAdd(false)} onApplied={applied} />
      )}
    </div>
  )
}
