import type { JSX } from 'react'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { MarkdownRender } from '../../components/markdown/MarkdownRender.js'
import { ScrollArea } from '../../components/ui/scroll-area.js'
import { cn } from '../../lib/utils.js'
import { FIELD_LABEL_CLASS } from './field.js'
import { IconAction } from './IconAction.js'
import { PROSE_TEXTAREA_CLASS, type ProseView } from './FindingProse.js'

/**
 * One prose field in a floating modal over the app. Details on a real finding
 * run to a full write-up that the pane can only show a slice of at a time; this
 * is the view for reading (or writing) the whole of it. Escape or a click on the
 * backdrop closes it.
 */
export function FindingFullScreenField({
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
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="flex h-[82vh] w-[920px] max-w-[94vw] flex-col overflow-hidden rounded-panel border border-glass-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-glass-border pl-5 pr-2">
          <span className={FIELD_LABEL_CLASS}>{label}</span>
          <IconAction label="Close full screen" tooltip="Close" className="ml-auto" onClick={onClose}>
            <X className="size-4" strokeWidth={1.75} />
          </IconAction>
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
              className={cn(PROSE_TEXTAREA_CLASS, 'h-full resize-none')}
            />
          </div>
        )}
      </div>
    </div>
  )
}
