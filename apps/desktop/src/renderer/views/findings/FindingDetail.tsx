import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { Eye, Fullscreen, Maximize2, Minimize2, PenLine, Trash2, X } from 'lucide-react'
import { SEVERITIES, STATUSES, statusLabel, type Finding, type FindingInput } from '../../api/findings.js'
import { MarkdownRender } from '../../components/markdown/MarkdownRender.js'
import { Button } from '../../components/ui/button.js'
import { Input } from '../../components/ui/input.js'
import { ScrollArea } from '../../components/ui/scroll-area.js'
import { Select } from '../../components/ui/select.js'
import { cn } from '../../lib/utils.js'
import { stagger } from '../../lib/motion.js'
import { SourceChip } from './chips.js'

const severityOptions = SEVERITIES.map((s) => ({ value: s, label: s }))
const statusOptions = STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))

/** One staggered entrance step. FindingDetail is keyed by finding id, so this replays per selection only. */
function Step({ index, children }: { index: number; children: React.ReactNode }): JSX.Element {
  return (
    <div className="motion-safe:animate-enter" style={stagger(index, 120)}>
      {children}
    </div>
  )
}

const LABEL_CLASS = 'text-[11px] font-medium uppercase tracking-wide text-muted-foreground'

/**
 * One labelled field. With an `action` the label becomes a row (the action sits
 * at its right) and the wrapper stops being a `<label>`: a button inside one
 * forwards its clicks to the control, which would put the caret in the textarea
 * every time you reached for the action.
 */
function Field({
  label,
  action,
  children,
}: {
  label: string
  action?: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  if (action === undefined) {
    return (
      <label className="flex flex-col gap-1.5">
        <span className={LABEL_CLASS}>{label}</span>
        {children}
      </label>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-5 items-center gap-2">
        <span className={LABEL_CLASS}>{label}</span>
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </div>
  )
}

/** How the prose fields are shown: rendered markdown, or the raw source. */
type ProseView = 'preview' | 'edit'

/**
 * How tall a rendered field may grow before it scrolls. Expanded gets the list
 * column's width back and no competition for the page, so the ceilings lift.
 */
const CAPS = {
  split: { description: 'max-h-48', details: 'max-h-96' },
  expanded: { description: 'max-h-72', details: 'max-h-[60vh]' },
} as const

/** Rendered when there is prose to render, the editor when there is not. */
function initialView(finding: Finding): ProseView {
  return finding.description.trim() === '' && finding.details.trim() === '' ? 'edit' : 'preview'
}

/**
 * A prose field in preview: the markdown as an agent wrote it. Findings are
 * filed as markdown — fenced requests, tables of parameters — so the raw source
 * is the wrong default for a pane whose main job is reading a finding.
 *
 * `cap` bounds the field at roughly the height of the textarea it replaces and
 * scrolls past it. A finding whose details run to a full exploit write-up would
 * otherwise push the severity, the status and the metadata so far down the pane
 * that reading one means scrolling past all of it.
 */
function Rendered({ source, cap }: { source: string; cap: string }): JSX.Element {
  const empty = source.trim() === ''
  return (
    <div
      className={cn(
        'min-w-0 rounded-md border border-input bg-surface-1',
        empty && 'px-3 py-2 text-sm italic text-muted-foreground',
      )}
    >
      {empty ? (
        'Nothing recorded.'
      ) : (
        <ScrollArea className={cn('min-w-0 overflow-x-hidden', cap)}>
          <MarkdownRender source={source} className="px-3 py-2" />
        </ScrollArea>
      )}
    </div>
  )
}

/** The button that lifts one prose field into the full-screen reader. */
function FullScreenButton({ label, onOpen }: { label: string; onOpen: () => void }): JSX.Element {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`Open ${label} full screen`}
      title="Full screen"
      className="-my-1 text-muted-foreground hover:text-foreground"
      onClick={onOpen}
    >
      <Fullscreen className="size-3.5" strokeWidth={1.75} />
    </Button>
  )
}

/**
 * One prose field in a floating modal over the app. Details on a real finding
 * run to a full write-up that the pane can only show a slice of at a time; this
 * is the view for reading (or writing) the whole of it. Escape or a click on the
 * backdrop closes it.
 */
