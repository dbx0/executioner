import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toolManifestSchema, type ToolManifest } from '@exe/protocol'
import {
  isStarterWorkflow,
  BackendProfileRepository,
  CustomNodeRepository,
  MetaRepository,
  SecretRepository,
  WorkflowRepository,
} from '@exe/db'
import { createProject, openProject, ADOPTED_KEY, type Project } from './index.js'

/** A minimal valid custom node (a ToolManifest the graph can name by id). */
const customNode = (id: string, name: string): ToolManifest =>
  toolManifestSchema.parse({
    id,
    name,
    description: 'a user-authored tool',
    category: 'custom',
    accepts: ['domain'],
    command: { program: 'echo', args: ['{{ target.value }}'] },
    emit: { parser: 'json' },
  })

let acme: string
let globex: string

beforeEach(() => {
  acme = mkdtempSync(join(tmpdir(), 'exe-acme-'))
  globex = mkdtempSync(join(tmpdir(), 'exe-globex-'))
})

afterEach(() => {
  rmSync(acme, { recursive: true, force: true })
  rmSync(globex, { recursive: true, force: true })
})

/**
 * Write rows the way a build that kept connections/secrets per engagement did:
 * the same repositories, pointed at the engagement's own (legacy) tables.
 * Returns the id the old connection was stored under.
 */
function seedEngagementRows(root: string): string {
  const project = openProject(root)
  const local = project.db
  const backend = new BackendProfileRepository(local).create({
    name: 'old kali',
    kind: 'ssh',
    host: 'kali.lan',
    user: 'root',
  })
  new SecretRepository(local).set('SHODAN_API_KEY', 'old')
  new WorkflowRepository(local).create('old recon', '{"nodes":[],"edges":[]}', { id: 'wf-old' })
  new CustomNodeRepository(local).create(customNode('old-node', 'Old node'))
  // An engagement from before connections went global carries no marker.
  new MetaRepository(local).remove(ADOPTED_KEY)
  project.close()
  return backend.id
}

/** The workflows a test saved, without the starters every install is seeded with. */
const userWorkflows = (p: Project) => p.workflows.list().filter((w) => !isStarterWorkflow(w.id))

describe('user-level workflows, connections and secrets', () => {
  it('carries a custom node the shared workflow names into the next engagement', () => {
    const a = createProject(acme, { name: 'acme' })
    a.customNodes.create(customNode('my-scanner', 'My scanner'))
    a.workflows.create('uses my scanner', '{"nodes":[{"id":"a","type":"my-scanner","data":{}}],"edges":[]}')
    a.close()

    const b = createProject(globex, { name: 'globex' })
    expect(userWorkflows(b)).toHaveLength(1)
    expect(b.customNodes.get('my-scanner')?.name).toBe('My scanner')
    b.close()
  })


  it('shows a workflow saved in one engagement in the next one', () => {
    const a = createProject(acme, { name: 'acme' })
    const saved = a.workflows.create('recon sweep', '{"nodes":[],"edges":[]}')
    a.close()

    const b = createProject(globex, { name: 'globex' })
    expect(userWorkflows(b).map((w) => w.name)).toEqual(['recon sweep'])
    expect(b.workflows.get(saved.id)?.graph).toBe('{"nodes":[],"edges":[]}')
    b.close()
  })

  it('shares the workflow but not the runs it produced', () => {
    const a = createProject(acme, { name: 'acme' })
    a.workflows.create('recon sweep', '{"nodes":[],"edges":[]}')
    const target = a.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    a.executions.create({ targetId: target.id, nodeId: 'subfinder' })
    a.close()

    const b = createProject(globex, { name: 'globex' })
    expect(userWorkflows(b)).toHaveLength(1)
    // Runs belong to the engagement they ran in.
    expect(b.runs.listExecutions()).toEqual([])
    b.close()
  })


  it('shows a connection saved in one engagement in the next one', () => {
    const a = createProject(acme, { name: 'acme' })
    a.backends.create({ name: 'kali', kind: 'ssh', host: 'kali.lan', user: 'root' })
    a.close()

    const b = createProject(globex, { name: 'globex' })
    expect(b.backends.list().map((p) => p.name)).toEqual(['kali'])
    b.close()
  })

  it('shows a secret saved in one engagement in the next one', () => {
    const a = createProject(acme, { name: 'acme' })
    a.secrets.set('SHODAN_API_KEY', 'abc')
    a.close()

    const b = createProject(globex, { name: 'globex' })
    expect(b.secrets.map()).toEqual({ SHODAN_API_KEY: 'abc' })
    b.close()
  })

  it('keeps them out of the engagement database', () => {
    const p = createProject(acme, { name: 'acme' })
    p.secrets.set('SHODAN_API_KEY', 'abc')
    p.backends.create({ name: 'kali', kind: 'ssh', host: 'kali.lan', user: 'root' })
    expect(new SecretRepository(p.db).list()).toEqual([])
    expect(new BackendProfileRepository(p.db).list()).toEqual([])
    expect(new SecretRepository(p.globalDb).list()).toHaveLength(1)
    p.close()
  })

  it('adopts what an engagement from an older build already had', () => {
    createProject(acme, { name: 'acme' }).close()
    seedEngagementRows(acme)

    const reopened = openProject(acme)
    expect(userWorkflows(reopened).map((w) => w.name)).toEqual(['old recon'])
    expect(reopened.customNodes.get('old-node')).toBeDefined()
    expect(reopened.backends.list().map((p) => p.name)).toEqual(['old kali'])
    expect(reopened.secrets.get('SHODAN_API_KEY')?.value).toBe('old')
    reopened.close()

    // And they are global from then on, not just in the engagement that had them.
    const other = createProject(globex, { name: 'globex' })
    expect(other.backends.list().map((p) => p.name)).toEqual(['old kali'])
    other.close()
  })

  it('does not resurrect an adopted connection the user has since deleted', () => {
    createProject(acme, { name: 'acme' }).close()
    const oldId = seedEngagementRows(acme)

    const first = openProject(acme)
    first.backends.remove(oldId)
    first.close()

    const second = openProject(acme)
    expect(second.backends.list()).toEqual([])
    second.close()
  })

  it('leaves the global value in place when an engagement carries an older one', () => {
    const a = createProject(acme, { name: 'acme' })
    a.secrets.set('SHODAN_API_KEY', 'current')
    a.close()

    createProject(globex, { name: 'globex' }).close()
    seedEngagementRows(globex)

    const b = openProject(globex)
    expect(b.secrets.get('SHODAN_API_KEY')?.value).toBe('current')
    b.close()
  })
})
