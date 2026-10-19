import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Plus, ShieldCheck, X } from 'lucide-react'
import { useApp } from '../store.js'
import { targetsApi, type TargetNode } from '../api/targets.js'
import { workflowsApi, type WorkflowSummary } from '../api/workflows.js'
import { executionsApi } from '../api/executions.js'
import { backendsApi } from '../api/backends.js'
import { cn } from '../lib/utils.js'
import { Button } from '../components/ui/button.js'
import { Input } from '../components/ui/input.js'
import { Badge } from '../components/ui/badge.js'
import { VirtualTargetTree } from '../components/targets/VirtualTargetTree.js'
import { TargetTreeSkeleton } from '../components/targets/TargetTreeSkeleton.js'
import { TargetDetailPanel } from '../components/targets/TargetDetail.js'
import { AddTargetModal } from '../components/modals/AddTargetModal.js'
import { countByScope, filterTreeByScope, type ScopeFilter } from '../components/targets/ScopeBadge.js'
import { TargetContextMenu } from '../components/targets/TargetContextMenu.js'
import { LOCAL_BACKEND, type RunBackend } from '../lib/target-actions.js'

function countTree(nodes: TargetNode[]): number {
  return nodes.reduce((acc, n) => acc + 1 + countTree(n.children), 0)
}

/** Depth-first lookup of a target by id in the (possibly nested) tree. */
function findInTree(nodes: TargetNode[], id: string): TargetNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = findInTree(n.children, id)
    if (hit !== null) return hit
  }
  return null
}

