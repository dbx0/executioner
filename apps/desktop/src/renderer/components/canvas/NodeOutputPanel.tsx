import type { JSX } from 'react'
import { Spinner } from '../ui/spinner.js'
import { PanelSection, SectionTitle } from './surface.js'

/** Never lay out more than this in the pre: long tool output otherwise makes
 *  selecting the node janky. The reducer already caps live output at about 20KB;
 *  this is a defensive display cap and keeps only the most recent tail. */
const MAX_RENDER_CHARS = 12000

/**
 * A drawer section showing a node's full captured output. Renders a labelled
 * header and either a scrollable monospace block of the output, a spinner while
 * the node is running and has printed nothing yet, or a muted empty state.
 */
export function NodeOutputPanel({
  output,
  running = false,
}: {
  output: string | undefined
  /** The node is executing right now, so output is on its way. */
  running?: boolean
}): JSX.Element {
  const hasOutput = output !== undefined && output.trim() !== ''
  // Show the tail (newest output) and mark truncation.
  const shown =
    output !== undefined && output.length > MAX_RENDER_CHARS
      ? `…(${output.length - MAX_RENDER_CHARS} earlier chars hidden)\n` + output.slice(-MAX_RENDER_CHARS)
      : output

  return (
    <PanelSection className="gap-2">
      <SectionTitle className="flex items-center gap-2">
        Output
        {running && hasOutput && <Spinner size="xs" />}
      </SectionTitle>
      {hasOutput ? (
        // `whitespace-pre` + horizontal scroll instead of `break-all`: breaking
        // every character disables the browser's fast line-breaking path and
        // freezes on large output. Long lines scroll horizontally instead.
        <pre className="scrollbar-sleek max-h-64 overflow-auto whitespace-pre rounded-[12px] border border-glass-border bg-background p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
          {shown}
        </pre>
      ) : running ? (
        <div role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Spinner size="sm" />
          Waiting for output
        </div>
      ) : (
        <span className="text-[13px] text-muted-foreground">No output yet.</span>
      )}
    </PanelSection>
  )
}
