import type { JSX } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useMemo, useRef, useState } from 'react'
import { MiniMap, ReactFlowProvider, useEdgesState, useNodesState, type ReactFlowInstance } from 'reactflow'
import { useApp } from '../store.js'
import { workflowsApi } from '../api/workflows.js'
import { executionsApi } from '../api/executions.js'
import { AddBackendModal } from '../components/modals/BackendsDialog.js'
import { ConfirmModal } from '../components/modals/ConfirmModal.js'
import { Button } from '../components/ui/button.js'
import { DialogBody, DialogFooter, DialogHeader } from '../components/ui/dialog.js'
import { parseWorkflowFile } from '../lib/workflow-io.js'
import { notify } from '../lib/toast.js'
import { GlassPanel } from '../components/ui/glass-panel.js'
import { Page } from '../components/ui/page.js'
import { LoadingState } from '../components/ui/spinner.js'
import { categoryColor } from '../lib/node-catalog.js'
import type { GraphNodeData } from '../components/canvas/GraphNodes.js'
import { Palette } from '../components/canvas/Palette.js'
import { AssistantPanel } from '../components/canvas/AssistantPanel.js'
import { NodePicker } from '../components/canvas/NodePicker.js'
import { ZoomControls } from '../components/canvas/ZoomControls.js'
import { validateWorkflow } from '../lib/workflow-validate.js'
import { useGraphHistory } from '../lib/useGraphHistory.js'
import { useNewIds } from '../lib/motion.js'
import { useEngineEvents } from '../lib/events.js'
import { useUndoRedo } from './workflow-editor/useUndoRedo.js'
import { useEditorCatalog } from './workflow-editor/useEditorCatalog.js'
import { useRunBackend } from './workflow-editor/useRunBackend.js'
import { useGraphEditing } from './workflow-editor/useGraphEditing.js'
import { useWorkflowDocument } from './workflow-editor/useWorkflowDocument.js'
import { useWorkflowRun } from './workflow-editor/useWorkflowRun.js'
import { useLiveRunPaint } from './workflow-editor/useLiveRunPaint.js'
import { EditorCanvas } from './workflow-editor/EditorCanvas.js'
import { EditorToolbar } from './workflow-editor/EditorToolbar.js'
import { ValidationPanel } from './workflow-editor/ValidationPanel.js'
import { RunPanel } from './workflow-editor/RunPanel.js'
import { RunStatus } from './workflow-editor/RunStatus.js'
import { StepControlBar } from './workflow-editor/StepControlBar.js'
import { NodeInspector } from './workflow-editor/NodeInspector.js'

type ImportedWorkflow = NonNullable<ReturnType<typeof parseWorkflowFile>>

interface WorkflowEditorProps {
  workflowId: string | 'new'
  onBack: () => void
}

/**
 * The workflow canvas editor. Reached from the Workflows hub, which passes the
 * workflow to open (`'new'` for a blank canvas) and a `onBack` affordance to
 * return to the hub. Mounted with a `key` per workflow so switching workflows
 * from the hub remounts it with fresh state.
 *
 * The provider sits outside the canvas so the controls floating over it (the
 * zoom capsule, the minimap) can read and drive the same viewport.
 */
export function WorkflowEditor(props: WorkflowEditorProps): JSX.Element {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  )
}

