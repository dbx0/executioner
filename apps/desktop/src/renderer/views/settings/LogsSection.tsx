import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, FolderOpen, Download } from 'lucide-react'
import type { LogLevel, LogLine } from '@exe/protocol'
import type { SessionInfo } from '../../../main/logging/session-log.js'
import { Button } from '../../components/ui/button.js'
import { Select } from '../../components/ui/select.js'
import { Checkbox } from '../../components/ui/checkbox.js'
import { Switch } from '../../components/ui/switch.js'
import { cn } from '../../lib/utils.js'
import { PageHeading, Row } from './parts.js'

/** Lines pulled per read, so a 25 MB session file never crosses IPC whole. */
const READ_LIMIT = 2000
/** Lines kept in the view while tailing. */
const MAX_LINES = 5000
const POLL_MS = 1000
const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: 'text-tertiary-foreground',
  info: 'text-muted-foreground',
  warn: 'text-status-warning',
  error: 'text-status-error',
}

/** The source family: `engine:a1b2/scheduler` and `engine:a1b2` are one filter entry. */
function sourceKey(src: string): string {
  const slash = src.indexOf('/')
  const base = slash === -1 ? src : src.slice(0, slash)
  return base
}

const sameLine = (a: LogLine, b: LogLine): boolean => a.t === b.t && a.msg === b.msg && a.src === b.src

/** Append what `next` (the latest tail read) has beyond `prev`, matching on the last known line. */
export function mergeTail(prev: LogLine[], next: LogLine[]): LogLine[] {
  if (prev.length === 0) return next
  const last = prev[prev.length - 1]!
  for (let i = next.length - 1; i >= 0; i--) {
    if (sameLine(next[i]!, last)) {
      const fresh = next.slice(i + 1)
      if (fresh.length === 0) return prev
      const merged = [...prev, ...fresh]
      return merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged
    }
  }
  // More than a window of new lines arrived between polls: take the fresh window.
  return next
}

function formatLine(l: LogLine): string {
  return `${l.t} ${l.lvl.toUpperCase().padEnd(5)} ${l.src} ${l.msg}${l.data !== undefined ? ` ${JSON.stringify(l.data)}` : ''}`
}

function sessionLabel(s: SessionInfo, current: boolean): string {
  const when = new Date(s.startedAt).toLocaleString()
  return `${when}${current ? ' (this session)' : ''}${s.crashed ? ' (closed unexpectedly)' : ''}`
}

