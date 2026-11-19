import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Plus, Search, ShieldCheck } from 'lucide-react'
import { useApp } from '../store.js'
import { useEngineChange } from '../lib/engine-changes.js'
import { targetsApi, type TargetNode } from '../api/targets.js'
import { workflowsApi, type WorkflowSummary } from '../api/workflows.js'
import { executionsApi } from '../api/executions.js'
import { backendsApi } from '../api/backends.js'
import { cn } from '../lib/utils.js'
import { Button } from '../components/ui/button.js'
import { GlassPanel } from '../components/ui/glass-panel.js'
import { Input } from '../components/ui/input.js'
import { Page, PageBody, PageToolbar } from '../components/ui/page.js'
import { Spinner } from '../components/ui/spinner.js'
import { VirtualTargetTree, useFlashIds } from '../components/targets/VirtualTargetTree.js'
import { TargetTreeSkeleton } from '../components/targets/TargetTreeSkeleton.js'
import { TargetDetailPanel } from '../components/targets/TargetDetail.js'
import { AddTargetModal } from '../components/modals/AddTargetModal.js'
import { Banner } from '../components/targets/Banner.js'
import { countByScope, filterTreeByScope, type ScopeFilter } from '../components/targets/ScopeBadge.js'
import { ScopeFilterTabs } from '../components/targets/ScopeFilterTabs.js'
import { TargetContextMenu } from '../components/targets/TargetContextMenu.js'
import { collectIds, countTree, filterTreeByText, findInTree } from '../components/targets/tree-utils.js'
import { LOCAL_BACKEND, type RunBackend } from '../lib/target-actions.js'

export function TargetsView(): JSX.Element {
  const client = useApp((s) => s.client)
  // Scalar selects only: deriving the node from the tree happens in the effect.
  const pendingTargetId = useApp((s) => s.pendingTargetId)
  const setPendingTargetId = useApp((s) => s.setPendingTargetId)
  const setActiveView = useApp((s) => s.setActiveView)
  const openTools = useApp((s) => s.openTools)
  const api = useMemo(() => (client === null ? null : targetsApi(client)), [client])

  const activeRoot = useApp((s) => s.activeRoot)
  const [tree, setTree] = useState<TargetNode[]>([])
  // Which engagement the tree belongs to, so a switch never diffs against the old one.
  const [treeRoot, setTreeRoot] = useState<string | null>(null)
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

  const refresh = useCallback(async (silent = false) => {
    if (api === null) return
    if (!silent) setLoading(true)
    try {
      const rows = await api.tree()
      setTree(rows)
      setTreeRoot(activeRoot)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      // A silent refresh never started the spinner, so it must not stop one a
      // manual refresh still owns.
      if (!silent) setLoading(false)
      setLoadedOnce(true)
    }
  }, [api, activeRoot])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Live refresh swaps the tree in place: no spinner, selection and scroll kept.
  useEngineChange(['targets', 'scope', 'findings'], () => void refresh(true))

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
  // visible. Fire once: clear the pending id whether or not the target still
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
  const filtered = useMemo(
    () => filterTreeByText(filterTreeByScope(tree, scopeFilter), filter),
    [tree, filter, scopeFilter],
  )

  const total = useMemo(() => countTree(tree), [tree])

  const allIds = useMemo(() => (treeRoot === activeRoot ? collectIds(tree) : []), [tree, treeRoot, activeRoot])
  const newIds = useFlashIds(allIds, activeRoot, loadedOnce && treeRoot === activeRoot)

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
      // The backend came from the menu, which lists only connections that exist,
      // so unlike a remembered id it cannot name a profile that was deleted.
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

  return (
    <Page>
      <PageToolbar
        title="Targets"
        meta={<span className="glass-capsule flex h-5 items-center px-2 text-[11px] text-foreground">{total}</span>}
        actions={
          <>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" strokeWidth={2} />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter targets"
                aria-label="Filter targets"
                data-tour="targets-filter"
                className="h-8 w-[220px] pl-8 text-[13px]"
              />
            </div>
            <Button
              variant="glass"
              size="sm"
              disabled={client === null}
              onClick={() => setActiveView('scope')}
              aria-label="Edit scope rules"
            >
              <ShieldCheck strokeWidth={1.75} />
              Scope
            </Button>
            <Button variant="glass" size="icon-sm" disabled={loading} onClick={() => void refresh()} aria-label="Refresh">
              {loading ? <Spinner size="sm" /> : <RefreshCw strokeWidth={1.75} />}
            </Button>
            <Button size="sm" data-tour="targets-add" disabled={client === null} onClick={() => setShowAdd(true)}>
              <Plus strokeWidth={2} />
              Add target
            </Button>
          </>
        }
      />

      {error !== null ? (
        <Banner tone="error" className="mb-panel">
          {error}
        </Banner>
      ) : (
        notice !== null && (
          <Banner tone="notice" className="mb-panel" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        )
      )}

      {/* Tree on the left; the detail panel joins it only once a target is picked,
          so an unselected page gives the whole width to the list. */}
      <PageBody>
        <GlassPanel
          data-tour="targets-tree"
          className={cn('flex flex-col', detailOpen ? 'w-[440px] shrink-0' : 'min-w-0 flex-1')}
        >
          <ScopeFilterTabs counts={scopeCounts} total={total} value={scopeFilter} onChange={setScopeFilter} />
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
              newIds={newIds}
              renderRow={(node, row) => (
                <TargetContextMenu
                  node={node}
                  workflows={workflows}
                  backends={backends}
                  onAddToScope={(pattern) => void changeScope('include', pattern)}
                  onRemoveFromScope={(pattern) => void changeScope('exclude', pattern)}
                  onRunWorkflow={(workflowId, backendId) => runWorkflowOn(workflowId, node.id, backendId)}
                  onRunTool={() => openTools(node.id)}
                  onDelete={() => deleteTarget(node)}
                >
                  {row}
                </TargetContextMenu>
              )}
            />
          )}
        </GlassPanel>

        {api !== null && selectedId !== null && (
          <GlassPanel className="min-w-0 flex-1">
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
          </GlassPanel>
        )}
      </PageBody>

      {showAdd && client !== null && (
        <AddTargetModal client={client} onClose={() => setShowAdd(false)} onCreated={() => void refresh()} />
      )}
    </Page>
  )
}
