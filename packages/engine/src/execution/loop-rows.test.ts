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

/** Stands in for an enumeration tool: prints one JSON row per host it "found". */
const lister = toolManifestSchema.parse({
  id: 'lister',
  name: 'Lister',
  description: 'prints three hosts',
  category: 'test',
  accepts: ['domain'],
  command: {
    program: process.execPath,
    args: ['-e', 'for (const h of ["a","b","c"]) console.log(JSON.stringify({ host: h + ".example.com", source: "test" }))'],
  },
  emit: { parser: 'json' },
})

/** Stands in for a per-host tool: records that it ran against its target. */
const probe = toolManifestSchema.parse({
  id: 'probe',
  name: 'Probe',
  description: 'echoes its target',
  category: 'test',
  accepts: ['domain', 'subdomain'],
  command: { program: process.execPath, args: ['-e', 'console.log(JSON.stringify({ seen: process.argv[1] }))', '{{ target.value }}'] },
  emit: { parser: 'json', facts: [{ kind: 'raw_output', data: { seen: '{{ record.seen }}' } }] },
})

/** Stands in for a liveness probe: only a.example.com answers; the rest print nothing. */
const alive = toolManifestSchema.parse({
  id: 'alive',
  name: 'Alive',
  description: 'answers for one host only',
  category: 'test',
  accepts: ['domain', 'subdomain'],
  command: {
    program: process.execPath,
    args: ['-e', 'if (process.argv[1] === "a.example.com") console.log(JSON.stringify({ url: "https://" + process.argv[1], status_code: 200 }))', '{{ target.value }}'],
  },
  emit: { parser: 'json' },
})

const manifests = new Map<string, ToolManifest>([
  ['lister', lister],
  ['probe', probe],
  ['alive', alive],
])

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-loop-'))
  project = createProject(dir, { name: 'test' })
})
afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

async function runLoop(loopData: Record<string, unknown>): Promise<string[]> {
  const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
  const graph = graphSchema.parse({
    nodes: [
      { id: 'lister', type: 'lister', data: {} },
      { id: 'each', type: 'loop', data: loopData },
      { id: 'probe', type: 'probe', data: { target: '{{ loop.item.host }}' } },
    ],
    edges: [
      { id: 'e1', source: 'lister', target: 'each', sourceHandle: null },
      { id: 'e2', source: 'each', target: 'probe', sourceHandle: null },
    ],
  })
  const exec = new GraphExecutor({ project, bus: new EventBus(), manifests, store: project.runs })
  const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })
  expect(result.status).toBe('succeeded')
  // Which hosts the body actually ran against, read from the facts it left on each.
  return project.targets
    .all()
    .filter((t) => project.facts.forTarget(t.id, 'raw_output').some((f) => f.data.seen === t.value))
    .map((t) => t.value)
}

describe('loop over a node\'s rows', () => {
  it('runs the body once per parsed row of the named node, with the row as loop.item', async () => {
    const ran = await runLoop({ source: '{{ nodes.lister.rows }}' })
    expect(ran).toEqual(['a.example.com', 'b.example.com', 'c.example.com'])
  })

  it('stops after max_items rows when one is set', async () => {
    const ran = await runLoop({ source: '{{ nodes.lister.rows }}', max_items: 2 })
    expect(ran).toEqual(['a.example.com', 'b.example.com'])
  })

  it('treats max_items 0 as no limit', async () => {
    const ran = await runLoop({ source: '{{ nodes.lister.rows }}', max_items: 0 })
    expect(ran).toHaveLength(3)
  })

  it('gates the rest of an iteration on whether the probe before the IF returned a row', async () => {
    // The shape a recon workflow uses: enumerate, probe each result, and only
    // look closer at the hosts that answered. A host that printed nothing has no
    // row, and that must read as "not alive" rather than fail the run.
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const graph = graphSchema.parse({
      nodes: [
        { id: 'lister', type: 'lister', data: {} },
        { id: 'each', type: 'loop', data: { source: '{{ nodes.lister.rows }}' } },
        { id: 'alive', type: 'alive', data: { target: '{{ loop.item.host }}' } },
        { id: 'if_live', type: 'if', data: { expression: '(data.status_code ?? 0) > 0' } },
        { id: 'probe', type: 'probe', data: { target: '{{ loop.item.host }}' } },
      ],
      edges: [
        { id: 'e1', source: 'lister', target: 'each', sourceHandle: null },
        { id: 'e2', source: 'each', target: 'alive', sourceHandle: null },
        { id: 'e3', source: 'alive', target: 'if_live', sourceHandle: null },
        { id: 'e4', source: 'if_live', target: 'probe', sourceHandle: 'true' },
      ],
    })
    const exec = new GraphExecutor({ project, bus: new EventBus(), manifests, store: project.runs })
    const result = await exec.run({ graph, workflowId: null, targetId: target.id, testMode: false })

    expect(result.status).toBe('succeeded')
    const probed = project.targets
      .all()
      .filter((t) => project.facts.forTarget(t.id, 'raw_output').some((f) => f.data.seen === t.value))
      .map((t) => t.value)
    expect(probed).toEqual(['a.example.com'])
  })
})