function ExportDialog({
  onExport,
  onCancel,
  busy,
}: {
  onExport: (opts: { includeTargets: boolean; includeAllSessions: boolean }) => void
  onCancel: () => void
  busy: boolean
}): JSX.Element {
  const [includeTargets, setIncludeTargets] = useState(false)
  const [includeAllSessions, setIncludeAllSessions] = useState(false)
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6" onClick={onCancel}>
      <div
        role="dialog"
        aria-label="Export logs for a bug report"
        className="flex w-[440px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3 text-[14px] font-medium">Export logs for a bug report</div>
        <div className="flex flex-col gap-3 px-4 py-4 text-[13px]">
          <p className="text-muted-foreground">
            Saves a zip you can attach to a bug report. Secrets are always masked. Targets, prompts and tool output are
            left out unless you include them.
          </p>
          <div>
            <label className="flex items-center gap-2">
              <Checkbox checked={includeTargets} onChange={(e) => setIncludeTargets(e.target.checked)} />
              Include target details
            </label>
            <p className="ml-6 mt-1 text-xs text-muted-foreground">
              Also includes crash dumps, which can contain unscrubbed data. Only send this privately.
            </p>
          </div>
          <label className="flex items-center gap-2">
            <Checkbox checked={includeAllSessions} onChange={(e) => setIncludeAllSessions(e.target.checked)} />
            Include all recent sessions
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onExport({ includeTargets, includeAllSessions })}>
            Export
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Logs: the app session log, live, with filters, verbose mode, copy and export. */
export function LogsSection(): JSX.Element {
  const log = window.executioner.log
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lines, setLines] = useState<LogLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [verbose, setVerbose] = useState(false)
  const [levels, setLevels] = useState<Set<LogLevel>>(new Set(LEVELS))
  const [hiddenSources, setHiddenSources] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  // Sessions, the current one, and the verbose switch.
  useEffect(() => {
    let live = true
    void Promise.all([log.sessions(), log.currentSession()])
      .then(([list, cur]) => {
        if (!live) return
        setSessions(list)
        setCurrentId(cur?.id ?? null)
        setSelectedId((s) => s ?? cur?.id ?? list[list.length - 1]?.id ?? null)
      })
      .catch((e: unknown) => live && setError((e as Error).message))
    void log
      .getVerbose()
      .then((v) => live && setVerbose(v))
      .catch(() => undefined)
    const off = log.onLevel((l) => setVerbose(l === 'debug'))
    return () => {
      live = false
      off()
    }
  }, [log])

  // Load the selected session; tail it only when it is the current one.
  useEffect(() => {
    if (selectedId === null) return
    let live = true
    stickRef.current = true
    const load = (initial: boolean): void => {
      void log
        .read({ id: selectedId, limit: READ_LIMIT })
        .then((next) => {
          if (!live) return
          setError(null)
          setLines((prev) => (initial ? next : mergeTail(prev, next)))
        })
        .catch((e: unknown) => live && setError((e as Error).message))
    }
    load(true)
    if (selectedId !== currentId) return () => void (live = false)
    const timer = setInterval(() => load(false), POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [log, selectedId, currentId])

  const sources = useMemo(() => {
    const set = new Set<string>(['main', 'renderer'])
    for (const l of lines) set.add(sourceKey(l.src))
    return [...set].sort()
  }, [lines])

  const visible = useMemo(
    () => lines.filter((l) => levels.has(l.lvl) && !hiddenSources.has(sourceKey(l.src))),
    [lines, levels, hiddenSources],
  )

  // Follow the tail unless the reader scrolled up.
  useEffect(() => {
    const el = listRef.current
    if (el !== null && stickRef.current) el.scrollTop = el.scrollHeight
  }, [visible])

  const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    return next
  }

  const onVerbose = (on: boolean): void => {
    setVerbose(on)
    void log.setVerbose(on).catch(() => setVerbose(!on))
  }

  const flash = (msg: string): void => {
    setNote(msg)
    setTimeout(() => setNote(null), 2500)
  }

  const copy = (): void => {
    void window.executioner
      .clipboardWrite(visible.map(formatLine).join('\n'))
      .then(() => flash('Copied'))
      .catch(() => flash('Could not copy'))
  }

  const openFolder = (): void => {
    void log
      .openFolder()
      .then((err) => err !== '' && flash(err))
      .catch(() => undefined)
  }

  const doExport = (opts: { includeTargets: boolean; includeAllSessions: boolean }): void => {
    setExportBusy(true)
    void log
      .exportLogs({
        includeAllSessions: opts.includeAllSessions,
        includeTargets: opts.includeTargets,
      })
      .then((res) => {
        setExporting(false)
        if ('saved' in res) flash(`Saved ${res.saved}`)
      })
      .catch(() => {
        setExporting(false)
        flash('Export failed')
      })
      .finally(() => setExportBusy(false))
  }

  const readOnly = selectedId !== null && selectedId !== currentId

  return (
    <div className="flex h-full flex-col">
      <PageHeading title="Logs" description="What Executioner did this session, for troubleshooting and bug reports." />

      <Row
        label="Verbose logging"
        description="Records more detail, such as requests and workflow steps. Use it while reproducing a problem."
      >
        <Switch checked={verbose} onCheckedChange={onVerbose} aria-label="Verbose logging" />
      </Row>
      {verbose && (
        <p className="mt-2 text-[12.5px] text-status-warning">
          Verbose logging is on. Turn it off when you are done reproducing the problem.
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Select
          ariaLabel="Session"
          value={selectedId ?? ''}
          onValueChange={(id) => {
            setLines([])
            setExpanded(new Set())
            setSelectedId(id)
          }}
          options={sessions.map((s) => ({ value: s.id, label: sessionLabel(s, s.id === currentId) }))}
          className="h-8 min-w-0 max-w-[320px] flex-1 text-[12.5px]"
        />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {note !== null && <span className="text-[12px] text-muted-foreground">{note}</span>}
          <Button variant="outline" size="sm" onClick={copy}>
            <Copy className="size-4" strokeWidth={1.75} />
            Copy
          </Button>
          <Button variant="outline" size="sm" onClick={openFolder}>
            <FolderOpen className="size-4" strokeWidth={1.75} />
            Open logs folder
          </Button>
          <Button size="sm" onClick={() => setExporting(true)}>
            <Download className="size-4" strokeWidth={1.75} />
            Export
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        {LEVELS.map((lvl) => (
          <label key={lvl} className="flex items-center gap-1.5">
            <Checkbox
              aria-label={lvl}
              checked={levels.has(lvl)}
              onChange={() => setLevels((s) => toggle(s, lvl))}
            />
            <span className={LEVEL_COLOR[lvl]}>{lvl}</span>
          </label>
        ))}
        <span className="text-muted-foreground">|</span>
        {sources.map((src) => (
          <label key={src} className="flex items-center gap-1.5">
            <Checkbox
              aria-label={src}
              checked={!hiddenSources.has(src)}
              onChange={() => setHiddenSources((s) => toggle(s, src))}
            />
            <span className="text-muted-foreground">{src}</span>
          </label>
        ))}
      </div>

      {readOnly && <p className="mt-2 text-[12px] text-muted-foreground">Viewing an earlier session. It is read-only.</p>}

      {error !== null ? (
        <p className="mt-3 text-[12px] text-status-error">{error}</p>
      ) : (
        <div
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
          className="mt-3 min-h-0 flex-1 overflow-auto scrollbar-sleek rounded-lg border border-border bg-surface-1 p-2 font-mono text-[12px] leading-relaxed"
        >
          {visible.length === 0 ? (
            <span className="text-muted-foreground">No log lines match.</span>
          ) : (
            visible.map((l, i) => {
              const key = lines.indexOf(l)
              const open = expanded.has(key)
              const hasData = l.data !== undefined
              return (
                <div key={key} className="border-b border-border/40 last:border-0">
                  <div
                    role={hasData ? 'button' : undefined}
                    tabIndex={hasData ? 0 : undefined}
                    onClick={hasData ? () => setExpanded((s) => toggle(s, key)) : undefined}
                    onKeyDown={
                      hasData
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') setExpanded((s) => toggle(s, key))
                          }
                        : undefined
                    }
                    className={cn('flex gap-2 px-1 py-0.5', hasData && 'cursor-pointer hover:bg-surface-2')}
                    data-index={i}
                  >
                    <span className="shrink-0 text-tertiary-foreground">{l.t.slice(11, 23)}</span>
                    <span className={cn('w-10 shrink-0 uppercase', LEVEL_COLOR[l.lvl])}>{l.lvl}</span>
                    <span className="w-28 shrink-0 truncate text-muted-foreground" title={l.src}>
                      {l.src}
                    </span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{l.msg}</span>
                  </div>
                  {open && hasData && (
                    <pre className="mb-1 ml-6 overflow-auto rounded bg-surface-2 p-2 text-[11.5px]">
                      {JSON.stringify(l.data, null, 2)}
                    </pre>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {exporting && <ExportDialog busy={exportBusy} onCancel={() => setExporting(false)} onExport={doExport} />}
    </div>
  )
}
