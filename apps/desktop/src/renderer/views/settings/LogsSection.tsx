import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, FolderOpen, Download } from 'lucide-react'
import type { LogLevel, LogLine } from '@exe/protocol'
import type { SessionInfo } from '../../../main/logging/session-log.js'
import { Button } from '../../components/ui/button.js'
import { Select } from '../../components/ui/select.js'
import { Checkbox } from '../../components/ui/checkbox.js'
import { Switch } from '../../components/ui/switch.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { LEVEL_COLOR, LogList } from './LogList.js'
import { LogsExportDialog, type LogsExportOptions } from './LogsExportDialog.js'
import { PageHeading, Row } from './parts.js'

/** Lines pulled per read, so a 25 MB session file never crosses IPC whole. */
const READ_LIMIT = 2000
/** Lines kept in the view while tailing. */
const MAX_LINES = 5000
const POLL_MS = 1000
const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']

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

/** Logs: the app session log, live, with filters, verbose mode, copy and export. */
export function LogsSection(): JSX.Element {
  const log = window.executioner.log
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lines, setLines] = useState<LogLine[]>([])
  // True from picking a session (or mounting) until its first read settles.
  const [loadingLines, setLoadingLines] = useState(true)
  // Null until the session list arrives, so the picker can hold its place.
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
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
        // No session at all means there is nothing to read: stop the list loader too.
        if (cur == null && list.length === 0) setLoadingLines(false)
      })
      .catch((e: unknown) => live && setError((e as Error).message))
      .finally(() => live && setSessionsLoaded(true))
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
        .finally(() => live && initial && setLoadingLines(false))
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

  const doExport = (opts: LogsExportOptions): void => {
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
        {!sessionsLoaded ? (
          <Skeleton role="status" aria-label="Loading sessions" className="h-8 w-[320px] max-w-full rounded-full" />
        ) : (
          <Select
            ariaLabel="Session"
            value={selectedId ?? ''}
            onValueChange={(id) => {
              setLines([])
              setLoadingLines(true)
              setExpanded(new Set())
              setSelectedId(id)
            }}
            options={sessions.map((s) => ({ value: s.id, label: sessionLabel(s, s.id === currentId) }))}
            className="h-8 min-w-0 max-w-[320px] flex-1 text-[12.5px]"
          />
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {note !== null && <span className="text-[12px] text-muted-foreground">{note}</span>}
          <Button variant="glass" size="sm" onClick={copy}>
            <Copy className="size-4" strokeWidth={1.75} />
            Copy
          </Button>
          <Button variant="glass" size="sm" onClick={openFolder}>
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
          <label key={lvl} className="flex cursor-pointer items-center gap-1.5">
            <Checkbox
              aria-label={lvl}
              checked={levels.has(lvl)}
              onCheckedChange={() => setLevels((s) => toggle(s, lvl))}
            />
            <span className={LEVEL_COLOR[lvl]}>{lvl}</span>
          </label>
        ))}
        <span className="text-muted-foreground">|</span>
        {sources.map((src) => (
          <label key={src} className="flex cursor-pointer items-center gap-1.5">
            <Checkbox
              aria-label={src}
              checked={!hiddenSources.has(src)}
              onCheckedChange={() => setHiddenSources((s) => toggle(s, src))}
            />
            <span className="text-muted-foreground">{src}</span>
          </label>
        ))}
      </div>

      {readOnly && <p className="mt-2 text-[12px] text-muted-foreground">Viewing an earlier session. It is read-only.</p>}

      {error !== null ? (
        <p className="mt-3 text-[12px] text-status-error">{error}</p>
      ) : (
        <LogList
          listRef={listRef}
          onScroll={(el) => {
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
          loading={loadingLines}
          lines={lines}
          visible={visible}
          expanded={expanded}
          onToggle={(key) => setExpanded((prev) => toggle(prev, key))}
        />
      )}

      {exporting && <LogsExportDialog busy={exportBusy} onCancel={() => setExporting(false)} onExport={doExport} />}
    </div>
  )
}
