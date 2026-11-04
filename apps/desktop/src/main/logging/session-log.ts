import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { basename, join } from 'node:path'
import { formatLine, levelEnabled, parseLine } from '@exe/protocol'
import type { LogLine } from '@exe/protocol'

export interface SessionInfo {
  /** The file name without its extension. */
  id: string
  file: string
  /** ISO start time, taken from the file name. */
  startedAt: string
  pid: number
  /** The owning process is still running (this session, or another app instance). */
  live: boolean
  /** A marker is left behind and its process is gone: the session did not close cleanly. */
  crashed: boolean
}

export interface SessionLogOptions {
  dir: string
  pid?: number
  now?: Date
  isAlive?: (pid: number) => boolean
  /** After this many bytes, debug lines are dropped. */
  softCap?: number
  /** After this many bytes, nothing more is written. */
  hardCap?: number
  /** How many session files to retain, this one included. */
  keep?: number
  /** Where Electron's crash reporter drops dumps. Defaults to `<dir>/crashes`. */
  crashDir?: string
}

const DEFAULT_SOFT_CAP = 20 * 1024 * 1024
const DEFAULT_HARD_CAP = 25 * 1024 * 1024
const DEFAULT_KEEP = 10
const MARKER_SUFFIX = '.running'
const NAME = /^session-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2}\.\d{3})Z-(\d+)\.jsonl$/

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Session files carry their start time in the name, with `:` swapped for `-` so it is a legal file name everywhere. */
function fileName(startedAt: Date, pid: number): string {
  return `session-${startedAt.toISOString().replace(/:/g, '-')}-${pid}.jsonl`
}

