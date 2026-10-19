import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { NodeRegistry, loadManifests } from '@exe/nodes'
import { EventBus } from '../transport/events.js'
import { Executor } from './executor.js'
import { createApp } from '../transport/server.js'

const TOKEN = 'b'.repeat(40)
let root: string
let manifestsDir: string
let project: Project
let app: ReturnType<typeof createApp>
let executor: Executor
/** Every run the app started, by id, so a test can await one and teardown can drain them all. */
let settling: Map<string, Promise<unknown>>

// A registry loaded from a temp dir holding one stub manifest that runs `node`.
const stubToml = `
id = "stub-emitter"
name = "Stub Emitter"
description = "emits one subdomain"
category = "test"
accepts = ["domain"]

[command]
program = ${JSON.stringify(process.execPath)}
args = ["-e", "process.stdout.write(JSON.stringify({host:'a.example.com'}))"]

[emit]
parser = "json"

[[emit.targets]]
kind = "subdomain"
value = "{{ record.host }}"
parent = "input"
`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-e2e-'))
  manifestsDir = mkdtempSync(join(tmpdir(), 'exe-manifests-'))
  writeFileSync(join(manifestsDir, 'stub.toml'), stubToml)
  project = createProject(root, { name: 'acme' })
  const registry = new NodeRegistry(loadManifests(manifestsDir))
  executor = new Executor(project, new EventBus())
  // The route fires a run and forgets it; record each run's settle so nothing
  // waits on wall-clock time and no child finishes after the project closes.
  settling = new Map()
  const start = executor.start.bind(executor)
  executor.start = (...args: Parameters<Executor['start']>) => {
    const run = start(...args)
    settling.set(run.executionId, run.settled)
    return run
  }
  app = createApp({ project, token: TOKEN, bus: new EventBus(), registry, executor })
})

afterEach(async () => {
  // A run still writing its row when the database closes throws "The database
  // connection is not open" as an unhandled error, so drain them first.
  await Promise.allSettled(settling.values())
  project.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(manifestsDir, { recursive: true, force: true })
})

const auth = { headers: { authorization: `Bearer ${TOKEN}` } }

/** Starts the stub node over HTTP and waits until its run has settled. */
async function runOnce(targetId: string): Promise<string> {
  const res = await app.request('/api/executions', {
    method: 'POST',
    headers: { ...auth.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'stub-emitter', targetId }),
  })
  expect(res.status).toBe(202)
  const { executionId } = (await res.json()) as { executionId: string }
  const settled = settling.get(executionId)
  expect(settled).toBeDefined()
  await settled
  return executionId
}

describe('end-to-end run over HTTP', () => {
  it('runs a node and drives its execution row to succeeded', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const executionId = await runOnce(target.id)

    const res = await app.request(`/api/executions/${executionId}`, auth)
    expect(res.status).toBe(200)
    const summary = (await res.json()) as { status: string; parsedCount: number }
    expect(summary.status).toBe('succeeded')
    expect(summary.parsedCount).toBe(1)
  })

  it('is idempotent: running the same node twice yields one discovered target row', async () => {
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    await runOnce(target.id)
    await runOnce(target.id)
    const children = project.targets.all().filter((t) => t.kind === 'subdomain')
    expect(children).toHaveLength(1)
    expect(children[0]?.value).toBe('a.example.com')
  })
})

describe('executor shutdown', () => {
  it('stopAll clears tracked children without throwing', () => {
    expect(() => executor.stopAll()).not.toThrow()
  })
})
