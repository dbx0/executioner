import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LogLevel, LogLine } from '@exe/protocol'
import { SessionLog, readSession } from './session-log.js'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'exe-session-log-'))
const line = (msg: string, lvl: LogLevel = 'info'): LogLine => ({ t: '2026-01-01T00:00:00.000Z', lvl, src: 'main', msg })
const at = (n: number): Date => new Date(Date.UTC(2026, 0, 1, 0, 0, n))
const allDead = (): boolean => false

/** Leave behind a finished-or-crashed session as an earlier run would have. */
function seed(dir: string, n: number, pid: number, marker: boolean): string {
  const iso = at(n).toISOString().replace(/:/g, '-')
  const file = join(dir, `session-${iso}-${pid}.jsonl`)
  writeFileSync(file, `${JSON.stringify(line(`old ${n}`))}\n`)
  if (marker) writeFileSync(`${file}.running`, String(pid))
  return file
}

describe('SessionLog', () => {
  it('creates the session file and marker; write is immediately readable; close drops only the marker', () => {
    const dir = tmp()
    const log = SessionLog.open({ dir, pid: 4242, now: at(1), isAlive: allDead })
    expect(log.info.file).toMatch(/session-2026-01-01T00-00-01\.000Z-4242\.jsonl$/)
    expect(log.info.pid).toBe(4242)
    expect(log.info.live).toBe(true)
    expect(readFileSync(`${log.info.file}.running`, 'utf8')).toBe('4242')
    log.write(line('hello'))
    expect(readSession(log.info.file).map((l) => l.msg)).toEqual(['hello'])
    log.close()
    expect(existsSync(`${log.info.file}.running`)).toBe(false)
    expect(existsSync(log.info.file)).toBe(true)
  })

  it('readSession skips unparseable lines and honours a limit (the last lines)', () => {
    const dir = tmp()
    const file = join(dir, 'x.jsonl')
    writeFileSync(file, `${JSON.stringify(line('a'))}\nnot json\n${JSON.stringify(line('b'))}\n${JSON.stringify(line('c'))}\n`)
    expect(readSession(file).map((l) => l.msg)).toEqual(['a', 'b', 'c'])
    expect(readSession(file, 2).map((l) => l.msg)).toEqual(['b', 'c'])
  })

  it('reports an older session whose marker pid is dead as crashed', () => {
    const dir = tmp()
    const old = seed(dir, 1, 111, true)
    const log = SessionLog.open({ dir, pid: 222, now: at(5), isAlive: allDead })
    const crashed = log.previousCrashed()
    expect(crashed?.file).toBe(old)
    expect(crashed?.crashed).toBe(true)
    expect(crashed?.live).toBe(false)
    log.close()
  })

  it('reports a crash only when it is the latest earlier non-live session', () => {
    const clean = tmp()
    seed(clean, 1, 111, true)
    seed(clean, 2, 112, false)
    const a = SessionLog.open({ dir: clean, pid: 9, now: at(5), keep: 20, isAlive: allDead })
    expect(a.previousCrashed()).toBeNull()
    a.close()

    const skip = tmp()
    const crashedFile = seed(skip, 1, 111, true)
    seed(skip, 2, 112, true)
    const b = SessionLog.open({ dir: skip, pid: 9, now: at(5), keep: 20, isAlive: (pid) => pid === 112 })
    expect(b.previousCrashed()?.file).toBe(crashedFile)
    b.close()
  })

  it("ignores a live instance's marker and file", () => {
    const dir = tmp()
    const other = seed(dir, 1, 111, true)
    seed(dir, 2, 112, false)
    const log = SessionLog.open({ dir, pid: 222, now: at(5), keep: 1, isAlive: (pid) => pid === 111 })
    expect(log.previousCrashed()).toBeNull()
    expect(existsSync(other)).toBe(true)
    expect(existsSync(`${other}.running`)).toBe(true)
    expect(log.sessions().find((s) => s.file === other)?.live).toBe(true)
    log.close()
  })

  it('keeps the newest sessions and deletes older ones with their markers', () => {
    const dir = tmp()
    const files = Array.from({ length: 12 }, (_, i) => seed(dir, i + 1, 100 + i, i === 0))
    const log = SessionLog.open({ dir, pid: 999, now: at(50), keep: 10, isAlive: allDead })
    const left = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    // keep applies to previous sessions plus this one: the newest 10 overall survive
    expect(left).toHaveLength(10)
    expect(existsSync(files[0]!)).toBe(false)
    expect(existsSync(`${files[0]}.running`)).toBe(false)
    expect(existsSync(files[1]!)).toBe(false)
    expect(existsSync(files[2]!)).toBe(false)
    expect(existsSync(files[11]!)).toBe(true)
    log.close()
  })

  it('deletes crash dumps (recursively) older than the oldest retained session, keeping newer ones', () => {
    const dir = tmp()
    const crashDir = join(dir, 'crashes')
    mkdirSync(join(crashDir, 'completed'), { recursive: true })
    const oldDump = join(crashDir, 'completed', 'a.dmp')
    const newDump = join(crashDir, 'b.dmp')
    writeFileSync(oldDump, 'x')
    writeFileSync(newDump, 'x')
    const settings = join(crashDir, 'settings.dat')
    writeFileSync(settings, 'x')
    const sec = (n: number): number => at(n).getTime() / 1000
    seed(dir, 10, 1, false)
    seed(dir, 20, 2, false)
    seed(dir, 30, 3, false)
    utimesSync(oldDump, sec(5), sec(5))
    utimesSync(newDump, sec(25), sec(25))
    utimesSync(settings, sec(5), sec(5))
    // keep 2 of 4 (3 old + new): retained are the sessions at 30 and 40, oldest start = 30
    const log = SessionLog.open({ dir, pid: 4, now: at(40), keep: 2, isAlive: allDead })
    expect(existsSync(oldDump)).toBe(false)
    expect(existsSync(newDump)).toBe(false)
    expect(existsSync(settings)).toBe(true)
    log.close()

    const dir2 = tmp()
    mkdirSync(join(dir2, 'crashes'))
    const keepDump = join(dir2, 'crashes', 'c.dmp')
    writeFileSync(keepDump, 'x')
    seed(dir2, 10, 1, false)
    utimesSync(keepDump, sec(25), sec(25))
    const log2 = SessionLog.open({ dir: dir2, pid: 2, now: at(40), keep: 10, isAlive: allDead })
    expect(existsSync(keepDump)).toBe(true)
    log2.close()
  })

  it('honours a custom crashDir', () => {
    const dir = tmp()
    const crashDir = tmp()
    const dump = join(crashDir, 'd.dmp')
    writeFileSync(dump, 'x')
    utimesSync(dump, 1, 1)
    const log = SessionLog.open({ dir, crashDir, pid: 1, now: at(5), isAlive: allDead })
    expect(existsSync(dump)).toBe(false)
    log.close()
  })

  it('drops debug after the soft cap with one warning, and stops entirely at the hard cap', () => {
    const dir = tmp()
    const log = SessionLog.open({ dir, pid: 1, now: at(1), isAlive: allDead, softCap: 200, hardCap: 400 })
    for (let i = 0; i < 3; i++) log.write(line(`f${i}`, 'debug'))
    log.write(line('after cap debug', 'debug'))
    log.write(line('kw', 'warn'))
    let msgs = readSession(log.info.file).map((l) => l.msg)
    expect(msgs.filter((m) => m === 'Log size limit reached')).toHaveLength(1)
    expect(msgs).not.toContain('after cap debug')
    expect(msgs).toContain('kw')
    for (let i = 0; i < 20; i++) log.write(line(`e${i}`, 'error'))
    const size = readFileSync(log.info.file).length
    expect(size).toBeLessThanOrEqual(400)
    log.write(line('nothing more', 'error'))
    expect(readFileSync(log.info.file).length).toBe(size)
    msgs = readSession(log.info.file).map((l) => l.msg)
    expect(msgs.filter((m) => m === 'Log size limit reached')).toHaveLength(1)
    log.close()
  })

  it('with a limit reads only the file tail and returns exactly the last lines', () => {
    const dir = tmp()
    const file = join(dir, 'tail.jsonl')
    const msgs = Array.from({ length: 50 }, (_, i) => `m${String(i).padStart(3, '0')}`)
    writeFileSync(file, msgs.map((m) => JSON.stringify(line(m))).join('\n') + '\n')
    expect(readSession(file, 5).map((l) => l.msg)).toEqual(msgs.slice(-5))
    // a window far smaller than the file: the partial first line is dropped, the last lines survive
    const small = readSession(file, 5, 600).map((l) => l.msg)
    expect(small).toEqual(msgs.slice(-5))
    const wide = readSession(file, 1000, 600).map((l) => l.msg)
    expect(wide.length).toBeLessThan(50)
    expect(wide[wide.length - 1]).toBe('m049')
  })

  it('skips a truncated final line', () => {
    const dir = tmp()
    const file = join(dir, 'trunc.jsonl')
    writeFileSync(file, `${JSON.stringify(line('a'))}\n${JSON.stringify(line('b'))}\n{"t":"x","lvl":"in`)
    expect(readSession(file, 10).map((l) => l.msg)).toEqual(['a', 'b'])
  })
})
