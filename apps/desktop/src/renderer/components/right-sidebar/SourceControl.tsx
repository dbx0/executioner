import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { friendlyError } from '../../lib/api-error.js'
import { GitBranch, RotateCw } from 'lucide-react'
import { useApp } from '../../store.js'
import { gitApi, type GitStatus, type GitLog, type GitFile } from '../../api/git.js'
import { cn } from '../../lib/utils.js'
import { Button } from '../ui/button.js'
import { ScrollArea } from '../ui/scroll-area.js'

/** Prefer the worktree status char, fall back to the index char; blank = unmodified. */
function statusChar(file: GitFile): string {
  const y = file.y.trim()
  const x = file.x.trim()
  const c = y !== '' ? y : x
  return c === '?' ? 'U' : c === '' ? 'M' : c
}

function statusColor(c: string): string {
  if (c === 'A' || c === 'U') return 'text-[color:var(--status-success)]'
  if (c === 'D') return 'text-[color:var(--status-error)]'
  return 'text-muted-foreground'
}

function splitPath(path: string): { dir: string; base: string } {
  const idx = path.lastIndexOf('/')
  if (idx === -1) return { dir: '', base: path }
  return { dir: path.slice(0, idx + 1), base: path.slice(idx + 1) }
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="px-1 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

function DiffPreview({ diff }: { diff: string }): JSX.Element {
  const lines = diff.split('\n')
  return (
    <ScrollArea className="h-full min-h-0 flex-1 px-2 py-1.5">
      <pre className="font-mono text-[11px] leading-[1.5]">
        {lines.map((line, i) => {
          let cls = ''
          if (line.startsWith('@@')) cls = 'text-muted-foreground'
          else if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-[color:var(--status-success)]'
          else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-[color:var(--status-error)]'
          return (
            <div key={i} className={cn('whitespace-pre-wrap break-all', cls)}>
              {line === '' ? ' ' : line}
            </div>
          )
        })}
      </pre>
    </ScrollArea>
  )
}

export function SourceControl(): JSX.Element {
  const client = useApp((s) => s.client)
  const activeRoot = useApp((s) => s.activeRoot)
  const api = useMemo(() => (client === null ? null : gitApi(client)), [client])

  const [status, setStatus] = useState<GitStatus | null>(null)
  const [log, setLog] = useState<GitLog | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [diffLoading, setDiffLoading] = useState(false)

  useEffect(() => {
    if (api === null) {
      setStatus(null)
      setLog(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const [s, l] = await Promise.all([api.status(), api.log(30)])
        if (cancelled) return
        setStatus(s)
        setLog(l)
      } catch (e) {
        if (cancelled) return
        setError(friendlyError(e, 'Couldn’t load source control.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // Refetch on client / root change and on manual refresh.

  }, [api, activeRoot, nonce])

  // Reset the selected diff whenever the engagement changes.
  useEffect(() => {
    setSelectedPath(null)
    setDiff('')
  }, [activeRoot])

  useEffect(() => {
    if (api === null || selectedPath === null) return
    let cancelled = false
    setDiffLoading(true)
    void (async () => {
      try {
        const d = await api.diff(selectedPath)
        if (!cancelled) setDiff(d.diff)
      } catch {
        if (!cancelled) setDiff('')
      } finally {
        if (!cancelled) setDiffLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api, selectedPath])

  const header = (
    <div className="flex h-9 shrink-0 items-center justify-between px-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Source Control
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground"
        disabled={api === null || loading}
        onClick={() => setNonce((n) => n + 1)}
        aria-label="Refresh"
      >
        <RotateCw className={cn('size-4', loading && 'animate-spin')} strokeWidth={1.75} />
      </Button>
    </div>
  )

  if (client === null) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <div className="flex flex-1 items-center justify-center px-4 text-[12px] text-muted-foreground">
          Open an engagement
        </div>
      </div>
    )
  }

  if (status !== null && status.isRepo === false) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <div className="flex flex-1 items-center justify-center px-4 text-[12px] text-muted-foreground">
          Not a git repository
        </div>
      </div>
    )
  }

  const files = status?.files ?? []
  const commits = log?.commits ?? []

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}

      {status !== null && (
        <div className="flex items-center gap-1.5 px-2.5 pb-1 text-[12px] text-muted-foreground">
          <GitBranch className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{status.branch ?? 'detached'}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1 px-2 pb-2">
          {error !== null && (
            <p className="px-1 py-1 text-[12px] text-muted-foreground">{error}</p>
          )}
          {loading && status === null && (
            <p className="px-1 py-1 text-[12px] text-muted-foreground">Loading…</p>
          )}

          <div className="flex items-center gap-2">
            <SectionLabel>Changes</SectionLabel>
            {files.length > 0 && (
              <span className="mt-1 rounded-full bg-secondary px-1.5 text-[10px] tabular-nums text-muted-foreground">
                {files.length}
              </span>
            )}
          </div>

          {files.length === 0 ? (
            <p className="px-1 py-1 text-[12px] text-muted-foreground">No changes</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {files.map((f) => {
                const c = statusChar(f)
                const { dir, base } = splitPath(f.path)
                const selected = selectedPath === f.path
                return (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => setSelectedPath(f.path)}
                    className={cn(
                      'group flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] transition-colors',
                      selected
                        ? 'selected-surface text-sidebar-accent-foreground'
                        : 'text-muted-foreground hover:bg-surface-2',
                    )}
                    title={f.path}
                  >
                    <span
                      className={cn(
                        'w-3 shrink-0 text-center font-mono text-[11px] font-semibold',
                        statusColor(c),
                      )}
                    >
                      {c}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {dir !== '' && <span className="text-muted-foreground">{dir}</span>}
                      <span className="font-medium">{base}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          <SectionLabel>History</SectionLabel>
          {commits.length === 0 ? (
            <p className="px-1 py-1 text-[12px] text-muted-foreground">No history</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {commits.map((c) => (
                <div
                  key={c.hash}
                  className="flex h-7 items-center gap-2 rounded-md px-2 text-[12.5px] text-muted-foreground"
                  title={`${c.subject} — ${c.author}`}
                >
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.shortHash}</span>
                  <span className="min-w-0 flex-1 truncate">{c.subject}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{shortDate(c.date)}</span>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {selectedPath !== null && (
          <div className="flex h-[40%] min-h-0 shrink-0 flex-col border-t border-border">
            <div className="flex h-7 shrink-0 items-center gap-2 px-2.5 text-[11px] text-muted-foreground">
              <span className="min-w-0 flex-1 truncate font-mono">{selectedPath}</span>
              <button
                type="button"
                onClick={() => setSelectedPath(null)}
                className="shrink-0 hover:text-foreground"
                aria-label="Close diff"
              >
                Close
              </button>
            </div>
            {diffLoading ? (
              <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground">
                Loading…
              </div>
            ) : diff === '' ? (
              <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground">
                No diff
              </div>
            ) : (
              <DiffPreview diff={diff} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
