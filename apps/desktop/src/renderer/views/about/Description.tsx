import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { MarkdownRender } from '../../components/markdown/MarkdownRender.js'

/** How much of the program description stands above the fold. The height is
 *  approximate on purpose: what decides whether the "Show more" control appears
 *  is a measurement of the rendered box, not this number. */
const DESCRIPTION_LINES = 15
const DESCRIPTION_LINE_PX = 24

/**
 * The program's own words, held to `DESCRIPTION_LINES` until asked. A pasted
 * program brief can run for pages, and the identity card is a header: it should
 * not push the numbers below the fold before anyone has read one.
 */
export function Description({ text }: { text: string }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [clipped, setClipped] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Only the collapsed box is worth measuring: once it is open, scrollHeight and
  // clientHeight agree by definition, so the verdict is kept rather than retaken
  // (which would take the collapse control away with it).
  useEffect(() => {
    if (expanded) return
    const el = ref.current
    if (el === null) return
    const measure = (): void => setClipped(el.scrollHeight - el.clientHeight > 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, expanded])

  const empty = text === ''
  return (
    <div className="mt-3 border-t border-glass-border pt-3">
      <div
        ref={ref}
        data-description
        // The clamp is a computed pixel height, which no utility class can carry.
        style={expanded ? undefined : { maxHeight: DESCRIPTION_LINES * DESCRIPTION_LINE_PX }}
        className={cn('text-[13px] leading-relaxed', empty && 'text-muted-foreground', !expanded && 'overflow-hidden')}
      >
        {empty ? (
          'No program description yet. It lives under “## Program” in HUNT.md, where the New engagement modal writes it, and you can edit that file directly.'
        ) : (
          // The agent writes this section as Markdown, so it is rendered as
          // Markdown: bullets of rules of engagement should read as bullets.
          <MarkdownRender source={text} className="max-w-none" />
        )}
      </div>
      {(clipped || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 flex items-center gap-1 rounded-control text-[11.5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} strokeWidth={2} />
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