/** Composes the editor from its hooks: the state lives here, the behavior in `workflow-editor/`. */
function Editor({ workflowId: initialWorkflowId, onBack }: WorkflowEditorProps): JSX.Element {
  const client = useApp((s) => s.client)!
  const connection = useApp((s) => s.connection)!
  const activeRoot = useApp((s) => s.activeRoot)
  const wfApi = useMemo(() => workflowsApi(client), [client])
  const exApi = useMemo(() => executionsApi(client), [client])

  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNodeData>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [renaming, setRenaming] = useState(false)
  const [backendsOpen, setBackendsOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [pendingPaste, setPendingPaste] = useState<ImportedWorkflow | null>(null)
  const [showValidation, setShowValidation] = useState(false)
  // The AI workflow assistant panel, toggled from the toolbar.
  const [assistantOpen, setAssistantOpen] = useState(false)

  const rfRef = useRef<ReactFlowInstance | null>(null)
  const importRef = useRef<HTMLInputElement | null>(null)
  const pasteTriggerRef = useRef<HTMLElement | null>(null)
  // Set true just before applying an undo/redo/reset snapshot so the history
  // recorder skips the resulting nodes/edges change (avoids re-recording it).
  const applyingHistory = useRef(false)
  const history = useGraphHistory<GraphNodeData>()

  const { listings, listingsLoaded, catalog } = useEditorCatalog(client)
  const backend = useRunBackend(client, activeRoot)
  const events = useEngineEvents(connection)

  // Pre-run validation, recomputed only when the graph changes.
  const issues = useMemo(() => validateWorkflow(nodes, edges), [nodes, edges])
  const errorIssues = useMemo(() => issues.filter((i) => i.severity === 'error'), [issues])
  const warningIssues = useMemo(() => issues.filter((i) => i.severity === 'warning'), [issues])
  const hasErrors = errorIssues.length > 0

  const editing = useGraphEditing({ nodes, edges, setNodes, setEdges, setSelectedId, catalog, rfRef })
  // Structural-edit recording, undo/redo callbacks and their keyboard shortcuts.
  const { undo, redo } = useUndoRedo({ nodes, edges, setNodes, setEdges, history, applyingHistory })
  const doc = useWorkflowDocument({
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
  })
  const runner = useWorkflowRun({
    client,
    exApi,
    events,
    nodes,
    setNodes,
    save: doc.save,
    hasErrors,
    onInvalid: () => setShowValidation(true),
    backendId: backend.backendId,
  })
  useLiveRunPaint({ events, runSeq: runner.runSeq, singleRun: runner.singleRun, setNodes })

  const nodeIds = useMemo(() => nodes.map((n) => n.id), [nodes])
  const newNodeIds = useNewIds(nodeIds, doc.canvasGen, doc.canvasGen !== null)
  const selected = nodes.find((n) => n.id === selectedId)

  const importPastedWorkflow = (workflow: ImportedWorkflow): void => {
    try {
      doc.importWorkflow(workflow)
      notify.success('Workflow imported. Save to keep it.')
    } catch {
      notify.error('Import failed. Could not import workflow JSON from the clipboard.')
    }
  }

  const onPasteImport = async (): Promise<void> => {
    pasteTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    try {
      const text = window.executioner?.clipboardRead !== undefined
        ? await window.executioner.clipboardRead()
        : await navigator.clipboard.readText()
      const parsed = parseWorkflowFile(text.replace(/^\uFEFF/, ''))
      if (parsed === null) {
        notify.error('Import failed. Expected workflow JSON with graph.nodes and graph.edges arrays.')
        return
      }
      const canvasNodes = rfRef.current?.getNodes() ?? nodes
      const canvasEdges = rfRef.current?.getEdges() ?? edges
      if (canvasNodes.length > 0 || canvasEdges.length > 0) {
        setPendingPaste(parsed)
        return
      }
      importPastedWorkflow(parsed)
    } catch {
      notify.error('Import failed. Could not import workflow JSON from the clipboard.')
    }
  }

  return (
    <Page>
      <EditorToolbar
        onBack={onBack}
        name={doc.name}
        setName={doc.setName}
        renaming={renaming}
        setRenaming={setRenaming}
        workflowId={doc.workflowId}
        nodeCount={nodes.length}
        saving={doc.saving}
        duplicating={doc.duplicating}
        deleting={doc.deleting}
        importing={doc.importing}
        openingRun={runner.opening}
        assistantOpen={assistantOpen}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        hasErrors={hasErrors}
        errorCount={errorIssues.length}
        importRef={importRef}
        onDuplicateWorkflow={() => void doc.duplicateWorkflow()}
        onRequestDelete={() => setDeleteConfirm(true)}
        onExport={doc.exportWorkflow}
        onPasteImport={() => void onPasteImport()}
        onImportFile={(e) => void doc.importFile(e)}
        onUndo={undo}
        onRedo={redo}
        onToggleAssistant={() => setAssistantOpen((v) => !v)}
        onArrange={editing.arrange}
        onSave={() => void doc.save()}
        onOpenRun={() => void runner.openRun()}
      />

      <GlassPanel tone="ink" className="relative min-h-0 flex-1">
        <EditorCanvas
          nodes={nodes}
          edges={edges}
          newNodeIds={newNodeIds}
          actions={{
            onDuplicate: editing.onDuplicate,
            onDelete: editing.onDelete,
            onInsertBetween: editing.onInsertBetween,
            onAppend: editing.onAppend,
            onRunNode: (id) => void runner.runSingleNode(id),
          }}
          rfRef={rfRef}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={editing.onConnect}
          onNodesDelete={editing.onNodesDelete}
          onDrop={editing.onDrop}
          onDragOver={editing.onDragOver}
          onSelect={setSelectedId}
        />

        {/* Everything floating over the canvas. The layer itself lets clicks
            through; each panel turns pointer events back on for itself. */}
        <div className="pointer-events-none absolute inset-0 flex gap-3 p-3">
          <Palette listings={listings} onAdd={editing.addNode} loading={!listingsLoaded} />

          <div className="relative min-w-0 flex-1">
            {doc.loading ? (
              <LoadingState label="Loading workflow" />
            ) : (
              nodes.length === 0 && (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-muted-foreground">Add nodes from the palette to build a workflow.</p>
                </div>
              )
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

            {runner.runOpen && (
              <RunPanel
                targets={runner.targets}
                targetId={runner.targetId}
                onTargetChange={runner.setTargetId}
                profiles={backend.profiles}
                backendId={backend.backendId}
                onBackendChange={backend.setBackendId}
                stepMode={runner.stepMode}
                onStepModeChange={runner.setStepMode}
                onManageBackends={() => setBackendsOpen(true)}
                onCancel={runner.closeRun}
                onRun={() => void runner.run()}
                starting={runner.starting}
              />
            )}

            <ZoomControls className="absolute bottom-0 left-0" />
            <MiniMap
              pannable
              zoomable
              // The colour is catalog data, read per node.
              nodeColor={(node) => categoryColor((node.data as GraphNodeData).category)}
              className="pointer-events-auto"
            />

            {/* Step-through control bar, or the wait for a full run */}
            {runner.stepExec !== null ? (
              <StepControlBar
                onNext={() => void runner.stepNext()}
                onResume={() => void runner.stepResume()}
                stepping={runner.stepping}
              />
            ) : (
              runner.running && <RunStatus />
            )}
          </div>

          {selected && <NodeInspector selected={selected} edges={edges} setParam={editing.setParam} />}

          {assistantOpen && (
            <AssistantPanel
              client={client}
              workflowId={doc.workflowId}
              buildGraph={doc.currentGraph}
              ensureSaved={() => (doc.workflowId === undefined ? doc.save() : Promise.resolve(doc.workflowId))}
              onApply={doc.applyProposal}
              onClose={() => setAssistantOpen(false)}
            />
          )}
        </div>
      </GlassPanel>

      {/* Node picker (edge insert / node append) */}
      {editing.picker !== null && (
        <NodePicker
          entries={catalog}
          x={editing.picker.x}
          y={editing.picker.y}
          onPick={editing.onPickNode}
          onClose={editing.closePicker}
        />
      )}

      {backendsOpen && (
        <AddBackendModal client={client} onClose={() => setBackendsOpen(false)} onSaved={backend.reloadProfiles} />
      )}

      <Dialog.Root open={pendingPaste !== null} onOpenChange={(open) => { if (!open) setPendingPaste(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[75] bg-black/55 backdrop-blur-[2px]" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[76] w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-panel border border-glass-border bg-popover text-popover-foreground shadow-floating outline-none"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              pasteTriggerRef.current?.focus()
            }}
          >
            <DialogHeader title="Replace current workflow?" />
            <DialogBody>
              <Dialog.Description className="text-[13px] text-muted-foreground">
                Pasting replaces the open canvas. Unsaved changes will be lost. This cannot be undone.
              </Dialog.Description>
            </DialogBody>
            <DialogFooter>
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm">Cancel</Button>
              </Dialog.Close>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (pendingPaste === null) return
                  importPastedWorkflow(pendingPaste)
                  setPendingPaste(null)
                }}
              >
                Replace workflow
              </Button>
            </DialogFooter>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {deleteConfirm && (
        <ConfirmModal
          title="Delete workflow"
          message={`Delete “${doc.name}”? This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          checkboxLabel="Keep this workflow's run history"
          checkboxDefault
          onCancel={() => setDeleteConfirm(false)}
          onConfirm={(keepHistory) => {
            setDeleteConfirm(false)
            void doc.removeWorkflow(keepHistory)
          }}
        />
      )}
    </Page>
  )
}
