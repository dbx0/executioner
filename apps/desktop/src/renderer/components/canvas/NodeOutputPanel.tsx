import type { JSX } from 'react'
/**
 * A drawer section showing a node's full captured output. Renders a labelled
 * header and either a scrollable monospace block of the output or a muted empty
 * state when the node has produced nothing yet.
 */
/** Never lay out more than this in the pre — long tool output otherwise makes
 *  selecting the node janky. The reducer already caps live output ~20KB; this is
 *  a defensive display cap and keeps only the most recent tail. */
const MAX_RENDER_CHARS = 12000

export function NodeOutputPanel({ output }: { output: string | undefined }): JSX.Element {
  const hasOutput = output !== undefined && output.trim() !== ''
  // Show the tail (newest output) and mark truncation.
  const shown =
    output !== undefined && output.length > MAX_RENDER_CHARS
      ? `…(${output.length - MAX_RENDER_CHARS} earlier chars hidden)\n` + output.slice(-MAX_RENDER_CHARS)
      : output

  return (
    <div className="flex flex-col gap-2 border-t border-border p-4">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Output
      </span>
      {hasOutput ? (
        // `whitespace-pre` + horizontal scroll instead of `break-all`: breaking
        // every character disables the browser's fast line-breaking path and
        // freezes on large output. Long lines scroll horizontally instead.
        <pre className="max-h-64 overflow-auto scrollbar-sleek rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed whitespace-pre text-foreground">
          {shown}
        </pre>
      ) : (
        <span className="text-sm text-muted-foreground">No output yet.</span>
      )}
    </div>
  )
}
