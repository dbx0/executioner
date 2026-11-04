import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { formatLine, Scrubber, type LogLine } from '@exe/protocol'
import { readSession, type SessionInfo } from './session-log.js'

export interface ExportRequest {
  includeAllSessions: boolean
  includeTargets: boolean
  sessionId?: string
}

export interface ExportHeader {
  version: string
  os: string
  osVersion: string
  arch: string
  installKind: string
  electron: string
  node: string
  verbose: boolean
  openEngagements: number
  previousCrashed: boolean
}

export interface ExportOptions {
  /** Every session file, oldest first. */
  sessions: SessionInfo[]
  current: SessionInfo
  /** A session picked on the Logs page: it and the one before it are exported. */
  selected?: string
  includeAllSessions: boolean
  includeTargets: boolean
  header: ExportHeader
  home: string
  crashDir: string
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Replaces the home directory with `~`, tolerant of Windows and macOS spellings like the Scrubber. */
function homeReplacer(home: string): (s: string) => string {
  const trimmed = home.replace(/[\\/]+$/, '')
  if (trimmed === '') return (s) => s
  const flags = /^[a-z]:|^[\\/]users[\\/]/i.test(trimmed) ? 'gi' : 'g'
  const body = trimmed.split(/[\\/]/).map(escapeRe).join('[\\\\/]')
  const re = new RegExp(`(?:file:/{2,3})?${body}(?![\\w.-])`, flags)
  return (s) => s.replace(re, '~')
}

function mapStrings(value: unknown, fn: (s: string) => string, depth = 0): unknown {
  if (typeof value === 'string') return fn(value)
  if (depth > 20 || typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = mapStrings(v, fn, depth + 1)
  return out
}

function pickSessions(o: ExportOptions): SessionInfo[] {
  if (o.includeAllSessions) return o.sessions
  const anchor = (o.selected !== undefined && o.sessions.find((s) => s.id === o.selected)) || o.current
  const i = o.sessions.findIndex((s) => s.file === anchor.file)
  if (i < 0) return [anchor]
  return o.sessions.slice(Math.max(0, i - 1), i + 1)
}

function dumpsUnder(root: string): string[] {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = join(root, e.name)
    if (e.isDirectory()) out.push(...dumpsUnder(full))
    else if (e.isFile() && e.name.toLowerCase().endsWith('.dmp')) out.push(full)
  }
  return out
}

function readme(h: ExportHeader, scrubbed: boolean, skippedDumps: number, clean: (s: string) => string): string {
  const rows: Array<[string, string]> = [
    ['App version', h.version],
    ['OS', h.os],
    ['OS version', h.osVersion],
    ['Arch', h.arch],
    ['Install kind', h.installKind],
    ['Electron', h.electron],
    ['Node', h.node],
    ['Verbose logging', h.verbose ? 'on' : 'off'],
    ['Open engagements', String(h.openEngagements)],
    ['Previous session crashed', h.previousCrashed ? 'yes' : 'no'],
    ['Target details', scrubbed ? 'replaced with placeholders' : 'included'],
  ]
  const note =
    skippedDumps > 0
      ? `\n${skippedDumps} crash dumps not included (they can contain unscrubbed data). Re-export with target details to include them.\n`
      : ''
  return clean(`Executioner logs for a bug report\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n${note}`)
}

/** Builds the zip: README, the chosen session logs (scrubbed unless targets are kept) and matching native crash dumps. */
export function buildExport(o: ExportOptions): Uint8Array {
  const chosen = pickSessions(o)
  const home = homeReplacer(o.home)
  // One scrubber per export keeps placeholders consistent across every file.
  const scrubber = o.includeTargets ? null : new Scrubber({ home: o.home })
  const treat = (l: LogLine): LogLine => (scrubber ? scrubber.line(l) : (mapStrings(l, home) as LogLine))

  const files: Record<string, Uint8Array> = {}
  for (const s of chosen) {
    const text = readSession(s.file)
      .map((l) => formatLine(treat(l)))
      .join('\n')
    files[`${s.id}.jsonl`] = strToU8(text === '' ? '' : text + '\n')
  }

  // Electron names dump files itself, so they belong to a session by modification time.
  const now = Date.now()
  const dumps = dumpsUnder(o.crashDir)
  const used = new Set<string>()
  let skipped = 0
  for (const s of chosen) {
    const idx = o.sessions.findIndex((x) => x.file === s.file)
    const start = Date.parse(s.startedAt)
    const next = idx >= 0 ? o.sessions[idx + 1] : undefined
    const end = next ? Date.parse(next.startedAt) : now + 1
    for (const d of dumps) {
      let mtime: number
      try {
        mtime = statSync(d).mtimeMs
      } catch {
        continue
      }
      if (mtime < start || mtime >= end || used.has(d)) continue
      used.add(d)
      // Dumps are raw process memory and cannot be scrubbed, so only a target-details export carries them.
      if (!o.includeTargets) {
        skipped++
        continue
      }
      let name = basename(d)
      if (`crashes/${name}` in files) name = `${s.id}-${name}`
      try {
        files[`crashes/${name}`] = readFileSync(d)
      } catch {
        /* a dump that cannot be read is left out */
      }
    }
  }
  files['README.txt'] = strToU8(readme(o.header, !o.includeTargets, skipped, home))
  return zipSync(files)
}
