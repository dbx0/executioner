import type { JSX, MutableRefObject, ReactNode } from 'react'
import { Play, Save, Pencil, Network, Copy, Trash2, Download, Upload, Undo2, Redo2, ChevronLeft, Sparkles } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Input } from '../../components/ui/input.js'
import { PageToolbar } from '../../components/ui/page.js'
import { Spinner } from '../../components/ui/spinner.js'
import { Tip } from '../../components/ui/tip.js'
import { cn } from '../../lib/utils.js'

/** One icon action inside a toolbar capsule, with the app tooltip. */
function CapsuleAction({
  label,
  hint,
  onClick,
  disabled = false,
  pending = false,
  className,
  children,
}: {
  /** The accessible name. */
  label: string
  /** The tooltip text when it says more than the name (a shortcut). */
  hint?: string
  onClick: () => void
  disabled?: boolean
  /** Async work this button started is still running: it spins and cannot be pressed. */
  pending?: boolean
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <Tip label={hint ?? label}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled || pending}
        onClick={onClick}
        className={cn(
          'flex h-[26px] w-[30px] items-center justify-center rounded-full text-muted-foreground outline-none transition-colors',
          'hover:bg-glass-active hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'disabled:pointer-events-none disabled:opacity-40',
          className,
        )}
      >
        {pending ? <Spinner size="sm" /> : children}
      </button>
    </Tip>
  )
}

/** A capsule grouping related icon actions. */
function Capsule({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div role="group" aria-label={label} className="glass-capsule flex h-8 shrink-0 items-center gap-0.5 px-1">
      {children}
    </div>
  )
}

/**
 * The workflow editor's toolbar row: the breadcrumb back to the hub, rename,
 * the workflow-level actions (duplicate/delete/export/import), undo/redo and
 * the AI/Arrange/Save/Run cluster. It is the top of the page, so the row drags
 * the window. Purely presentational: every value it reads arrives as a prop.
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
  duplicating,
  deleting,
  importing,
  openingRun,
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
  duplicating: boolean
  deleting: boolean
  importing: boolean
  /** Run was pressed and the targets for the run panel are being fetched. */
  openingRun: boolean
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
    <PageToolbar
      actions={
        <>
          <Capsule label="History">
            <CapsuleAction label="Undo" hint="Undo (⌘Z)" disabled={!canUndo} onClick={onUndo}>
              <Undo2 className="size-3.5" strokeWidth={2} />
            </CapsuleAction>
            <CapsuleAction label="Redo" hint="Redo (⌘⇧Z)" disabled={!canRedo} onClick={onRedo}>
              <Redo2 className="size-3.5" strokeWidth={2} />
            </CapsuleAction>
          </Capsule>
          <Button
            variant="glass"
            size="sm"
            aria-label="AI assistant"
            aria-pressed={assistantOpen}
            onClick={onToggleAssistant}
            className={cn(
              'text-ai',
              assistantOpen ? 'bg-ai/30 hover:bg-ai/35' : 'bg-ai/20 hover:bg-ai/25',
            )}
          >
            <Sparkles className="size-3.5" strokeWidth={2} />
            Ask AI
          </Button>
          <Button variant="glass" size="sm" disabled={nodeCount === 0} onClick={onArrange}>
            <Network className="size-3.5" strokeWidth={1.75} />
            Arrange
          </Button>
          <Button variant="glass" size="sm" disabled={saving} onClick={onSave}>
            {saving ? <Spinner size="sm" /> : <Save className="size-3.5" strokeWidth={1.75} />}
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <div className="relative">
            <Button size="sm" disabled={nodeCount === 0 || openingRun} onClick={onOpenRun}>
              {openingRun ? <Spinner size="sm" /> : <Play className="size-3 fill-current" strokeWidth={2} />}
              Run
            </Button>
            {/* An empty canvas already disables Run; its "no nodes" error needs no badge. */}
            {hasErrors && nodeCount > 0 && (
              <span
                aria-label={`${errorCount} validation errors`}
                className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-error px-1 text-[10px] font-semibold text-destructive-foreground"
              >
                {errorCount}
              </span>
            )}
          </div>
        </>
      }
    >
      <Tip label="Back to Workflows">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          aria-label="Back to Workflows"
          className="gap-1 px-2 text-[15px] font-normal text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" strokeWidth={1.75} />
          Workflows
        </Button>
      </Tip>
      <span aria-hidden className="text-tertiary-foreground">
        /
      </span>
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
        <h1 className="max-w-56 truncate text-[15px] font-semibold tracking-[-0.01em]">{name}</h1>
      )}
      <Capsule label="Workflow">
        {!renaming && (
          <CapsuleAction label="Rename workflow" onClick={() => setRenaming(true)}>
            <Pencil className="size-3.5" strokeWidth={1.75} />
          </CapsuleAction>
        )}
        <CapsuleAction
          label="Duplicate workflow"
          disabled={workflowId === undefined}
          pending={duplicating}
          onClick={onDuplicateWorkflow}
        >
          <Copy className="size-3.5" strokeWidth={1.75} />
        </CapsuleAction>
        <CapsuleAction
          label="Delete workflow"
          disabled={workflowId === undefined}
          pending={deleting}
          onClick={onRequestDelete}
          className="hover:text-status-error"
        >
          <Trash2 className="size-3.5" strokeWidth={1.75} />
        </CapsuleAction>
        <CapsuleAction label="Export workflow" disabled={nodeCount === 0} onClick={onExport}>
          <Download className="size-3.5" strokeWidth={1.75} />
        </CapsuleAction>
        <CapsuleAction label="Import workflow" pending={importing} onClick={() => importRef.current?.click()}>
          <Upload className="size-3.5" strokeWidth={1.75} />
        </CapsuleAction>
      </Capsule>
      {/* Never shown: it only opens the system file dialog for Import. */}
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={onImportFile}
      />
    </PageToolbar>
  )
}
