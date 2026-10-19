import type { JSX } from 'react'
import type { MutableRefObject } from 'react'
import { Play, Save, Pencil, Network, Copy, Trash2, Download, Upload, Undo2, Redo2, ArrowLeft, Sparkles } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Input } from '../../components/ui/input.js'

/**
 * The workflow editor's top toolbar: back, rename, workflow-level actions
 * (duplicate/delete/export/import), undo/redo and the AI/Arrange/Save/Run
 * cluster. Purely presentational — every value it reads arrives as a prop.
 */
export function EditorToolbar({
  onBack,
  name,
  setName,
  renaming,
  setRenaming,
  workflowId,
  nodeCount,
  saving,
  assistantOpen,
  canUndo,
  canRedo,
  hasErrors,
  errorCount,
  importRef,
  onDuplicateWorkflow,
  onRequestDelete,
  onExport,
  onImportFile,
  onUndo,
  onRedo,
  onToggleAssistant,
  onArrange,
  onSave,
  onOpenRun,
}: {
  onBack: () => void
  name: string
  setName: (value: string) => void
  renaming: boolean
  setRenaming: (value: boolean) => void
  workflowId: string | undefined
  nodeCount: number
  saving: boolean
  assistantOpen: boolean
  canUndo: boolean
  canRedo: boolean
  hasErrors: boolean
  errorCount: number
  importRef: MutableRefObject<HTMLInputElement | null>
  onDuplicateWorkflow: () => void
  onRequestDelete: () => void
  onExport: () => void
  onImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void
  onUndo: () => void
  onRedo: () => void
  onToggleAssistant: () => void
  onArrange: () => void
  onSave: () => void
  onOpenRun: () => void
}): JSX.Element {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
      <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back to Workflows" title="Back to Workflows">
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        Workflows
      </Button>
      <span className="mx-0.5 h-5 w-px bg-border" />
      {renaming ? (
        <Input
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') setRenaming(false)
          }}
          className="h-8 w-56 text-[13px] font-medium"
          aria-label="Workflow name"
        />
      ) : (
        <div className="flex items-center gap-1">
          <span className="max-w-56 truncate text-[13px] font-medium" title={name}>
            {name}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Rename workflow"
            title="Rename workflow"
            onClick={() => setRenaming(true)}
          >
            <Pencil className="size-3.5" strokeWidth={1.75} />
          </Button>
        </div>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Duplicate workflow"
        title="Duplicate workflow"
        disabled={workflowId === undefined}
        onClick={onDuplicateWorkflow}
      >
        <Copy className="size-4" strokeWidth={1.75} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Delete workflow"
        title="Delete workflow"
        disabled={workflowId === undefined}
        onClick={onRequestDelete}
        className="text-muted-foreground hover:text-status-error"
      >
        <Trash2 className="size-4" strokeWidth={1.75} />
      </Button>
      <span className="mx-0.5 h-5 w-px bg-border" />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Export workflow"
        title="Export workflow"
        disabled={nodeCount === 0}
        onClick={onExport}
      >
        <Download className="size-4" strokeWidth={1.75} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Import workflow"
        title="Import workflow"
        onClick={() => importRef.current?.click()}
      >
        <Upload className="size-4" strokeWidth={1.75} />
      </Button>
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={onImportFile}
      />
      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Undo"
          title="Undo (⌘Z)"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 className="size-4" strokeWidth={1.75} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Redo"
          title="Redo (⌘⇧Z)"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 className="size-4" strokeWidth={1.75} />
        </Button>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <Button
          variant="outline"
          size="sm"
          aria-label="AI assistant"
          aria-pressed={assistantOpen}
          onClick={onToggleAssistant}
        >
          <Sparkles className="size-4" strokeWidth={1.75} />
          AI
        </Button>
        <Button variant="outline" size="sm" disabled={nodeCount === 0} onClick={onArrange}>
          <Network className="size-4" strokeWidth={1.75} />
          Arrange
        </Button>
        <Button variant="outline" size="sm" disabled={saving} onClick={onSave}>
          <Save className="size-4" strokeWidth={1.75} />
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <div className="relative">
          <Button size="sm" disabled={nodeCount === 0} onClick={onOpenRun}>
            <Play className="size-4" strokeWidth={2} />
            Run
          </Button>
          {hasErrors && (
            <span
              aria-label={`${errorCount} validation errors`}
              className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-error px-1 text-[10px] font-semibold text-white"
            >
              {errorCount}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
