import type { JSX } from 'react'
import { AlertCircle, Ban, Check, CircleDashed, Clock, Loader2, X } from 'lucide-react'
import type { NodeOutputRow } from '../../api/executions.js'
import { cn } from '../../lib/utils.js'
import { safeRow } from './row.js'
import { summarizeParsed } from './ParsedView.js'

/** How much of a stream the preview will look at. A tool's output runs to
 *  megabytes and this only ever shows one line of it, so never walk past this. */
const PREVIEW_SCAN = 4096

/** The first non-empty line, which is the useful glance at what a node produced.
 *  Scans a bounded head of the stream rather than splitting the whole thing:
 *  these cards re-render once per event frame while a run streams, and
 *  `split('\n')` over a multi-megabyte stdout on each of them is what turns a
 *  click during a run into a frozen window. */
function firstLine(text: string): string {
  const head = text.length > PREVIEW_SCAN ? text.slice(0, PREVIEW_SCAN) : text
  let from = 0
  while (from < head.length) {
    const nl = head.indexOf('\n', from)
    const end = nl === -1 ? head.length : nl
    const t = head.slice(from, end).trim()
    if (t !== '') return t
    if (nl === -1) break
    from = nl + 1
  }
  return ''
}

/** What the node produced, at a glance. Built-ins emit rows rather than bytes,
 *  so a row count is the honest summary for them. */
function volume(row: { stdout: string; stderr: string; parsedCount: number }): string {
  const n = row.stdout.length + row.stderr.length
  if (n === 0 && row.parsedCount > 0) return `${String(row.parsedCount)} row${row.parsedCount === 1 ? '' : 's'}`
  if (n === 0) return 'no output'
  if (n < 1024) return `${String(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const ICONS: Record<string, typeof Check> = {
  succeeded: Check,
  failed: X,
  timeout: Clock,
  running: Loader2,
  // A node the user stopped: neither a tick nor a cross.
  cancelled: Ban,
}

function statusTone(status: string): string {
  if (status === 'succeeded') return 'text-status-success'
  if (status === 'failed') return 'text-status-error'
  if (status === 'timeout') return 'text-attention'
  return 'text-muted-foreground'
}

/**
 * One card per node of a run, stacked one below another like a notification
 * list. The preview leads with stderr when a node failed — that is where the
 * reason lives — and every node gets a card even when it produced nothing,
 * because a node that vanishes from the list is exactly how a silent failure
 * hides.
 */
export function NodeOutputCards({
  rows,
  onOpen,
}: {
  rows: NodeOutputRow[]
  onOpen: (row: NodeOutputRow) => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2.5 p-4">
      {rows.map((raw) => {
        const row = safeRow(raw)
        const failed = row.status === 'failed' || row.status === 'timeout'
        // Each branch scans a bounded head, so nothing here walks a whole
        // stream — `stdout.trim() !== ''` used to copy the entire thing.
        const stderrLine = failed ? firstLine(row.stderr) : ''
        const stdoutLine = stderrLine === '' ? firstLine(row.stdout) : ''
        const preview =
          stderrLine !== '' ? stderrLine : stdoutLine !== '' ? stdoutLine : summarizeParsed(row.parsedValue)
        const Icon = ICONS[row.status] ?? CircleDashed
        // "Empty" only if there is no parsed result either — a built-in node's
        // rows ARE its output, and calling that nothing is what hid screenshot.
        const empty = row.stdout.length + row.stderr.length + row.parsedCount === 0
        // An engine older than the exitCode field omits it entirely. Missing is
        // "unknown" and must stay silent; an explicit null is "never started".
        const exit = row.exitCode ?? undefined
        const neverStarted = row.exitCode === null && failed
        return (
          <button
            key={row.nodeId}
            type="button"
            onClick={() => onOpen(raw)}
            title={`${row.nodeId} — click for full output`}
            className={cn(
              'flex w-full min-w-0 items-start gap-3 rounded-xl border px-4 py-3 text-left shadow-sm transition-colors',
              'border-border bg-surface-1',
              'hover:bg-surface-2',
              failed && 'border-status-error/40',
            )}
          >
            <Icon
              className={cn(
                'mt-0.5 size-4 shrink-0',
                statusTone(row.status),
                row.status === 'running' && 'animate-spin',
              )}
              strokeWidth={2}
            />

            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate font-mono text-[13px] font-medium">{row.nodeId}</span>
                {exit !== undefined && exit !== 0 && (
                  <span className="shrink-0 rounded bg-status-error/15 px-1 font-mono text-[10.5px] text-status-error">
                    exit {exit}
                  </span>
                )}
                {neverStarted && (
                  <span
                    className="shrink-0 rounded bg-status-error/15 px-1 font-mono text-[10.5px] text-status-error"
                    title="No exit code: the process never started"
                  >
                    no exit
                  </span>
                )}
                {/* Pushed right like a notification's timestamp. */}
                <span className="ml-auto shrink-0 text-[10.5px] uppercase tracking-wide text-muted-foreground">
                  {volume(row)}
                </span>
              </div>

              {preview === '' ? (
                <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
                  {empty && failed && <AlertCircle className="size-3 shrink-0" strokeWidth={1.75} />}
                  {empty && failed ? 'Failed with no output' : 'No output'}
                </span>
              ) : (
                <span
                  className={cn(
                    'line-clamp-2 break-all font-mono text-[11.5px]',
                    failed ? 'text-status-error/90' : 'text-muted-foreground',
                  )}
                >
                  {preview}
                </span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