function FullScreenField({
  label,
  value,
  view,
  onChange,
  onClose,
}: {
  label: string
  value: string
  view: ProseView
  onChange: (value: string) => void
  onClose: () => void
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const empty = value.trim() === ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="flex h-[82vh] w-[920px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
          <span className={LABEL_CLASS}>{label}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close full screen"
            title="Close"
            className="ml-auto text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            <X className="size-4" strokeWidth={1.75} />
          </Button>
        </div>
        {view === 'preview' ? (
          <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
            <div className="min-w-0 px-6 py-5">
              {empty ? (
                <p className="text-sm italic text-muted-foreground">Nothing recorded.</p>
              ) : (
                <MarkdownRender source={value} />
              )}
            </div>
          </ScrollArea>
        ) : (
          <div className="min-h-0 flex-1 p-4">
            <textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              aria-label={label}
              className="textarea-sleek scrollbar-sleek h-full w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 font-mono text-[12px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * One finding, open for reading and editing. Edits are held locally and saved on
 * Save — a findings page where every keystroke hits the engine would fight you
 * while you write up an explanation.
 */
export function FindingDetail({
  finding,
  targetValue,
  saving,
  expanded,
  onToggleExpand,
  onSave,
  onDelete,
}: {
  finding: Finding
  targetValue: string | null
  saving: boolean
  /** True while the finding has the page to itself, the list column hidden. */
  expanded: boolean
  onToggleExpand: () => void
  onSave: (patch: Partial<FindingInput>) => void
  onDelete: () => void
}): JSX.Element {
  const [draft, setDraft] = useState(finding)
  // A finding with prose opens rendered — reading and triaging is the common
  // case — while an empty one opens in the editor, since there is nothing to
  // render and the operator is here to write it.
  const [view, setView] = useState<ProseView>(() => initialView(finding))
  // Which prose field, if any, is currently taking over the app window.
  const [fullScreen, setFullScreen] = useState<'description' | 'details' | null>(null)
  // Selecting another finding replaces the draft; an unsaved edit is not carried
  // across, which is what you want when the two are different findings.
  useEffect(() => {
    setDraft(finding)
    setView(initialView(finding))
    setFullScreen(null)
  }, [finding])

  const dirty =
    draft.title !== finding.title ||
    draft.severity !== finding.severity ||
    draft.status !== finding.status ||
    draft.description !== finding.description ||
    draft.details !== finding.details

  const caps = expanded ? CAPS.expanded : CAPS.split

  const save = (): void => {
    onSave({
      title: draft.title,
      severity: draft.severity,
      status: draft.status,
      description: draft.description,
      details: draft.details,
    })
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4 motion-safe:animate-enter"
        style={stagger(0, 120)}
      >
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{finding.title}</span>
        <SourceChip source={finding.source} />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={expanded ? 'Collapse finding' : 'Expand finding'}
          aria-pressed={expanded}
          title={expanded ? 'Collapse' : 'Expand'}
          className="text-muted-foreground hover:text-foreground"
          onClick={onToggleExpand}
        >
          {expanded ? (
            <Minimize2 className="size-4" strokeWidth={1.75} />
          ) : (
            <Maximize2 className="size-4" strokeWidth={1.75} />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={view === 'preview' ? 'Edit description and details' : 'Preview description and details'}
          aria-pressed={view === 'edit'}
          title={view === 'preview' ? 'Edit' : 'Preview'}
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setView(view === 'preview' ? 'edit' : 'preview')}
        >
          {view === 'preview' ? (
            <PenLine className="size-4" strokeWidth={1.75} />
          ) : (
            <Eye className="size-4" strokeWidth={1.75} />
          )}
        </Button>
        <Button size="sm" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete finding"
          title="Delete finding"
          className="text-muted-foreground hover:text-status-error"
          onClick={onDelete}
        >
          <Trash2 className="size-4" strokeWidth={1.75} />
        </Button>
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <div className={cn('flex min-w-0 flex-col gap-4 p-4', expanded && 'mx-auto w-full max-w-4xl')}>
          <Step index={1}>
            <Field label="Title">
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </Field>
          </Step>

          <Step index={2}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Severity">
                <Select
                  value={draft.severity}
                  onValueChange={(severity) => setDraft({ ...draft, severity })}
                  options={severityOptions}
                  ariaLabel="Severity"
                />
              </Field>
              <Field label="Status">
                <Select
                  value={draft.status}
                  onValueChange={(status) => setDraft({ ...draft, status })}
                  options={statusOptions}
                  ariaLabel="Status"
                />
              </Field>
            </div>
          </Step>

          <Step index={3}>
            <Field
              label="Description"
              action={<FullScreenButton label="description" onOpen={() => setFullScreen('description')} />}
            >
              {view === 'preview' ? (
                <Rendered source={draft.description} cap={caps.description} />
              ) : (
                <textarea
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  rows={4}
                  placeholder="What it is and why it matters. Markdown."
                  className="textarea-sleek scrollbar-sleek w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-[12px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              )}
            </Field>
          </Step>

          <Step index={4}>
            <Field
              label="Details"
              action={<FullScreenButton label="details" onOpen={() => setFullScreen('details')} />}
            >
              {view === 'preview' ? (
                <Rendered source={draft.details} cap={caps.details} />
              ) : (
                <textarea
                  value={draft.details}
                  onChange={(e) => setDraft({ ...draft, details: e.target.value })}
                  rows={16}
                  placeholder="The evidence: request, payload, matched secret, notes. Markdown."
                  className="textarea-sleek scrollbar-sleek w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-[12px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              )}
            </Field>
          </Step>

          <Step index={5}>
            <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[11.5px] text-muted-foreground">
              <dt>Target</dt>
              <dd className="min-w-0 break-words font-mono text-muted-foreground">{targetValue ?? 'none'}</dd>
              <dt>Recorded by</dt>
              <dd className="min-w-0 break-words">
                {finding.source === 'workflow' && finding.nodeId !== null
                  ? `workflow node ${finding.nodeId}`
                  : finding.source}
                {finding.executionId !== null && (
                  <span className="font-mono text-muted-foreground"> · run {finding.executionId.slice(0, 8)}</span>
                )}
              </dd>
              <dt>First seen</dt>
              <dd>{new Date(finding.createdAt).toLocaleString()}</dd>
              <dt>Last seen</dt>
              <dd>{new Date(finding.updatedAt).toLocaleString()}</dd>
              {finding.evidencePath !== null && (
                <>
                  <dt>Evidence</dt>
                  <dd className="break-all font-mono">{finding.evidencePath}</dd>
                </>
              )}
            </dl>
          </Step>
        </div>
      </ScrollArea>

      {fullScreen !== null && (
        <FullScreenField
          label={fullScreen === 'description' ? 'Description' : 'Details'}
          value={fullScreen === 'description' ? draft.description : draft.details}
          view={view}
          onChange={(value) => setDraft({ ...draft, [fullScreen]: value })}
          onClose={() => setFullScreen(null)}
        />
      )}
    </div>
  )
}
