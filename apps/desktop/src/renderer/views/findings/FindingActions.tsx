import type { JSX } from 'react'
import { Eye, Maximize2, Minimize2, PenLine, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { Spinner } from '../../components/ui/spinner.js'
import { IconAction } from './IconAction.js'
import type { ProseView } from './FindingProse.js'

const ICON = { className: 'size-3.5', strokeWidth: 2 } as const

/**
 * What can be done to the open finding: give it the page, flip the prose
 * between rendered and source, save the draft, delete it.
 */
export function FindingActions({
  expanded,
  view,
  dirty,
  saving,
  deleting,
  onToggleExpand,
  onToggleView,
  onSave,
  onDelete,
}: {
  expanded: boolean
  view: ProseView
  /** The draft differs from the stored finding, so there is something to save. */
  dirty: boolean
  saving: boolean
  deleting: boolean
  onToggleExpand: () => void
  onToggleView: () => void
  onSave: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <IconAction
        label={expanded ? 'Collapse finding' : 'Expand finding'}
        tooltip={expanded ? 'Collapse' : 'Expand'}
        aria-pressed={expanded}
        onClick={onToggleExpand}
      >
        {expanded ? <Minimize2 {...ICON} /> : <Maximize2 {...ICON} />}
      </IconAction>
      <IconAction
        label={view === 'preview' ? 'Edit description and details' : 'Preview description and details'}
        tooltip={view === 'preview' ? 'Edit' : 'Preview'}
        aria-pressed={view === 'edit'}
        onClick={onToggleView}
      >
        {view === 'preview' ? <PenLine {...ICON} /> : <Eye {...ICON} />}
      </IconAction>
      <IconAction
        label="Delete finding"
        tooltip="Delete finding"
        className="hover:text-status-error"
        disabled={deleting}
        onClick={onDelete}
      >
        {deleting ? <Spinner size="sm" /> : <Trash2 {...ICON} />}
      </IconAction>
      <Button size="sm" className="h-[30px] font-semibold" disabled={!dirty || saving} onClick={onSave}>
        {saving && <Spinner size="sm" />}
        Save
      </Button>
    </div>
  )
}
