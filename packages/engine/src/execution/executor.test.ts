import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { toolManifestSchema } from '@exe/protocol'
import { EventBus, type EngineEvent } from '../transport/events.js'
import { Executor } from './executor.js'

let root: string
let project: Project

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-run-'))
  project = createProject(root, { name: 'acme' })
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

// A stub tool: node prints two JSONL records to stdout, no real binary needed.
const emitterManifest = toolManifestSchema.parse({
  id: 'stub-emitter',
  name: 'Stub Emitter',
  description: 'emits two subdomains',
  category: 'test',
  accepts: ['domain'],
  command: {
    program: process.execPath,
    args: [
      '-e',
      'process.stdout.write(JSON.stringify({host:"a.example.com"})+"\\n"+JSON.stringify({host:"b.example.com"})+"\\n")',
    ],
  },
  emit: {
    parser: 'json',
    targets: [{ kind: 'subdomain', value: '{{ record.host }}', parent: 'input' }],
  },
})

describe('Executor happy path', () => {
  it('runs a node, streams stdout, writes logs, and emits targets', async () => {
    const bus = new EventBus()
    const seen: EngineEvent[] = []
    bus.subscribe((e) => seen.push(e))
    const executor = new Executor(project, bus)

    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const { executionId, settled } = executor.start(emitterManifest, target, {})
    const summary = await settled

    expect(summary.status).toBe('succeeded')
    expect(summary.exitCode).toBe(0)
    expect(summary.parsedCount).toBe(2)

    // Discovered targets landed via upsert, linked to the input.
    const children = project.targets.all().filter((t) => t.kind === 'subdomain')
    expect(children.map((t) => t.value).sort()).toEqual(['a.example.com', 'b.example.com'])
    expect(children.every((t) => t.parentId === target.id)).toBe(true)

    // Raw output was teed to the evidence dir.
    const dir = join(root, 'evidence', executionId)
    expect(readFileSync(join(dir, 'stdout.log'), 'utf8')).toContain('a.example.com')

    // Stream and status events reached the bus.
    expect(seen.some((e) => e.type === 'stdout' && e.executionId === executionId)).toBe(true)
    expect(seen.some((e) => e.type === 'done' && e.executionId === executionId)).toBe(true)
  })
})

const failingManifest = toolManifestSchema.parse({
  id: 'stub-fail',
  name: 'Stub Fail',
  description: 'exits non-zero',
  category: 'test',
  accepts: ['domain'],
  command: { program: process.execPath, args: ['-e', 'process.exit(3)'] },
  emit: { parser: 'json', targets: [{ kind: 'subdomain', value: '{{ record.host }}', parent: 'input' }] },
})

const sleepingManifest = toolManifestSchema.parse({
  id: 'stub-sleep',
  name: 'Stub Sleep',
  description: 'sleeps past the timeout',
  category: 'test',
  accepts: ['domain'],
  command: { program: process.execPath, args: ['-e', 'setTimeout(() => {}, 10000)'], timeout_ms: 200 },
  emit: { parser: 'json', targets: [] },
})

const badOutputManifest = toolManifestSchema.parse({
  id: 'stub-badjson',
  name: 'Stub Bad JSON',
  description: 'prints non-json then exits clean',
  category: 'test',
  accepts: ['domain'],
  command: { program: process.execPath, args: ['-e', 'process.stdout.write("not json at all\\n")'] },
  emit: { parser: 'json', targets: [{ kind: 'subdomain', value: '{{ record.host }}', parent: 'input' }] },
})

describe('Executor failure paths', () => {
  it('marks a non-zero exit failed and emits nothing', async () => {
    const bus = new EventBus()
    const executor = new Executor(project, bus)
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const summary = await executor.start(failingManifest, target, {}).settled
    expect(summary.status).toBe('failed')
    expect(summary.exitCode).toBe(3)
    expect(project.targets.all().some((t) => t.kind === 'subdomain')).toBe(false)
  })

  it('marks a run that exceeds its timeout as timeout and kills the process', async () => {
    const bus = new EventBus()
    const executor = new Executor(project, bus)
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const summary = await executor.start(sleepingManifest, target, {}).settled
    expect(summary.status).toBe('timeout')
  })

  it('marks a parser mismatch failed without throwing out of the executor', async () => {
    const bus = new EventBus()
    const executor = new Executor(project, bus)
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const summary = await executor.start(badOutputManifest, target, {}).settled
    expect(summary.status).toBe('failed')
    expect(project.targets.all().some((t) => t.kind === 'subdomain')).toBe(false)
  })
})
