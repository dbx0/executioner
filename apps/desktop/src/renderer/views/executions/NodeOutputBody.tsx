import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { cn } from '../../lib/utils.js'
import { formatParsed, type SafeRow } from './row.js'
import { ParsedView } from './ParsedView.js'

export type Stream = 'stdout' | 'stderr' | 'parsed'

/** How many characters of a stream are actually put in the DOM. A tool can emit
 *  tens of megabytes, and laying that out as one wrapped <pre> blocks the frame
 *  for seconds — the click that opened this view is what gets blamed for it.
 *  The head and the tail are what anyone reads, so show both and say what was
 *  left out. Copy still copies everything. */
const RENDER_LIMIT = 200_000

/** Does this stream hold anything but whitespace? Tests in place — `.trim()`
 *  copies the whole stream just to compare it against ''. */
function hasContent(text: string): boolean {
  return /\S/.test(text)
}

/** Split an oversized stream into the head and tail that get rendered. */
function clip(text: string): { head: string; tail: string; hidden: number } {
  if (text.length <= RENDER_LIMIT) return { head: text, tail: '', hidden: 0 }
  const half = RENDER_LIMIT / 2
  return { head: text.slice(0, half), tail: text.slice(text.length - half), hidden: text.length - RENDER_LIMIT }
}

/** Did this node fail, so its stderr is the first thing worth reading? */
export function isFailed(row: SafeRow): boolean {
  return row.status === 'failed' || row.status === 'timeout'
}

/**
 * The tab a node's output opens on. stderr explains a failure. Otherwise a
 * workflow node opens on stdout unless it only has parsed rows (a built-in);
 * `preferParsed` opens on the rows whenever there are any, for a view whose
 * point is the parsed result.
 */
export function initialStream(row: SafeRow, parsedText: string, preferParsed = false): Stream {
  if (isFailed(row) && hasContent(row.stderr)) return 'stderr'
  if (parsedText !== '' && (preferParsed || !hasContent(row.stdout))) return 'parsed'
  return 'stdout'
}

/**
 * One node's output as tabs: stdout, stderr and the parsed rows as a table,
 * with raw JSON and copy one click away. Shared by the workflow run dialog and
 * the Tools page, so a tool's result reads the same wherever it ran.
 */
export function NodeOutputBody({
  row,
  preferParsed = false,
  subject = 'node',
  className,
}: {
  row: SafeRow
  /** Open on the parsed rows whenever there are any. */
  preferParsed?: boolean
  /** What the empty-state copy calls the thing that ran. */
  subject?: 'node' | 'run'
  className?: string
}): JSX.Element {
  // Only this view ever shows the parsed rows as JSON, so they are stringified
  // here rather than for every card on every render.
  const parsedText = useMemo(() => formatParsed(row.parsedValue), [row.parsedValue])
  const failed = isFailed(row)
  const [tab, setTab] = useState<Stream>(() => initialStream(row, parsedText, preferParsed))
  const [copied, setCopied] = useState(false)
  // The table is the point, but raw JSON stays one click away for copying.
  const [showRaw, setShowRaw] = useState(false)
  const text = tab === 'stdout' ? row.stdout : tab === 'stderr' ? row.stderr : parsedText
  const shown = useMemo(() => clip(text), [text])

  const copy = (): void => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => undefined)
  }

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="flex items-center gap-1 border-b border-border px-[var(--output-gutter,1.25rem)] py-2.5">
        <div className="inline-flex rounded-md border border-border p-0.5" role="tablist">
          {(['stdout', 'stderr', 'parsed'] as Stream[]).map((s) => {
            const len = s === 'stdout' ? row.stdout.length : s === 'stderr' ? row.stderr.length : row.parsedCount
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={tab === s}
                onClick={() => setTab(s)}
                className={cn(
                  'rounded px-2.5 py-1 font-mono text-[12px] transition-colors',
                  tab === s ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
                  s === 'stderr' && len > 0 && tab !== s && 'text-attention',
                )}
              >
                {s}
                {len > 0 && <span className="ml-1.5 text-[10.5px] opacity-60">{len}</span>}
              </button>
            )
          })}
        </div>
        {tab === 'parsed' && parsedText !== '' && (
          <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setShowRaw((r) => !r)}>
            {showRaw ? 'Table' : 'Raw JSON'}
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          className={cn(tab === 'parsed' && parsedText !== '' ? '' : 'ml-auto')}
          disabled={text === ''}
          onClick={copy}
        >
          <Copy className="size-3.5" strokeWidth={1.75} />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek bg-card px-[var(--output-gutter,1.25rem)] py-4">
        {!hasContent(text) ? (
          <p className="text-[13px] text-muted-foreground">
            {failed && tab === 'stderr'
              ? `This ${subject} failed without writing anything to stderr.`
              : tab === 'parsed'
                ? `This ${subject} parsed no rows.`
                : `Nothing was written to ${tab}.`}
          </p>
        ) : tab === 'parsed' && !showRaw ? (
          <ParsedView value={row.parsedValue} />
        ) : (
          <>
            <pre
              className={cn(
                'whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed',
                tab === 'stderr' ? 'text-attention' : 'text-foreground',
              )}
            >
              {shown.head}
            </pre>
            {shown.hidden > 0 && (
              <>
                <p className="my-3 rounded border border-border bg-surface-1 px-3 py-2 text-[12px] text-muted-foreground">
                  {(shown.hidden / 1024 / 1024).toFixed(1)} MB not shown. This is the first and last{' '}
                  {String(RENDER_LIMIT / 2 / 1024)} KB. Copy takes the whole stream.
                </p>
                <pre
                  className={cn(
                    'whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed',
                    tab === 'stderr' ? 'text-attention' : 'text-foreground',
                  )}
                >
                  {shown.tail}
                </pre>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
