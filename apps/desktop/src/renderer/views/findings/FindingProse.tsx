import type { JSX } from 'react'
import { Fullscreen } from 'lucide-react'
import { MarkdownRender } from '../../components/markdown/MarkdownRender.js'
import { ScrollArea } from '../../components/ui/scroll-area.js'
import { cn } from '../../lib/utils.js'
import { Field } from './field.js'
import { IconAction } from './IconAction.js'

/** How the prose fields are shown: rendered markdown, or the raw source. */
export type ProseView = 'preview' | 'edit'

/** The markdown source editor: an ink card, the same black surface a code block or terminal sits on. */
export const PROSE_TEXTAREA_CLASS = cn(
  'textarea-sleek scrollbar-sleek w-full rounded-[14px] border border-glass-border bg-background px-[18px] py-4 font-mono text-[12px] leading-[1.7] outline-none',
  'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
)

/**
 * A prose field in preview: the markdown as an agent wrote it, set straight on
 * the card like body text in a document, with no box of its own. Findings are
 * filed as markdown (fenced requests, tables of parameters), so the raw source
 * is the wrong default for a pane whose main job is reading a finding.
 *
 * `cap` bounds the field at roughly the height of the textarea it replaces and
 * scrolls past it. A finding whose details run to a full exploit write-up would
 * otherwise push the metadata so far down the pane that reading one means
 * scrolling past all of it.
 */
function Rendered({ source, cap }: { source: string; cap: string }): JSX.Element {
  if (source.trim() === '') return <p className="text-sm italic text-muted-foreground">Nothing recorded.</p>
  return (
    <ScrollArea className={cn('min-w-0 overflow-x-hidden', cap)}>
      <MarkdownRender source={source} className="text-sm leading-[1.6]" />
    </ScrollArea>
  )
}

/**
 * One markdown field of a finding (the description, or the evidence in
 * details): rendered in preview, a source textarea in edit, with the button
 * that lifts it into the full-screen reader.
 */
export function FindingProseField({
  label,
  value,
  view,
  cap,
  rows,
  placeholder,
  onChange,
  onFullScreen,
}: {
  label: string
  value: string
  view: ProseView
  /** Max-height class for the rendered view. */
  cap: string
  /** Initial height of the editor, in text rows. */
  rows: number
  placeholder: string
  onChange: (value: string) => void
  onFullScreen: () => void
}): JSX.Element {
  return (
    <Field
      label={label}
      action={
        <IconAction
          size="icon-xs"
          label={`Open ${label.toLowerCase()} full screen`}
          tooltip="Full screen"
          className="-my-1 size-6 bg-transparent shadow-none"
          onClick={onFullScreen}
        >
          <Fullscreen className="size-3.5" strokeWidth={1.75} />
        </IconAction>
      }
    >
      {view === 'preview' ? (
        <Rendered source={value} cap={cap} />
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          aria-label={label}
          placeholder={placeholder}
          className={cn(PROSE_TEXTAREA_CLASS, 'resize-y')}
        />
      )}
    </Field>
  )
}
