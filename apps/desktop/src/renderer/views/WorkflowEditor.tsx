import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useApp } from '../store.js'
import { nodesApi, type NodeListing } from '../api/nodes.js'
import { workflowsApi, type WorkflowSummary } from '../api/workflows.js'
import { executionsApi } from '../api/executions.js'
import { backendsApi, type BackendProfile } from '../api/backends.js'
import { targetsApi, type TargetNode } from '../api/targets.js'
import { AddBackendModal } from '../components/modals/BackendsDialog.js'
import { ConfirmModal } from '../components/modals/ConfirmModal.js'
import { buildCatalog, categoryColor } from '../lib/node-catalog.js'
import { graphNodeTypes, type GraphNodeData } from '../components/canvas/GraphNodes.js'
import { CanvasContext } from '../components/canvas/CanvasContext.js'
import { Palette } from '../components/canvas/Palette.js'
import { layoutGraph } from '../lib/autolayout.js'
import { toReactFlow } from '../components/canvas/convert.js'
import { AssistantPanel } from '../components/canvas/AssistantPanel.js'
import type { AssistantProposal } from '../api/assistant.js'
import { validateWorkflow } from '../lib/workflow-validate.js'
import { downloadJson, parseWorkflowFile } from '../lib/workflow-io.js'
import type { Graph } from '../lib/graph-types.js'
import { reduceNodeStatus } from '../components/canvas/useNodeStatus.js'
import { reduceNodeOutputs } from '../components/canvas/useNodeOutputs.js'
import { NodePicker } from '../components/canvas/NodePicker.js'
import { graphEdgeTypes } from '../components/canvas/AddEdge.js'
import { useGraphHistory } from '../lib/useGraphHistory.js'
import type { CatalogEntry } from '../lib/node-catalog.js'
import { useEngineEvents } from '../lib/events.js'
import { flatten, saveLastWorkflow } from './workflow-editor/helpers.js'
import { loadRunBackend, saveRunBackend } from '../store/persistence.js'
import { useUndoRedo } from './workflow-editor/useUndoRedo.js'
import { EditorToolbar } from './workflow-editor/EditorToolbar.js'
import { ValidationPanel } from './workflow-editor/ValidationPanel.js'
import { RunPanel } from './workflow-editor/RunPanel.js'
import { StepControlBar } from './workflow-editor/StepControlBar.js'
import { NodeInspector } from './workflow-editor/NodeInspector.js'

let counter = 0

/**
 * The workflow canvas editor. Reached from the Workflows hub, which passes the
 * workflow to open (`'new'` for a blank canvas) and a `onBack` affordance to
 * return to the hub. Mounted with a `key` per workflow so switching workflows
 * from the hub remounts it with fresh state.
 */
