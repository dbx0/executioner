import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { Edge, Node } from 'reactflow'
import type { GraphNodeData } from '../../components/canvas/GraphNodes.js'
import type { workflowsApi } from '../../api/workflows.js'
import type { AssistantProposal } from '../../api/assistant.js'
import type { CatalogEntry } from '../../lib/node-catalog.js'
import type { Graph } from '../../lib/graph-types.js'
import type { GraphHistory } from '../../lib/useGraphHistory.js'
import { downloadJson, parseWorkflowFile } from '../../lib/workflow-io.js'
import { notify } from '../../lib/toast.js'
import { buildGraph, exportFileName, hydrateGraph } from './graph-io.js'
import { saveLastWorkflow } from './helpers.js'

/**
 * The workflow open on the canvas as a document: its id and name, and every
 * action that loads, replaces or persists the whole graph (open, save,
 * duplicate, delete, import, export, apply an assistant proposal).
 *
 * The caller owns the node/edge state, the `history` instance and the
 * `applyingHistory` guard, since undo/redo shares them.
 */
export function useWorkflowDocument({
  initialWorkflowId,
  wfApi,
  activeRoot,
  catalog,
  listingsLoaded,
  nodes,
  edges,
  setNodes,
  setEdges,
  setSelectedId,
  history,
  applyingHistory,
}: {
  /** The workflow the hub asked to open, or `'new'` for a blank canvas. */
  initialWorkflowId: string | 'new'
  wfApi: ReturnType<typeof workflowsApi>
  activeRoot: string | null
  catalog: CatalogEntry[]
  listingsLoaded: boolean
  nodes: Node<GraphNodeData>[]
  edges: Edge[]
  setNodes: Dispatch<SetStateAction<Node<GraphNodeData>[]>>
  setEdges: Dispatch<SetStateAction<Edge[]>>
  setSelectedId: Dispatch<SetStateAction<string | undefined>>
  history: GraphHistory<GraphNodeData>
  applyingHistory: MutableRefObject<boolean>
}) {
  const [workflowId, setWorkflowId] = useState<string | undefined>()
  const [name, setName] = useState('Untitled workflow')
  const [saving, setSaving] = useState(false)
  // The workflow the hub asked for has not landed on the canvas yet.
  const [loading, setLoading] = useState(initialWorkflowId !== 'new')
  const [duplicating, setDuplicating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [importing, setImporting] = useState(false)
  /** Guards the one-shot initial workflow load handed down from the hub. */
  const initialLoaded = useRef(false)

  // Nodes added after a graph is loaded animate in. Each load, import or blank
  // canvas bumps the generation and re-baselines; null until the first one, so
  // the first node dropped on an empty canvas still animates.
  const [canvasGen, setCanvasGen] = useState<number | null>(null)
  const nextCanvas = useCallback(() => setCanvasGen((g) => (g ?? 0) + 1), [])

  // Put a whole graph on the canvas as a fresh baseline: the history recorder
  // skips the change and the undo stack restarts from it.
  const replaceCanvas = useCallback(
    (nextNodes: Node<GraphNodeData>[], nextEdges: Edge[]) => {
      applyingHistory.current = true
      setNodes(nextNodes)
      setEdges(nextEdges)
      nextCanvas()
      history.reset(nextNodes, nextEdges)
      setSelectedId(undefined)
    },
    [applyingHistory, setNodes, setEdges, nextCanvas, history, setSelectedId],
  )

  const loadWorkflow = useCallback(
    async (id: string) => {
      const wf = await wfApi.get(id)
      const flow = hydrateGraph(wf.graph, catalog)
      setWorkflowId(id)
      setName(wf.name)
      replaceCanvas(flow.nodes, flow.edges)
      saveLastWorkflow(activeRoot, id)
    },
    [wfApi, catalog, replaceCanvas, activeRoot],
  )

  // Load the workflow the hub asked us to open, once the node catalog is ready
  // (so the graph hydrates with the right node kinds/params). Runs once; a
  // 'new' request just leaves the blank canvas in place.
  useEffect(() => {
    if (initialLoaded.current) return
    if (initialWorkflowId === 'new') {
      initialLoaded.current = true
      nextCanvas()
      saveLastWorkflow(activeRoot, null)
      return
    }
    // Hydrating before the tool list lands leaves every tool node without its
    // category and its parameter form, since nothing re-hydrates it afterwards.
    if (!listingsLoaded) return
    initialLoaded.current = true
    void loadWorkflow(initialWorkflowId)
      .catch(() => notify.error('Could not load the workflow.'))
      .finally(() => setLoading(false))
  }, [initialWorkflowId, listingsLoaded, activeRoot, loadWorkflow, nextCanvas])

  const currentGraph = useCallback((): Graph => buildGraph(nodes, edges), [nodes, edges])

  // Load a proposed graph from the assistant onto the canvas, replacing the
  // current graph. Recorded in the undo history so the user can revert; the
  // user reviews and Saves as normal (nothing is persisted here).
  const applyProposal = useCallback(
    (proposal: AssistantProposal) => {
      const hydrated = hydrateGraph(proposal.graph, catalog)
      // Leave applyingHistory unset so the recorder effect pushes this onto the
      // undo stack (the user can revert the applied proposal).
      setNodes(hydrated.nodes)
      setEdges(hydrated.edges)
      setSelectedId(undefined)
      notify('Applied the proposed workflow. Review and Save.')
    },
    [catalog, setNodes, setEdges, setSelectedId],
  )

  const newWorkflow = (): void => {
    setWorkflowId(undefined)
    setName('Untitled workflow')
    replaceCanvas([], [])
    saveLastWorkflow(activeRoot, null)
  }

  const save = async (): Promise<string | undefined> => {
    setSaving(true)
    try {
      const graph = currentGraph()
      if (workflowId === undefined) {
        const created = await wfApi.create(name, graph)
        setWorkflowId(created.id)
        saveLastWorkflow(activeRoot, created.id)
        return created.id
      }
      await wfApi.update(workflowId, name, graph)
      return workflowId
    } finally {
      setSaving(false)
    }
  }

  const removeWorkflow = async (keepHistory: boolean): Promise<void> => {
    if (workflowId === undefined) return
    setDeleting(true)
    try {
      await wfApi.remove(workflowId, keepHistory)
      newWorkflow()
    } catch {
      notify.error('Could not delete the workflow.')
    } finally {
      setDeleting(false)
    }
  }

  const duplicateWorkflow = async (): Promise<void> => {
    if (workflowId === undefined) return
    setDuplicating(true)
    try {
      const created = await wfApi.duplicate(workflowId)
      await loadWorkflow(created.id)
    } catch {
      notify.error('Could not duplicate the workflow.')
    } finally {
      setDuplicating(false)
    }
  }

  const exportWorkflow = (): void => {
    downloadJson(exportFileName(name), { name, graph: currentGraph() })
  }

  const importWorkflow = (parsed: NonNullable<ReturnType<typeof parseWorkflowFile>>): void => {
    const hydrated = hydrateGraph(parsed.graph, catalog)
    setWorkflowId(undefined)
    setName(parsed.name ?? 'Imported workflow')
    replaceCanvas(hydrated.nodes, hydrated.edges)
  }

  const importFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file === undefined) return
    setImporting(true)
    try {
      const parsed = parseWorkflowFile(await file.text())
      if (parsed === null) {
        notify.error('Import failed. Not a valid workflow file.')
        return
      }
      importWorkflow(parsed)
    } catch {
      notify.error('Import failed. Could not read the file.')
    } finally {
      setImporting(false)
    }
  }

  return {
    workflowId,
    name,
    setName,
    saving,
    loading,
    duplicating,
    deleting,
    importing,
    canvasGen,
    currentGraph,
    applyProposal,
    save,
    removeWorkflow,
    duplicateWorkflow,
    exportWorkflow,
    importFile,
    importWorkflow,
  }
}
