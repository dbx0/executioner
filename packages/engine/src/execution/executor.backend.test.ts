import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { toolManifestSchema } from '@exe/protocol'
import { EventBus, type EngineEvent } from '../transport/events.js'
import type { CommandLauncher, LaunchSpec } from '../infra/launcher.js'
import { CancellationRegistry } from './cancellation.js'
import { Executor } from './executor.js'

let root: string
let project: Project

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-backend-'))
  project = createProject(root, { name: 'acme' })
})

afterEach(() => {
  project.close()
  rmSync(root, { recursive: true, force: true })
})

/** A node whose output is parsed from stdout — safe to run on any backend. */
const stdoutNode = toolManifestSchema.parse({
  id: 'stdout-node',
  name: 'Stdout Node',
  description: 'prints one record',
  category: 'test',
  accepts: ['domain'],
  command: { program: process.execPath, args: ['-e', 'process.stdout.write(\'{"host":"a.example.com"}\\n\')'] },
  emit: { parser: 'json', targets: [{ kind: 'subdomain', value: '{{ record.host }}', parent: 'input' }] },
})

/** A node whose output is parsed from a FILE — cannot run on a remote backend. */
const fileNode = toolManifestSchema.parse({
  id: 'file-node',
  name: 'File Node',
  description: 'writes a file',
  category: 'test',
  accepts: ['domain'],
  command: {
    program: process.execPath,
    args: ['-e', 'require("fs").writeFileSync("out.json", \'[{"host":"f.example.com"}]\')'],
  },
  emit: {
    parser: 'file',
    path: 'out.json',
    format: 'json',
    targets: [{ kind: 'subdomain', value: '{{ record.host }}', parent: 'input' }],
  },
})

/** A node that outlives a test unless something kills it. */
const sleeper = toolManifestSchema.parse({
  id: 'sleeper',
  name: 'Sleeper',
  description: 'sleeps',
  category: 'test',
  accepts: ['domain'],
  command: { program: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'], timeout_ms: 60000 },
  emit: { parser: 'json', targets: [] },
})

/**
 * A launcher that claims a remote kind but actually spawns locally, recording
 * what it was asked to run. Lets the backend plumbing be tested without ssh.
 */
function fakeLauncher(kind: 'ssh' | 'docker'): CommandLauncher & { specs: LaunchSpec[] } {
  const specs: LaunchSpec[] = []
  return {
    kind,
    specs,
    launch(spec: LaunchSpec): ChildProcessWithoutNullStreams {
      specs.push(spec)
      return spawn(spec.program, spec.args, { cwd: spec.cwd }) as ChildProcessWithoutNullStreams
    },
  }
}

const domain = (): ReturnType<Project['targets']['upsert']> =>
  project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })

describe('Executor on a connection', () => {
  it('defaults to this machine and records the backend as local', async () => {
    const executor = new Executor(project, new EventBus())
    const { settled } = executor.start(stdoutNode, domain(), {})
    expect((await settled).backend).toBe('local')
  })

  it('runs a stdout node through the given launcher and records its kind', async () => {
    const launcher = fakeLauncher('ssh')
    const executor = new Executor(project, new EventBus())
    const { settled } = executor.start(stdoutNode, domain(), {}, { launcher })
    const summary = await settled

    expect(summary.status).toBe('succeeded')
    expect(summary.backend).toBe('ssh')
    expect(launcher.specs).toHaveLength(1)
    expect(summary.parsedCount).toBe(1)
  })

  it('forces a file-output node local under a remote backend, and says so', async () => {
    const launcher = fakeLauncher('docker')
    const bus = new EventBus()
    const seen: EngineEvent[] = []
    bus.subscribe((e) => seen.push(e))
    const executor = new Executor(project, bus)

    const { settled } = executor.start(fileNode, domain(), {}, { launcher })
    const summary = await settled

    // Never went through the remote launcher, and the row says local.
    expect(launcher.specs).toEqual([])
    expect(summary.backend).toBe('local')
    expect(summary.status).toBe('succeeded')
    const notice = seen.find((e) => e.data.includes('reads a file output'))
    expect(notice?.data).toContain('under the docker backend')
  })

  it('names the backend when the program cannot be launched there', async () => {
    const launcher = fakeLauncher('ssh')
    const missing = toolManifestSchema.parse({
      ...stdoutNode,
      id: 'missing-bin',
      command: { program: '/nonexistent/executioner-missing-binary', args: [] },
    })
    const executor = new Executor(project, new EventBus())
    const summary = await executor.start(missing, domain(), {}, { launcher }).settled

    expect(summary.status).toBe('failed')
    expect(summary.error).toContain('on the ssh backend')
    expect(summary.error).toContain('executioner-missing-binary')
  })

  it('persists the params a run was started with', async () => {
    const executor = new Executor(project, new EventBus())
    await executor.start(stdoutNode, domain(), {}, { params: { ports: '80,443', deep: true } }).settled

    const runs = project.executions.listStandalone()
    expect(runs).toHaveLength(1)
    expect(runs[0]!.params).toEqual({ ports: '80,443', deep: true })
  })

  it('reads params as {} for a run that stored none', async () => {
    const executor = new Executor(project, new EventBus())
    await executor.start(stdoutNode, domain(), {}).settled
    expect(project.executions.listStandalone()[0]!.params).toEqual({})
  })
})

describe('Executor cancellation', () => {
  it('kills the running child when the run is cancelled', async () => {
    const runs = new CancellationRegistry()
    const executor = new Executor(project, new EventBus(), runs)
    const { executionId, settled } = executor.start(sleeper, domain(), {})

    expect(runs.isRunning(executionId)).toBe(true)
    expect(runs.cancel(executionId)).toBe(true)

    // Without the kill hook this would hang for the sleeper's full 60s.
    const summary = await settled
    expect(summary.status).not.toBe('succeeded')
    expect(runs.isRunning(executionId)).toBe(false)
  }, 15_000)

  it('registers nothing when no registry is given, preserving prior behaviour', async () => {
    const runs = new CancellationRegistry()
    const executor = new Executor(project, new EventBus())
    const { executionId, settled } = executor.start(stdoutNode, domain(), {})
    expect(runs.isRunning(executionId)).toBe(false)
    await settled
  })

  it('releases the kill hook once the run settles, so a later stop is a no-op', async () => {
    const runs = new CancellationRegistry()
    const executor = new Executor(project, new EventBus(), runs)
    const { executionId, settled } = executor.start(stdoutNode, domain(), {})
    await settled
    // Unregistered on settle, so the route falls through to its own handling.
    expect(runs.cancel(executionId)).toBe(false)
  })
})