export function WorkflowEditor({
  workflowId: initialWorkflowId,
  onBack,
}: {
  workflowId: string | 'new'
  onBack: () => void
}): JSX.Element {
  const client = useApp((s) => s.client)!
  const connection = useApp((s) => s.connection)!
  const activeRoot = useApp((s) => s.activeRoot)

  const wfApi = useMemo(() => workflowsApi(client), [client])
  const exApi = useMemo(() => executionsApi(client), [client])

  const [listings, setListings] = useState<NodeListing[]>([])
  // The list is refreshed after create/delete/import so callers relying on the
  // engine stay in sync; the in-toolbar switcher was removed, so it isn't read.
  const [, setWorkflows] = useState<WorkflowSummary[]>([])
  const [workflowId, setWorkflowId] = useState<string | undefined>()
  const [name, setName] = useState('Untitled workflow')
  const [renaming, setRenaming] = useState(false)
  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNodeData>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const [runOpen, setRunOpen] = useState(false)
  const [targets, setTargets] = useState<TargetNode[]>([])
  const [targetId, setTargetId] = useState<string | undefined>()
  // Restored per engagement: a run backend that silently reverts to local is the
  // difference between a workflow scanning the remote host and every tool
  // failing to spawn here.
  const [backendId, setBackendIdState] = useState<string>(() => loadRunBackend(activeRoot))
  const setBackendId = useCallback(
    (id: string) => {
      setBackendIdState(id)
      saveRunBackend(activeRoot, id)
    },
    [activeRoot],
  )
  const [profiles, setProfiles] = useState<BackendProfile[]>([])
  const [backendsOpen, setBackendsOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [runSeq, setRunSeq] = useState(0)
  const [showValidation, setShowValidation] = useState(false)
  const [stepMode, setStepMode] = useState(false)
  // The active stepped run, if any: its executionId drives the Next/Resume bar.
  const [stepExec, setStepExec] = useState<string | null>(null)
  // A one-off single-node run (Run this node), painted onto its instance.
  const [singleRun, setSingleRun] = useState<
    { instanceId: string; execId: string; nodeType: string; sinceSeq: number } | null
  >(null)
  // The open node picker (edge insert or node append), positioned in screen space.
  const [picker, setPicker] = useState<{ mode: 'insert' | 'append'; refId: string; x: number; y: number } | null>(null)
  // The AI workflow assistant right-drawer, toggled from the toolbar.
  const [assistantOpen, setAssistantOpen] = useState(false)

  const rfRef = useRef<ReactFlowInstance | null>(null)
  const importRef = useRef<HTMLInputElement | null>(null)
  /** Guards the one-shot initial workflow load handed down from the hub. */
  const initialLoaded = useRef(false)
  // Set true just before applying an undo/redo/reset snapshot so the history
  // recorder skips the resulting nodes/edges change (avoids re-recording it).
  const applyingHistory = useRef(false)
  const history = useGraphHistory<GraphNodeData>()

  const flash = useCallback((message: string) => {
    setToast(message)
    setTimeout(() => setToast(null), 2500)
  }, [])

  // Pre-run validation, recomputed only when the graph changes.
  const issues = useMemo(() => validateWorkflow(nodes, edges), [nodes, edges])
  const errorIssues = useMemo(() => issues.filter((i) => i.severity === 'error'), [issues])
  const warningIssues = useMemo(() => issues.filter((i) => i.severity === 'warning'), [issues])
  const hasErrors = errorIssues.length > 0

  const catalog = useMemo(() => buildCatalog(listings), [listings])
  const events = useEngineEvents(connection)
  // Scope live status to the current run: the engine's `/events` socket is a
  // single global stream and the renderer keeps a rolling buffer across runs,
  // so fold only frames produced after this run was launched (`runSeq`).
  const statusByNode = useMemo(() => reduceNodeStatus(events, runSeq), [events, runSeq])
  const outputsByNode = useMemo(() => reduceNodeOutputs(events, runSeq), [events, runSeq])

  useEffect(() => {
    void nodesApi(client).list().then(setListings).catch(() => setListings([]))
    void wfApi.list().then(setWorkflows).catch(() => setWorkflows([]))
    void backendsApi(client)
      .list()
      .then((list) => {
        setProfiles(list)
        // A remembered backend whose profile is gone can't be used, but falling
        // back to local changes where every tool runs — say so rather than
        // reverting in silence.
        const remembered = loadRunBackend(activeRoot)
        if (remembered !== 'local' && !list.some((p) => p.id === remembered)) {
          setBackendId('local')
          setToast('That run backend no longer exists — runs will use this machine.')
        }
      })
      .catch(() => setProfiles([]))
  }, [client, wfApi, activeRoot, setBackendId])

  // Switching engagements without remounting must pick up that engagement's
  // remembered backend rather than keeping the previous one.
  useEffect(() => {
    setBackendIdState(loadRunBackend(activeRoot))
  }, [activeRoot])

  // Paint live status + captured output onto nodes as it streams in. Both maps
  // are keyed by graph-node id (workflow runs emit under the instance id).
  useEffect(() => {
    // status/output live outside the structural graphSig, so these paints never
    // trigger the history recorder — no applyingHistory guard is needed here.
    // Only rebuild a node whose painted status/output actually moved. A run
    // streams a batch of events every frame, and handing React Flow a fresh
    // array of fresh node objects each time re-renders the whole canvas 60×/s —
    // which is what makes anything else clicked during a run feel stuck.
    setNodes((cur) => {
      let changed = false
      const next = cur.map((n) => {
        const status = statusByNode[n.id]
        const output = outputsByNode[n.id]
        if (status === undefined && output === undefined) return n
        if ((status === undefined || n.data.status === status) && (output === undefined || n.data.output === output)) {
          return n
        }
        changed = true
        return {
          ...n,
          data: {
            ...n.data,
            ...(status !== undefined ? { status } : {}),
            ...(output !== undefined ? { output } : {}),
          },
        }
      })
      return changed ? next : cur
    })
  }, [statusByNode, outputsByNode, setNodes])

  // A single-node run ("Run this node") emits events under the node TYPE (the
  // manifest id), not the graph instance id, so paint that one instance directly.
  useEffect(() => {
    if (singleRun === null) return
    const { instanceId, execId, nodeType, sinceSeq } = singleRun
    let status: GraphNodeData['status'] | undefined
    let output = ''
    for (const e of events) {
      if (e.seq <= sinceSeq || e.executionId !== execId || e.nodeId !== nodeType) continue
      if (e.type === 'stdout') output += e.data
      else if (e.type === 'status' && e.data === 'running') status = 'running'
      else if (e.type === 'done') status = e.data === 'succeeded' ? 'success' : 'error'
    }
    setNodes((cur) => {
      let changed = false
      const next = cur.map((n) => {
        if (n.id !== instanceId) return n
        if ((status === undefined || n.data.status === status) && (output === '' || n.data.output === output)) return n
        changed = true
        return {
          ...n,
          data: {
            ...n.data,
            ...(status !== undefined ? { status } : {}),
            ...(output !== '' ? { output } : {}),
          },
        }
      })
      return changed ? next : cur
    })
  }, [singleRun, events, setNodes])

  // Clear the step control bar once its execution reaches a terminal state.
  useEffect(() => {
    if (stepExec === null) return
    const done = events.some(
      (e) =>
        e.executionId === stepExec &&
        e.nodeId === '__execution__' &&
        e.type === 'status' &&
        (e.data === 'succeeded' || e.data === 'failed'),
    )
    if (done) {
      setStepExec(null)
      flash('Run complete')
    }
  }, [stepExec, events, flash])

  // Build a fresh graph node from a catalog entry (shared by palette add, drop,
  // edge-insert and node-append).
  const makeNode = useCallback((entry: CatalogEntry, position: { x: number; y: number }): Node<GraphNodeData> => {
    counter += 1
    const id = `${entry.type}-${counter}`
    return {
      id,
      type: entry.kind,
      position,
      data: {
        label: entry.label,
        nodeType: entry.type,
        kind: entry.kind,
        category: entry.category,
        availableParams: entry.params,
        params: {},
      },
    }
  }, [])

  const addNode = useCallback(
    (entry: CatalogEntry, position?: { x: number; y: number }) => {
      const at = position ?? { x: 160 + (counter % 6) * 40, y: 80 + (counter % 8) * 48 }
      setNodes((cur) => cur.concat(makeNode(entry, at)))
    },
    [setNodes, makeNode],
  )

  // Structural-edit recording, undo/redo callbacks and their keyboard shortcuts.
  const { undo, redo } = useUndoRedo({ nodes, edges, setNodes, setEdges, history, applyingHistory })

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const raw = e.dataTransfer.getData('application/exe-node')
      if (raw === '' || rfRef.current === null) return
      let parsed: { type?: string }
      try {
        parsed = JSON.parse(raw) as { type?: string }
      } catch {
        return
      }
      const entry = catalog.find((c) => c.type === parsed.type)
      if (entry === undefined) return
      const position = rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      addNode(entry, position)
    },
    [catalog, addNode],
  )

  // Remove a node; if it sat inline (exactly one in + one out edge), bridge its
  // neighbours so the chain stays connected. Otherwise just drop its edges.
  const onDelete = useCallback(
    (id: string) => {
      setEdges((eds) => {
        const incoming = eds.filter((e) => e.target === id)
        const outgoing = eds.filter((e) => e.source === id)
        const remaining = eds.filter((e) => e.source !== id && e.target !== id)
        const inEdge = incoming[0]
        const outEdge = outgoing[0]
        if (incoming.length === 1 && outgoing.length === 1 && inEdge !== undefined && outEdge !== undefined) {
          return addEdge(
            { id: `bridge-${inEdge.source}-${outEdge.target}`, source: inEdge.source, target: outEdge.target, animated: true },
            remaining,
          )
        }
        return remaining
      })
      setNodes((cur) => cur.filter((n) => n.id !== id))
      setSelectedId((cur) => (cur === id ? undefined : cur))
    },
    [setEdges, setNodes],
  )

  const onDuplicate = useCallback(
    (id: string) => {
      setNodes((cur) => {
        const src = cur.find((n) => n.id === id)
        if (src === undefined) return cur
        counter += 1
        const cloneId = `${src.data.nodeType}-${counter}`
        const clone: Node<GraphNodeData> = {
          ...src,
          id: cloneId,
          position: { x: src.position.x + 40, y: src.position.y + 40 },
          selected: true,
          data: { ...src.data, params: { ...src.data.params } },
        }
        setSelectedId(cloneId)
        return cur.map((n) => (n.id === id ? { ...n, selected: false } : n)).concat(clone)
      })
    },
    [setNodes],
  )

  const onNodesDelete = useCallback(
    (deleted: Node<GraphNodeData>[]) => {
      if (deleted.length !== 1 || deleted[0] === undefined) return
      const id = deleted[0].id
      setEdges((eds) => {
        const incoming = eds.filter((e) => e.target === id)
        const outgoing = eds.filter((e) => e.source === id)
        const inEdge = incoming[0]
        const outEdge = outgoing[0]
        if (incoming.length === 1 && outgoing.length === 1 && inEdge !== undefined && outEdge !== undefined) {
          const remaining = eds.filter((e) => e.source !== id && e.target !== id)
          return addEdge({ id: `bridge-${inEdge.source}-${outEdge.target}`, source: inEdge.source, target: outEdge.target, animated: true }, remaining)
        }
        return eds
      })
    },
    [setEdges],
  )

  const arrange = useCallback(() => {
    setNodes(layoutGraph(nodes, edges))
    requestAnimationFrame(() => rfRef.current?.fitView({ padding: 0.2, duration: 250 }))
  }, [nodes, edges, setNodes])

  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge({ ...c, animated: true }, eds)), [setEdges])

  // Open the node picker over an edge's midpoint to insert a node splitting it.
  const onInsertBetween = useCallback(
    (edgeId: string) => {
      const edge = edges.find((e) => e.id === edgeId)
      if (edge === undefined) return
      const src = nodes.find((n) => n.id === edge.source)
      const tgt = nodes.find((n) => n.id === edge.target)
      let x = 240
      let y = 200
      if (src !== undefined && tgt !== undefined && rfRef.current !== null) {
        const mid = { x: (src.position.x + tgt.position.x) / 2 + 75, y: (src.position.y + tgt.position.y) / 2 + 20 }
        const scr = rfRef.current.flowToScreenPosition(mid)
        x = scr.x
        y = scr.y
      }
      setPicker({ mode: 'insert', refId: edgeId, x, y })
    },
    [edges, nodes],
  )

  // Open the node picker beside a node to append a downstream node.
  const onAppend = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId)
      let x = 240
      let y = 200
      if (node !== undefined && rfRef.current !== null) {
        const scr = rfRef.current.flowToScreenPosition({ x: node.position.x + 220, y: node.position.y + 20 })
        x = scr.x
        y = scr.y
      }
      setPicker({ mode: 'append', refId: nodeId, x, y })
    },
    [nodes],
  )

  // Commit a picker choice: insert (rewire A→new→B) or append (node→new).
  const onPickNode = useCallback(
    (entry: CatalogEntry) => {
      const p = picker
      if (p === null) return
      if (p.mode === 'insert') {
        const edge = edges.find((e) => e.id === p.refId)
        if (edge === undefined) {
          setPicker(null)
          return
        }
        const src = nodes.find((n) => n.id === edge.source)
        const tgt = nodes.find((n) => n.id === edge.target)
        const pos =
          src !== undefined && tgt !== undefined
            ? { x: (src.position.x + tgt.position.x) / 2, y: (src.position.y + tgt.position.y) / 2 }
            : { x: 240, y: 200 }
        const node = makeNode(entry, pos)
        setNodes((cur) => cur.concat(node))
        setEdges((eds) => {
          const rest = eds.filter((e) => e.id !== p.refId)
          const inEdge: Edge = {
            id: `e-${edge.source}-${node.id}`,
            source: edge.source,
            target: node.id,
            animated: true,
            ...(edge.sourceHandle !== null && edge.sourceHandle !== undefined ? { sourceHandle: edge.sourceHandle } : {}),
          }
          const outEdge: Edge = { id: `e-${node.id}-${edge.target}`, source: node.id, target: edge.target, animated: true }
          return rest.concat(inEdge, outEdge)
        })
      } else {
        const node = nodes.find((n) => n.id === p.refId)
        const pos = node !== undefined ? { x: node.position.x + 220, y: node.position.y } : { x: 240, y: 200 }
        const created = makeNode(entry, pos)
        setNodes((cur) => cur.concat(created))
        setEdges((eds) =>
          addEdge({ id: `e-${p.refId}-${created.id}`, source: p.refId, target: created.id, animated: true }, eds),
        )
      }
      setPicker(null)
    },
    [picker, edges, nodes, makeNode, setNodes, setEdges],
  )

  // Run just one node against the current run target via the single-node path.
  const runSingleNode = useCallback(
    async (id: string) => {
      const node = nodes.find((n) => n.id === id)
      if (node === undefined) return
      let tId = targetId
      if (tId === undefined) {
        const tree = await targetsApi(client).tree().catch(() => [])
        const flat = flatten(tree)
        setTargets(flat)
        tId = flat[0]?.id
        setTargetId(tId)
      }
      if (tId === undefined) {
        flash('Add a target first to run a node')
        return
      }
      const baseline = events.length > 0 ? (events[events.length - 1]?.seq ?? 0) : 0
      // Optimistic status only (not structural) — no history guard needed.
      setNodes((cur) =>
        cur.map((n) => (n.id === id ? { ...n, data: { ...n.data, status: 'running' } } : n)),
      )
      try {
        const res = (await nodesApi(client).run(node.data.nodeType, {
          targetId: tId,
          params: node.data.params,
        })) as { executionId?: string }
        if (res.executionId !== undefined) {
          setSingleRun({ instanceId: id, execId: res.executionId, nodeType: node.data.nodeType, sinceSeq: baseline })
        }
      } catch {
        setNodes((cur) => cur.map((n) => (n.id === id ? { ...n, data: { ...n.data, status: 'error' } } : n)))
        flash('Node run failed to start')
      }
    },
    [nodes, targetId, client, events, setNodes, flash],
  )

  const setParam = useCallback(
    (nodeId: string, key: string, value: unknown) =>
      setNodes((cur) =>
        cur.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, params: { ...n.data.params, [key]: value } } } : n,
        ),
      ),
    [setNodes],
  )

  // Rebuild React Flow nodes/edges from a saved engine graph, resolving each
  // node's catalog entry (kind, label, availableParams) and its params. Shared
  // by loadWorkflow and file import.
  const hydrateGraph = useCallback(
    (graph: Graph): { nodes: Node<GraphNodeData>[]; edges: Edge[] } => {
      const flow = toReactFlow(graph)
      const rebuilt: Node<GraphNodeData>[] = flow.nodes.map((n) => {
        const entry = catalog.find((e) => e.type === n.type)
        const kind = entry?.kind ?? 'tool'
        return {
          ...n,
          type: kind,
          data: {
            label: entry?.label ?? n.type ?? 'node',
            nodeType: n.type ?? 'unknown',
            kind,
            category: entry?.category ?? 'tool',
            availableParams: entry?.params ?? [],
            params: (n.data as { params?: Record<string, unknown> })?.params ?? (n.data as Record<string, unknown>) ?? {},
          },
        }
      })
      return { nodes: rebuilt, edges: flow.edges as Edge[] }
    },
    [catalog],
  )

  const loadWorkflow = useCallback(
    async (id: string) => {
      const wf = await wfApi.get(id)
      const flow = hydrateGraph(wf.graph)
      setWorkflowId(id)
      setName(wf.name)
      applyingHistory.current = true
      setNodes(flow.nodes)
      setEdges(flow.edges)
      history.reset(flow.nodes, flow.edges)
      setSelectedId(undefined)
      saveLastWorkflow(activeRoot, id)
    },
    [wfApi, hydrateGraph, setNodes, setEdges, history, activeRoot],
  )

  // Load the workflow the hub asked us to open, once the node catalog is ready
  // (so the graph hydrates with the right node kinds/params). Runs once; a
  // 'new' request just leaves the blank canvas in place.
  useEffect(() => {
    if (initialLoaded.current) return
    if (initialWorkflowId === 'new') {
      initialLoaded.current = true
      saveLastWorkflow(activeRoot, null)
      return
    }
    if (catalog.length === 0) return
    initialLoaded.current = true
    void loadWorkflow(initialWorkflowId)
  }, [initialWorkflowId, catalog, activeRoot, loadWorkflow])

  // Serialize the current canvas to the engine graph shape. The engine reads a
  // node's params as top-level `data` keys, so emit only user params as `data`.
  const buildGraph = useCallback(
    (): Graph => ({
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.data.nodeType,
        data: n.data.params,
        position: n.position,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
      })),
    }),
    [nodes, edges],
  )

  // Load a proposed graph from the assistant onto the canvas, replacing the
  // current graph. Recorded in the undo history so the user can revert; the
  // user reviews and Saves as normal (nothing is persisted here).
  const applyProposal = useCallback(
    (proposal: AssistantProposal) => {
      const hydrated = hydrateGraph(proposal.graph)
      // Leave applyingHistory unset so the recorder effect pushes this onto the
      // undo stack (the user can revert the applied proposal).
      setNodes(hydrated.nodes)
      setEdges(hydrated.edges)
      setSelectedId(undefined)
      flash('Applied the proposed workflow — review and Save')
    },
    [hydrateGraph, setNodes, setEdges, flash],
  )

  const newWorkflow = (): void => {
    setWorkflowId(undefined)
    setName('Untitled workflow')
    applyingHistory.current = true
    setNodes([])
    setEdges([])
    history.reset([], [])
    setSelectedId(undefined)
    saveLastWorkflow(activeRoot, null)
  }

  const save = async (): Promise<string | undefined> => {
    setSaving(true)
    try {
      const graph = buildGraph()
      if (workflowId === undefined) {
        const created = await wfApi.create(name, graph)
        setWorkflowId(created.id)
        setWorkflows(await wfApi.list())
        saveLastWorkflow(activeRoot, created.id)
        return created.id
      }
      await wfApi.update(workflowId, name, graph)
      setWorkflows(await wfApi.list())
      return workflowId
    } finally {
      setSaving(false)
    }
  }

  const removeWorkflow = async (keepHistory: boolean): Promise<void> => {
    if (workflowId === undefined) return
    await wfApi.remove(workflowId, keepHistory)
    setWorkflows(await wfApi.list().catch(() => []))
    newWorkflow()
  }

  const duplicateWorkflow = async (): Promise<void> => {
    if (workflowId === undefined) return
    const created = await wfApi.duplicate(workflowId)
    setWorkflows(await wfApi.list().catch(() => []))
    await loadWorkflow(created.id)
  }

  const exportWorkflow = (): void => {
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    downloadJson(`${slug === '' ? 'workflow' : slug}.json`, { name, graph: buildGraph() })
  }

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file === undefined) return
    try {
      const parsed = parseWorkflowFile(await file.text())
      if (parsed === null) {
        flash('Import failed — not a valid workflow file')
        return
      }
      const hydrated = hydrateGraph(parsed.graph)
      setWorkflowId(undefined)
      setName(parsed.name ?? 'Imported workflow')
      applyingHistory.current = true
      setNodes(hydrated.nodes)
      setEdges(hydrated.edges)
      history.reset(hydrated.nodes, hydrated.edges)
      setSelectedId(undefined)
    } catch {
      flash('Import failed — could not read the file')
    }
  }

  const openRun = async (): Promise<void> => {
    if (hasErrors) {
      setShowValidation(true)
      return
    }
    const tree = await targetsApi(client).tree().catch(() => [])
    const flat = flatten(tree)
    setTargets(flat)
    setTargetId(flat[0]?.id)
    setRunOpen(true)
  }

  const run = async (): Promise<void> => {
    const id = await save()
    if (id === undefined || targetId === undefined) return
    // Baseline the live-status stream to this run and clear any rings/output a
    // previous run left behind so only this run's frames repaint the canvas.
    const baseline = events.length > 0 ? (events[events.length - 1]?.seq ?? 0) : 0
    setRunSeq(baseline)
    setStepExec(null)
    setSingleRun(null)
    // Clearing status/output is non-structural; the history recorder ignores it.
    setNodes((cur) =>
      cur.map((n) => {
        if (n.data.status === undefined && n.data.output === undefined) return n
        const { status: _s, output: _o, ...rest } = n.data
        return { ...n, data: rest }
      }),
    )
    setRunOpen(false)
    const stepped = stepMode
    try {
      const result = (await exApi.runWorkflow(id, {
        targetId,
        ...(stepped ? { mode: 'step' as const } : {}),
        ...(backendId !== 'local' ? { backendProfileId: backendId } : {}),
      })) as { status?: string; executionId?: string }
      if (stepped && result.executionId !== undefined) {
        setStepExec(result.executionId)
        setToast('Stepping — press Next to advance')
      } else {
        setToast(result.status === 'failed' ? 'Run failed — see nodes' : 'Run complete')
      }
    } catch {
      setToast('Run failed to start')
    }
    setTimeout(() => setToast(null), 2500)
  }

  const stepNext = async (): Promise<void> => {
    if (stepExec === null) return
    await exApi.step(stepExec).catch(() => flash('Step failed'))
  }

  const stepResume = async (): Promise<void> => {
    if (stepExec === null) return
    const id = stepExec
    setStepExec(null)
    await exApi.resume(id).catch(() => flash('Resume failed'))
  }

  const selected = nodes.find((n) => n.id === selectedId)

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <EditorToolbar
        onBack={onBack}
        name={name}
        setName={setName}
        renaming={renaming}
        setRenaming={setRenaming}
        workflowId={workflowId}
        nodeCount={nodes.length}
        saving={saving}
        assistantOpen={assistantOpen}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        hasErrors={hasErrors}
        errorCount={errorIssues.length}
        importRef={importRef}
        onDuplicateWorkflow={() => void duplicateWorkflow()}
        onRequestDelete={() => setDeleteConfirm(true)}
        onExport={exportWorkflow}
        onImportFile={(e) => void onImportFile(e)}
        onUndo={undo}
        onRedo={redo}
        onToggleAssistant={() => setAssistantOpen((v) => !v)}
        onArrange={arrange}
        onSave={() => void save()}
        onOpenRun={() => void openRun()}
      />

      <div className="flex min-h-0 flex-1">
        <Palette listings={listings} onAdd={addNode} />

        <div className="relative min-w-0 flex-1">
          <CanvasContext.Provider
            value={{ onDuplicate, onDelete, onInsertBetween, onAppend, onRunNode: (id) => void runSingleNode(id) }}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={graphNodeTypes}
              edgeTypes={graphEdgeTypes}
              onInit={(inst) => (rfRef.current = inst)}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodesDelete={onNodesDelete}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onNodeClick={(_, n) => setSelectedId(n.id)}
              onPaneClick={() => setSelectedId(undefined)}
              deleteKeyCode={['Backspace', 'Delete']}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--border)" />
              <Controls className="!rounded-md !border !border-border !bg-card !shadow-sm" showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                nodeColor={(node) => categoryColor((node.data as GraphNodeData).category)}
                maskColor="rgba(0,0,0,0.5)"
                className="!rounded-md !border !border-border !bg-card"
              />
            </ReactFlow>
          </CanvasContext.Provider>

          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">Add nodes from the palette to build a workflow.</p>
            </div>
          )}

          {/* Pre-run validation errors */}
          {showValidation && hasErrors && (
            <ValidationPanel
              errorIssues={errorIssues}
              warningIssues={warningIssues}
              onDismiss={() => setShowValidation(false)}
              onSelectIssue={(nodeId) => {
                setSelectedId(nodeId)
                setShowValidation(false)
              }}
            />
          )}

          {/* Run panel */}
          {runOpen && (
            <RunPanel
              targets={targets}
              targetId={targetId}
              onTargetChange={setTargetId}
              profiles={profiles}
              backendId={backendId}
              onBackendChange={setBackendId}
              stepMode={stepMode}
              onStepModeChange={setStepMode}
              onManageBackends={() => setBackendsOpen(true)}
              onCancel={() => setRunOpen(false)}
              onRun={() => void run()}
            />
          )}

          {backendsOpen && (
            <AddBackendModal
              client={client}
              onClose={() => setBackendsOpen(false)}
              onSaved={() => {
                void backendsApi(client)
                  .list()
                  .then((list) => {
                    setProfiles(list)
                    if (backendId !== 'local' && !list.some((p) => p.id === backendId)) setBackendId('local')
                  })
                  .catch(() => setProfiles([]))
              }}
            />
          )}

          {deleteConfirm && (
            <ConfirmModal
              title="Delete workflow"
              message={`Delete “${name}”? This cannot be undone.`}
              confirmLabel="Delete"
              destructive
              checkboxLabel="Keep this workflow's run history"
              checkboxDefault
              onCancel={() => setDeleteConfirm(false)}
              onConfirm={(keepHistory) => {
                setDeleteConfirm(false)
                void removeWorkflow(keepHistory)
              }}
            />
          )}

          {/* Step-through control bar */}
          {stepExec !== null && (
            <StepControlBar onNext={() => void stepNext()} onResume={() => void stepResume()} />
          )}

          {/* Node picker (edge insert / node append) */}
          {picker !== null && (
            <NodePicker
              entries={catalog}
              x={picker.x}
              y={picker.y}
              onPick={onPickNode}
              onClose={() => setPicker(null)}
            />
          )}

          {toast !== null && (
            <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-1.5 text-xs shadow-floating">
              {toast}
            </div>
          )}
        </div>

        {selected && <NodeInspector selected={selected} edges={edges} setParam={setParam} />}

        {assistantOpen && (
          <AssistantPanel
            client={client}
            workflowId={workflowId}
            buildGraph={buildGraph}
            onApply={applyProposal}
            onClose={() => setAssistantOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