export function TargetsView(): JSX.Element {
  const client = useApp((s) => s.client)
  // Scalar selects only — deriving the node from the tree happens in the effect.
  const pendingTargetId = useApp((s) => s.pendingTargetId)
  const setPendingTargetId = useApp((s) => s.setPendingTargetId)
  const setActiveView = useApp((s) => s.setActiveView)
  const openTools = useApp((s) => s.openTools)
  const api = useMemo(() => (client === null ? null : targetsApi(client)), [client])

  const [tree, setTree] = useState<TargetNode[]>([])
  const [loading, setLoading] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [backends, setBackends] = useState<RunBackend[]>([LOCAL_BACKEND])
  const [notice, setNotice] = useState<string | null>(null)
  // Closing the detail pane drops the selection, so the page opens with the
  // pane shut and any row click opens it again.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const detailOpen = selectedId !== null

  const refresh = useCallback(async () => {
    if (api === null) return
    setLoading(true)
    try {
      setTree(await api.tree())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
      setLoadedOnce(true)
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // The right-click menu offers workflows and everywhere they could run. Both
  // are fetched up front so opening the menu never waits on the network.
  useEffect(() => {
    if (client === null) return
    let alive = true
    void workflowsApi(client)
      .list()
      .then((list) => alive && setWorkflows(list))
      .catch(() => {})
    void backendsApi(client)
      .list()
      .then((profiles) => {
        if (!alive) return
        setBackends([LOCAL_BACKEND, ...profiles.map((p) => ({ id: p.id, name: p.name }))])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [client])

  // Deep-link from the command palette: reveal the requested target's detail.
  // The tree is expanded-by-default, so selecting is enough to make ancestors
  // visible. Fire once — clear the pending id whether or not the target still
  // exists (guards against a stale request), but only after the tree has
  // actually been fetched so we don't clear before it has a chance to load.
  useEffect(() => {
    if (pendingTargetId === null) return
    if (findInTree(tree, pendingTargetId) !== null) {
      setSelectedId(pendingTargetId)
      setPendingTargetId(null)
    } else if (loadedOnce && !loading) {
      setPendingTargetId(null)
    }
  }, [pendingTargetId, tree, loadedOnce, loading, setPendingTargetId])

  // Prune to matches (keeps a node if its value matches or a descendant survives).
  const filtered = useMemo(() => {
    const byScope = filterTreeByScope(tree, scopeFilter)
    if (filter.trim() === '') return byScope
    const q = filter.toLowerCase()
    const prune = (nodes: TargetNode[]): TargetNode[] =>
      nodes
        .map((n) => ({ ...n, children: prune(n.children) }))
        .filter((n) => n.value.toLowerCase().includes(q) || n.children.length > 0)
    return prune(byScope)
  }, [tree, filter, scopeFilter])

  const total = useMemo(() => countTree(tree), [tree])

  const describeRejudged = (n: number): string =>
    n === 0 ? '' : ` · re-judged ${n} ${n === 1 ? 'target' : 'targets'}`

  const changeScope = useCallback(
    async (effect: 'include' | 'exclude', pattern: string) => {
      if (api === null) return
      try {
        const { rejudged } = await api.addScopeRule({ effect, pattern })
        setNotice(`${effect === 'include' ? 'In scope' : 'Excluded'}: ${pattern}${describeRejudged(rejudged)}`)
        setError(null)
      } catch (e) {
        setError((e as Error).message)
      }
      await refresh()
    },
    [api, refresh],
  )

  const runWorkflowOn = useCallback(
    (workflowId: string, targetId: string, backendId: string) => {
      if (client === null) return
      // The backend came from the menu, which lists only connections that exist
      // — so unlike a remembered id, it cannot name a profile that was deleted.
      void executionsApi(client)
        .runWorkflow(workflowId, {
          targetId,
          ...(backendId !== LOCAL_BACKEND.id ? { backendProfileId: backendId } : {}),
        })
        .catch((e: Error) => setError(e.message))

      const where = backends.find((b) => b.id === backendId)?.name ?? LOCAL_BACKEND.name
      setNotice(`Running ${workflows.find((w) => w.id === workflowId)?.name ?? 'workflow'} on ${where}`)
    },
    [client, workflows, backends],
  )

  const deleteTarget = useCallback(
    async (node: TargetNode) => {
      if (api === null) return
      try {
        const { removed } = await api.remove(node.id)
        setNotice(`Deleted ${node.value}${removed > 1 ? ` and ${removed - 1} under it` : ''}`)
        setError(null)
        if (selectedId === node.id) setSelectedId(null)
      } catch (e) {
        setError((e as Error).message)
      }
      await refresh()
    },
    [api, refresh, selectedId],
  )
  const scopeCounts = useMemo(() => countByScope(tree), [tree])

  // The filter earns its row only when the verdicts actually differ. On an
  // engagement whose boundary is settled every asset is in scope, and a control
  // offering to hide nothing is just another thing to read past.
  const scopeTabs = useMemo(() => {
    const present = (['in', 'unknown', 'out'] as const).filter((key) => scopeCounts[key] > 0)
    if (present.length < 2) return []
    const label = { in: 'In scope', unknown: 'Unscoped', out: 'Out of scope' } as const
    return [
      { key: 'all' as const, label: 'All', count: total },
      ...present.map((key) => ({ key, label: label[key], count: scopeCounts[key] })),
    ]
  }, [scopeCounts, total])

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="text-sm font-medium">Targets</span>
        <Badge variant="outline">{total}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="h-8 w-44 text-[13px]"
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={client === null}
            onClick={() => setActiveView('scope')}
            aria-label="Edit scope rules"
          >
            <ShieldCheck className="size-4" strokeWidth={1.75} />
            Scope
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => void refresh()} aria-label="Refresh">
            <RefreshCw className={cn('size-4', loading && 'animate-[spin_1s_linear_infinite]')} strokeWidth={1.75} />
          </Button>
          <Button size="sm" disabled={client === null} onClick={() => setShowAdd(true)}>
            <Plus className="size-4" strokeWidth={2} />
            Add target
          </Button>
        </div>
      </div>

      {error !== null && (
        <div className="shrink-0 border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {error === null && notice !== null && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
          <span className="truncate">{notice}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="ml-auto shrink-0 opacity-60 hover:opacity-100"
            onClick={() => setNotice(null)}
          >
            <X className="size-3.5" strokeWidth={2} />
          </button>
        </div>
      )}

      {scopeTabs.length > 0 && (
        <div
          role="tablist"
          aria-label="Filter by scope"
          className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-1.5"
        >
          {scopeTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={scopeFilter === tab.key}
              onClick={() => setScopeFilter(tab.key)}
              className={cn(
                'rounded-md px-2 py-1 text-xs',
                scopeFilter === tab.key
                  ? 'bg-surface-3 font-medium'
                  : 'text-muted-foreground hover:bg-surface-2',
              )}
            >
              {tab.label}
              <span className="ml-1.5 tabular-nums opacity-60">{tab.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Tree on the left; the detail pane joins it only once a target is picked,
          so an unselected page gives the whole width to the list. */}
      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            'flex flex-col',
            detailOpen ? 'w-96 shrink-0 border-r border-border' : 'min-w-0 flex-1',
          )}
        >
          {!loadedOnce ? (
            <TargetTreeSkeleton />
          ) : filtered.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-4">
              <p className="text-sm text-muted-foreground">
                {total === 0 ? 'No targets yet. Add one above to begin.' : 'No targets match the filter.'}
              </p>
            </div>
          ) : (
            <VirtualTargetTree
              nodes={filtered}
              selectedId={selectedId}
              onSelect={(n) => setSelectedId(n.id)}
              filter={filter}
              renderRow={(node, row) => (
                <TargetContextMenu
                  node={node}
                  workflows={workflows}
                  backends={backends}
                  onAddToScope={(pattern) => void changeScope('include', pattern)}
                  onRemoveFromScope={(pattern) => void changeScope('exclude', pattern)}
                  onRunWorkflow={(workflowId, backendId) => runWorkflowOn(workflowId, node.id, backendId)}
                  onRunTool={() => openTools(node.id)}
                  onDelete={() => void deleteTarget(node)}
                >
                  {row}
                </TargetContextMenu>
              )}
            />
          )}
        </div>

        {api !== null && selectedId !== null && (
          <div className="min-w-0 flex-1">
            <TargetDetailPanel
              api={api}
              targetId={selectedId}
              onChanged={() => void refresh()}
              onDeleted={() => {
                setSelectedId(null)
                void refresh()
              }}
              onClose={() => setSelectedId(null)}
            />
          </div>
        )}
      </div>

      {showAdd && client !== null && (
        <AddTargetModal client={client} onClose={() => setShowAdd(false)} onCreated={() => void refresh()} />
      )}

    </div>
  )
}
