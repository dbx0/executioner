import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { graphSchema } from '@exe/graph'
import { toolManifestSchema, type ToolManifest } from '@exe/protocol'
import { createProject, type Project } from '@exe/project'
import { EventBus } from '../transport/events.js'
import { GraphExecutor } from './graph-executor.js'

let dir: string
let project: Project
let targetId: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-savefinding-'))
  project = createProject(dir, { name: 'test' })
  targetId = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' }).id
})

afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

/**
 * Stands in for a JS-secrets scanner: emits two rows, each naming the file it
 * matched in and the secret it found.
 */
const jsSecrets: ToolManifest = toolManifestSchema.parse({
  id: 'js-secrets',
  name: 'js-secrets',
  description: 'emits secret matches as JSON records',
  category: 'test',
  accepts: ['domain'],
  command: {
    program: process.execPath,
    args: [
      '-e',
      'process.stdout.write(JSON.stringify([{file: "app.js", match: "AKIAEXAMPLE"}, {file: "vendor.js", match: "sk_live_123"}]))',
    ],
  },
  emit: { parser: 'json' },
})

const manifests = new Map<string, ToolManifest>([['js-secrets', jsSecrets]])

function run(saveNode: Record<string, unknown>): Promise<{ status: string }> {
  const executor = new GraphExecutor({
    project,
    bus: new EventBus(),
    manifests,
    store: project.runs,
  })
  const graph = graphSchema.parse({
    nodes: [
      { id: 'scan', type: 'js-secrets', data: {} },
      { id: 'save', type: 'save_to_finding', data: saveNode },
    ],
    edges: [{ id: 'e', source: 'scan', target: 'save' }],
  })
  return executor.run({ graph, workflowId: null, targetId, testMode: false })
}

describe('save_to_finding', () => {
  it('turns each upstream row into a finding, templating per row', async () => {
    await run({
      title: 'Secret in {{ row.file }}',
      severity: 'high',
      description: 'A credential ships to the browser.',
      details: '{{ row.match }}',
    })

    const findings = project.findings.list()
    // Same severity, so the list shows the most recently seen first.
    expect(findings.map((f) => f.title).sort()).toEqual(['Secret in app.js', 'Secret in vendor.js'])
    expect(findings.every((f) => f.severity === 'high')).toBe(true)
    expect(findings.map((f) => f.details).sort()).toEqual(['AKIAEXAMPLE', 'sk_live_123'])
    expect(findings.every((f) => f.targetId === targetId)).toBe(true)
    expect(findings.every((f) => f.source === 'workflow')).toBe(true)
    expect(findings.every((f) => f.nodeId === 'save')).toBe(true)
  })

  it('keeps the row itself as the evidence when no details template is given', async () => {
    await run({ title: 'Secret in {{ row.file }}', severity: 'high' })
    const appJs = project.findings.list().find((f) => f.title === 'Secret in app.js')
    expect(JSON.parse(appJs?.details ?? '{}')).toMatchObject({ file: 'app.js', match: 'AKIAEXAMPLE' })
  })

  it('falls back to a field from the row when no title is configured', async () => {
    await run({ severity: 'low' })
    expect(project.findings.list().map((f) => f.title).sort()).toEqual(['AKIAEXAMPLE', 'sk_live_123'])
  })

  it('defaults an unusable severity to medium rather than storing junk', async () => {
    await run({ title: '{{ row.file }}', severity: 'catastrophic' })
    expect(project.findings.list().every((f) => f.severity === 'medium')).toBe(true)
  })

  it('refreshes rather than duplicates when the workflow runs again', async () => {
    await run({ title: 'Secret in {{ row.file }}', severity: 'high', details: '{{ row.match }}' })
    await run({ title: 'Secret in {{ row.file }}', severity: 'critical', details: '{{ row.match }}' })

    const findings = project.findings.list()
    expect(findings).toHaveLength(2)
    expect(findings.every((f) => f.severity === 'critical')).toBe(true)
  })

  it('does not reopen a finding that was triaged between runs', async () => {
    await run({ title: 'Secret in {{ row.file }}', severity: 'high' })
    const first = project.findings.list()[0]!
    project.findings.update(first.id, { status: 'false_positive' })

    await run({ title: 'Secret in {{ row.file }}', severity: 'high' })

    expect(project.findings.get(first.id)?.status).toBe('false_positive')
  })

  it('reports what it wrote, so a later node can announce it', async () => {
    const result = await run({ title: 'Secret in {{ row.file }}', severity: 'high' })
    const store = project.runs
    const node = store.nodesFor(result.status === 'succeeded' ? store.listExecutions()[0]!.id : '').find(
      (n) => n.nodeId === 'save',
    )

    expect(node?.status).toBe('succeeded')
    const rows = node?.parsedOutput as Array<{ title: string; created: boolean }>
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.created)).toBe(true)
  })

  it('writes nothing when the upstream produced no rows', async () => {
    const executor = new GraphExecutor({
      project,
      bus: new EventBus(),
      manifests,
      store: project.runs,
    })
    const graph = graphSchema.parse({
      nodes: [{ id: 'save', type: 'save_to_finding', data: { title: '{{ row.file }}', severity: 'high' } }],
      edges: [],
    })

    await executor.run({ graph, workflowId: null, targetId, testMode: false })
    expect(project.findings.list()).toHaveLength(0)
  })
})