function readMarkerPid(file: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(file + MARKER_SUFFIX, 'utf8').trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function tryRemove(file: string): void {
  try {
    unlinkSync(file)
  } catch {
    /* already gone or locked: retention is best effort */
  }
}

/** Every regular file under `root`, however deep. */
function walkFiles(root: string): string[] {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

/** How much of a file's end a limited read looks at. */
const TAIL_WINDOW = 4 * 1024 * 1024

/** The last `window` bytes of a file as text, cut at a line start; the whole file when it fits. */
function readTail(file: string, window: number): string {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    if (size <= window) return readFileSync(fd, 'utf8')
    const buf = Buffer.alloc(window)
    let got = 0
    while (got < window) {
      const n = readSync(fd, buf, got, window - got, size - window + got)
      if (n === 0) break
      got += n
    }
    const text = buf.subarray(0, got).toString('utf8')
    // The window starts mid-line (maybe mid-character): drop everything up to the first newline.
    const nl = text.indexOf('\n')
    return nl === -1 ? '' : text.slice(nl + 1)
  } finally {
    closeSync(fd)
  }
}

/**
 * Parsed lines of a session file (the last `limit` when given); lines that are not log lines are skipped.
 * With a limit only the last 4 MB are read, so a poll stays cheap on a big file; a limit larger than
 * that window's line count returns fewer lines than asked.
 */
export function readSession(file: string, limit?: number, window = TAIL_WINDOW): LogLine[] {
  let text: string
  try {
    text = limit !== undefined && limit >= 0 ? readTail(file, window) : readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const lines: LogLine[] = []
  for (const raw of text.split('\n')) {
    if (raw === '') continue
    const parsed = parseLine(raw)
    if (parsed !== null) lines.push(parsed)
  }
  return limit !== undefined && limit >= 0 ? lines.slice(Math.max(0, lines.length - limit)) : lines
}

/**
 * One JSONL file per app session, appended synchronously so nothing is lost
 * when the process dies. A `.running` marker beside it holds the pid and is
 * removed on a clean close; one left behind with a dead pid means a crash.
 */
export class SessionLog {
  readonly info: SessionInfo
  private fd: number | null
  private size = 0
  private capWarned = false

  private constructor(
    info: SessionInfo,
    fd: number,
    private readonly dir: string,
    private readonly isAlive: (pid: number) => boolean,
    private readonly softCap: number,
    private readonly hardCap: number,
  ) {
    this.info = info
    this.fd = fd
  }

  static open(opts: SessionLogOptions): SessionLog {
    const pid = opts.pid ?? process.pid
    const now = opts.now ?? new Date()
    const isAlive = opts.isAlive ?? pidAlive
    mkdirSync(opts.dir, { recursive: true })
    const name = fileName(now, pid)
    const file = join(opts.dir, name)
    const fd = openSync(file, 'a')
    const marker = file + MARKER_SUFFIX
    // The marker goes down before anything else is logged so a crash is never invisible.
    const markerFd = openSync(marker, 'w')
    writeSync(markerFd, String(pid))
    closeSync(markerFd)
    const info: SessionInfo = { id: name.replace(/\.jsonl$/, ''), file, startedAt: now.toISOString(), pid, live: true, crashed: false }
    const log = new SessionLog(info, fd, opts.dir, isAlive, opts.softCap ?? DEFAULT_SOFT_CAP, opts.hardCap ?? DEFAULT_HARD_CAP)
    try {
      log.size = statSync(file).size
    } catch {
      /* size stays 0 */
    }
    log.applyRetention(opts.keep ?? DEFAULT_KEEP, opts.crashDir ?? join(opts.dir, 'crashes'))
    return log
  }

  write(line: LogLine): void {
    if (this.fd === null || this.size >= this.hardCap) return
    if (this.size >= this.softCap) {
      if (!this.capWarned) {
        this.capWarned = true
        this.append({
          t: new Date().toISOString(),
          lvl: 'warn',
          src: 'main/logging',
          msg: 'Log size limit reached',
        })
      }
      if (!levelEnabled('warn', line.lvl)) return
    }
    this.append(line)
  }

  /** Close the file and remove the marker; the log itself stays. */
  close(): void {
    if (this.fd !== null) {
      try {
        closeSync(this.fd)
      } catch {
        /* nothing to do */
      }
      this.fd = null
    }
    tryRemove(this.info.file + MARKER_SUFFIX)
  }

  /** The most recent earlier session that ended without a clean close, if any. */
  previousCrashed(): SessionInfo | null {
    // Only the latest earlier session that is not still running counts, so one crash is reported once.
    const earlier = this.sessions().filter((s) => s.file !== this.info.file && !s.live)
    const last = earlier[earlier.length - 1]
    return last !== undefined && last.crashed ? last : null
  }

  /** Every session file in the folder, oldest first. */
  sessions(): SessionInfo[] {
    let names: string[]
    try {
      names = readdirSync(this.dir)
    } catch {
      return []
    }
    const out: SessionInfo[] = []
    for (const name of names.sort()) {
      const m = NAME.exec(name)
      if (m === null) continue
      const file = join(this.dir, name)
      const pid = Number.parseInt(m[5]!, 10)
      const startedAt = `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`
      const own = file === this.info.file
      const markerPid = readMarkerPid(file)
      const hasMarker = own ? this.fd !== null : markerPid !== null
      const alive = own ? this.fd !== null : markerPid !== null && this.isAlive(markerPid)
      out.push({ id: basename(name, '.jsonl'), file, startedAt, pid, live: alive, crashed: hasMarker && !alive })
    }
    return out
  }

  private append(line: LogLine): void {
    if (this.fd === null) return
    const text = `${formatLine(line)}\n`
    // A line that would cross the ceiling is dropped, so the file never exceeds it.
    if (this.size + Buffer.byteLength(text) > this.hardCap) {
      this.size = this.hardCap
      return
    }
    try {
      this.size += writeSync(this.fd, text)
    } catch {
      /* logging must never throw into the app */
    }
  }

  /**
   * Keep the newest `keep` sessions (this one counts) plus any that are live,
   * and drop crash dumps older than the oldest session that stays.
   */
  private applyRetention(keep: number, crashDir: string): void {
    const all = this.sessions()
    const newest = new Set(all.slice(Math.max(0, all.length - keep)).map((s) => s.file))
    const retained: SessionInfo[] = []
    for (const s of all) {
      if (newest.has(s.file) || s.live) {
        retained.push(s)
      } else {
        tryRemove(s.file)
        tryRemove(s.file + MARKER_SUFFIX)
      }
    }
    const oldest = retained[0]
    if (oldest === undefined || !existsSync(crashDir)) return
    const cutoff = Date.parse(oldest.startedAt)
    for (const dump of walkFiles(crashDir)) {
      // Crashpad's own bookkeeping (settings.dat, metadata) is not ours to delete.
      if (!dump.endsWith('.dmp')) continue
      try {
        if (statSync(dump).mtimeMs < cutoff) rmSync(dump, { force: true })
      } catch {
        /* best effort */
      }
    }
  }
}
