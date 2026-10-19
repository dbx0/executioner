import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import ReactFlow, { Background, BackgroundVariant, type Edge, type Node } from 'reactflow'
import 'reactflow/dist/style.css'
import { Play, Pencil, X } from 'lucide-react'
import { useApp } from '../../store.js'
import { workflowsApi } from '../../api/workflows.js'
import { nodesApi, type NodeListing } from '../../api/nodes.js'
import { executionsApi, type ExecutionSummary } from '../../api/executions.js'
import { targetsApi } from '../../api/targets.js'
import { Crosshair } from 'lucide-react'
import { graphNodeTypes, type GraphNodeData } from '../canvas/GraphNodes.js'
import { buildCatalog } from '../../lib/node-catalog.js'
import { Button } from '../ui/button.js'
import { cn } from '../../lib/utils.js'

interface EngineGraphNode {
  id: string
  type: string
  data?: Record<string, unknown>
  position?: { x: number; y: number }
}
interface EngineGraphEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
}

function runDot(status: string): string {
  if (status === 'succeeded' || status === 'success') return 'bg-status-success'
  if (status === 'running') return 'bg-status-running animate-pulse'
  return 'bg-status-error'
}

/**
 * A read-only preview of a workflow: a non-interactive render of its graph, that
 * workflow's recent runs, and Run / Edit actions.
 */
export function WorkflowPreviewModal({
  workflowId,
  name,
  onClose,
  onEdit,
  onRun,
}: {
  workflowId: string
  name: string
  onClose: () => void
  onEdit: () => void
  onRun: () => void
}): JSX.Element {
  const client = useApp((s) => s.client)!
  const [listings, setListings] = useState<NodeListing[]>([])
  const [graph, setGraph] = useState<{ nodes: EngineGraphNode[]; edges: EngineGraphEdge[] } | null>(null)
  const [runs, setRuns] = useState<ExecutionSummary[]>([])
  const [targetVals, setTargetVals] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    void nodesApi(client)
      .list()
      .then((l) => alive && setListings(l))
      .catch(() => {})
    void targetsApi(client)
      .list()
      .then((list) => alive && setTargetVals(Object.fromEntries(list.map((t) => [t.id, t.value]))))
      .catch(() => {})
    void workflowsApi(client)
      .get(workflowId)
      .then((wf: { graph: { nodes: EngineGraphNode[]; edges: EngineGraphEdge[] } }) => alive && setGraph(wf.graph))
      .catch(() => alive && setGraph({ nodes: [], edges: [] }))
    void executionsApi(client)
      .list()
      .then((list) => alive && setRuns(list.filter((r) => r.workflowId === workflowId).slice(0, 5)))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [client, workflowId])

  const catalog = useMemo(() => buildCatalog(listings), [listings])

  // Hydrate the saved engine graph into read-only React Flow nodes, resolving
  // each node's kind/label/category from the catalog (same mapping the editor uses).
  const { nodes, edges } = useMemo<{ nodes: Node<GraphNodeData>[]; edges: Edge[] }>(() => {
    if (graph === null) return { nodes: [], edges: [] }
    const nodes: Node<GraphNodeData>[] = graph.nodes.map((n) => {
      const entry = catalog.find((e) => e.type === n.type)
      const kind = entry?.kind ?? 'tool'
      return {
        id: n.id,
        type: kind,
        position: n.position ?? { x: 0, y: 0 },
        draggable: false,
        selectable: false,
        connectable: false,
        data: {
          label: entry?.label ?? n.type,
          nodeType: n.type,
          kind,
          category: entry?.category ?? 'tool',
          availableParams: entry?.params ?? [],
          params: (n.data ?? {}) as Record<string, unknown>,
        },
      }
    })
    const edges: Edge[] = graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
    }))
    return { nodes, edges }
  }, [graph, catalog])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="flex max-h-[82vh] w-[720px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="truncate text-[14px] font-medium">{name}</span>
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label="Close">
            <X className="size-4" strokeWidth={1.75} />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-sleek p-4">
          {/* Graph preview */}
          <div className="h-64 shrink-0 overflow-hidden rounded-lg border border-border bg-card/40">
            {graph === null ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
            ) : nodes.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                This workflow has no nodes yet.
              </div>
            ) : (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={graphNodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                panOnDrag
                zoomOnScroll
                minZoom={0.2}
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
              </ReactFlow>
            )}
          </div>

          {/* Recent runs for this workflow */}
          <div className="flex flex-col gap-1">
            <div className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recent runs
            </div>
            {runs.length === 0 ? (
              <p className="px-0.5 py-1 text-[13px] text-muted-foreground">No runs yet.</p>
            ) : (
              <div className="flex flex-col divide-y divide-border/60 rounded-lg border border-border">
                {runs.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
                    <span className={cn('size-2 shrink-0 rounded-full', runDot(r.status))} />
                    <Crosshair className="size-3 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                      {r.targetId !== null ? (targetVals[r.targetId] ?? r.targetId.slice(0, 8)) : 'no target'}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {r.startedAt !== null ? new Date(r.startedAt).toLocaleString() : ''}
                    </span>
                    <span className="w-16 shrink-0 text-right text-[11px] font-medium capitalize text-muted-foreground">
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="size-4" strokeWidth={1.75} />
            Edit
          </Button>
          <Button size="sm" onClick={onRun}>
            <Play className="size-4" strokeWidth={2} />
            Run
          </Button>
        </div>
      </div>
    </div>
  )
}
