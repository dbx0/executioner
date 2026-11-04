import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { formatLine, type LogLine } from '@exe/protocol'
import { buildExport, type ExportHeader } from './export.js'
import type { SessionInfo } from './session-log.js'

const HOME = '/home/alice'
const tmp = (): string => mkdtempSync(join(tmpdir(), 'exe-export-'))
const at = (n: number): Date => new Date(Date.UTC(2026, 0, 1, 0, 0, n))
const header: ExportHeader = {
  version: '1.2.3',
  os: 'linux',
  osVersion: '6.1',
  arch: 'x64',
  installKind: 'appimage',
  electron: '43.0.0',
  node: '24.0.0',
  verbose: true,
  openEngagements: 2,
  previousCrashed: false,
}

function session(dir: string, n: number, lines: string[]): SessionInfo {
  const id = `session-${at(n).toISOString().replace(/:/g, '-')}-${100 + n}`
  const file = join(dir, `${id}.jsonl`)
  writeFileSync(file, lines.join('\n') + '\n')
  return { id, file, startedAt: at(n).toISOString(), pid: 100 + n, live: false, crashed: false }
}
const ll = (msg: string, data?: Record<string, unknown>): string =>
  formatLine({ t: '2026-01-01T00:00:00.000Z', lvl: 'info', src: 'main', msg, ...(data ? { data } : {}) } as LogLine)

function run(over: Partial<Parameters<typeof buildExport>[0]> & { sessions: SessionInfo[] }) {
  const sessions = over.sessions
  const files = unzipSync(
    buildExport({
      current: sessions[sessions.length - 1]!,
      includeAllSessions: false,
      includeTargets: false,
      header,
      home: HOME,
      crashDir: join(tmp(), 'none'),
      ...over,
    }),
  )
  return files
}
const names = (f: Record<string, Uint8Array>): string[] => Object.keys(f).sort()

describe('buildExport', () => {
  it('holds the current and previous session only, unless all are asked for', () => {
    const dir = tmp()
    const s = [1, 2, 3, 4].map((n) => session(dir, n, [ll(`s${n}`)]))
    const f = run({ sessions: s })
    expect(names(f)).toEqual(['README.txt', `${s[2]!.id}.jsonl`, `${s[3]!.id}.jsonl`].sort())
    expect(Object.keys(run({ sessions: s, includeAllSessions: true })).length).toBe(5)
  })

  it('with a selected session, exports it and the one before it', () => {
    const dir = tmp()
    const s = [1, 2, 3, 4].map((n) => session(dir, n, [ll(`s${n}`)]))
    const f = run({ sessions: s, selected: s[1]!.id })
    expect(names(f)).toEqual(['README.txt', `${s[0]!.id}.jsonl`, `${s[1]!.id}.jsonl`].sort())
  })

  it('README lists the header fields and leaks neither home nor username', () => {
    const dir = tmp()
    const f = run({ sessions: [session(dir, 1, [ll('a')])], header: { ...header, osVersion: '6.1 /home/alice/x' } })
    const readme = strFromU8(f['README.txt']!)
    for (const v of ['1.2.3', 'linux', 'x64', 'appimage', '43.0.0', '24.0.0', 'on', '2']) expect(readme).toContain(v)
    expect(readme).not.toContain('/home/alice')
    expect(readme).not.toContain('alice')
  })

  it('scrubs targets consistently across sessions by default', () => {
    const dir = tmp()
    const s = [session(dir, 1, [ll('hit client.example 10.1.2.3')]), session(dir, 2, [ll('again client.example 10.1.2.3')])]
    const f = run({ sessions: s })
    const all = s.map((x) => strFromU8(f[`${x.id}.jsonl`]!)).join('')
    expect(all).not.toContain('client.example')
    expect(all).not.toContain('10.1.2.3')
    expect(all.match(/host-1/g)?.length).toBe(2)
    expect(all.match(/ip-1/g)?.length).toBe(2)
  })

  it('with includeTargets keeps hosts and [secret], still turns home into ~', () => {
    const dir = tmp()
    const s = session(dir, 1, [ll('hit client.example with [secret]', { path: '/home/alice/eng', win: 'C:\\Users\\bob\\x' })])
    const text = strFromU8(run({ sessions: [s], includeTargets: true, home: HOME })[`${s.id}.jsonl`]!)
    expect(text).toContain('client.example')
    expect(text).toContain('[secret]')
    expect(text).toContain('~/eng')
    expect(text).not.toContain('alice')
    const win = session(dir, 2, [ll('x', { p: 'c:/users/bob/x' })])
    const t2 = strFromU8(run({ sessions: [win], includeTargets: true, home: 'C:\\Users\\Bob' })[`${win.id}.jsonl`]!)
    expect(t2).toContain('~/x')
    expect(t2.toLowerCase()).not.toContain('bob')
  })

  it('skips a truncated final line', () => {
    const dir = tmp()
    const s = session(dir, 1, [ll('whole'), '{"t":"2026-01-01T00:00:00.000Z","lv'])
    const text = strFromU8(run({ sessions: [s] })[`${s.id}.jsonl`]!)
    expect(text.trim().split('\n')).toHaveLength(1)
    expect(text).toContain('whole')
  })

  it('includes crash dumps by mtime window, searched recursively, never by name', () => {
    const dir = tmp()
    const crashDir = join(tmp(), 'crashes')
    mkdirSync(join(crashDir, 'sub'), { recursive: true })
    const s = [1, 2, 3].map((n) => session(dir, n, [ll(`s${n}`)]))
    const put = (rel: string, when: Date): void => {
      const p = join(crashDir, rel)
      writeFileSync(p, 'dump')
      utimesSync(p, when, when)
    }
    put('sub/a.dmp', new Date(at(2).getTime() + 500)) // session 2 window
    put('newest.dmp', new Date()) // session 3 window (until now)
    put('old.dmp', new Date(at(1).getTime() - 5000)) // before every session
    put('sub/not-a-dump.txt', new Date(at(2).getTime() + 500))
    const dflt = run({ sessions: s, crashDir })
    expect(Object.keys(dflt).filter((k) => k.startsWith('crashes/'))).toEqual([])
    expect(strFromU8(dflt['README.txt']!)).toContain(
      '2 crash dumps not included (they can contain unscrubbed data). Re-export with target details to include them.',
    )
    const f = run({ sessions: s, crashDir, includeTargets: true })
    expect(Object.keys(f).filter((k) => k.startsWith('crashes/')).sort()).toEqual(['crashes/a.dmp', 'crashes/newest.dmp'])
    expect(strFromU8(f['README.txt']!)).not.toContain('not included')
    // session 1 is not exported, so a dump in its window stays out
    put('sub/s1.dmp', new Date(at(1).getTime() + 500))
    expect(Object.keys(run({ sessions: s, crashDir, includeTargets: true })).filter((k) => k.includes('s1.dmp'))).toEqual([])
  })

  it('does not leak engagement data through an exit record stderrTail', () => {
    const dir = tmp()
    const text = 'Quarterly Acme findings dump'
    const s = session(dir, 1, [
      ll('Engine exited', { code: 1, signal: null, stderrTail: ['raw crash line'] }),
      formatLine({ t: '2026-01-01T00:00:00.000Z', lvl: 'info', src: 'engine:abc123', msg: 'work', data: { engagement: 'Acme Corp', text } }),
    ])
    const out = strFromU8(run({ sessions: [s] })[`${s.id}.jsonl`]!)
    expect(out).toContain('raw crash line')
    expect(out).not.toContain('Acme')
    expect(out).not.toContain(text)
  })
})
