import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import ReactFlow, { Background, BackgroundVariant, type Edge, type Node } from 'reactflow'
import '../canvas/flow-styles.js'
import { Play, Pencil, Crosshair } from 'lucide-react'
import { useApp } from '../../store.js'
import { workflowsApi } from '../../api/workflows.js'
import { nodesApi, type NodeListing } from '../../api/nodes.js'
import { executionsApi, type ExecutionSummary } from '../../api/executions.js'
import { targetsApi } from '../../api/targets.js'
import { graphNodeTypes, type GraphNodeData } from '../canvas/GraphNodes.js'
import { buildCatalog } from '../../lib/node-catalog.js'
import { Button } from '../ui/button.js'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/dialog.js'
import { GlassPanel } from '../ui/glass-panel.js'
import { Skeleton } from '../ui/skeleton.js'
import { LoadingState } from '../ui/spinner.js'
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
  // Null until the run list has answered, so the section shows placeholders first.
  const [runs, setRuns] = useState<ExecutionSummary[] | null>(null)
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
      .catch(() => alive && setRuns([]))
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
    <Dialog onClose={onClose} size="lg" className="max-h-[82vh] w-[720px]">
      <DialogHeader title={name} closeButton />

      <DialogBody className="flex flex-col gap-4">
        {/* Graph preview */}
        <GlassPanel tone="ink" className="h-64 shrink-0">
          {graph === null ? (
            <LoadingState label="Loading workflow" />
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
              fitViewOptions={FIT_VIEW}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              panOnDrag
              zoomOnScroll
              minZoom={0.2}
              proOptions={PRO_OPTIONS}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} />
            </ReactFlow>
          )}
        </GlassPanel>

        {/* Recent runs for this workflow */}
        <div className="flex flex-col gap-1.5">
          <div className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Recent runs
          </div>
          {runs === null ? (
            <RunRowsSkeleton />
          ) : runs.length === 0 ? (
            <p className="px-0.5 py-1 text-[13px] text-muted-foreground">No runs yet.</p>
          ) : (
            <GlassPanel className="flex flex-col divide-y divide-glass-border rounded-[14px]">
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
            </GlassPanel>
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="glass" size="sm" onClick={onEdit}>
          <Pencil className="size-3.5" strokeWidth={1.75} />
          Edit
        </Button>
        <Button size="sm" onClick={onRun}>
          <Play className="size-3 fill-current" strokeWidth={2} />
          Run
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

const FIT_VIEW = { padding: 0.2 }
const PRO_OPTIONS = { hideAttribution: true }

/** The recent-runs list while it loads, in the shape of the real rows. */
function RunRowsSkeleton(): JSX.Element {
  return (
    <GlassPanel role="status" aria-label="Loading recent runs" className="flex flex-col divide-y divide-glass-border rounded-[14px]">
      {['w-[40%]', 'w-[55%]', 'w-[32%]'].map((width) => (
        <div key={width} className="flex items-center gap-2 px-3 py-2.5">
          <Skeleton className="size-2 shrink-0 rounded-full" />
          <Skeleton className={cn('h-3', width)} />
          <Skeleton className="ml-auto h-2.5 w-24" />
        </div>
      ))}
    </GlassPanel>
  )
}
