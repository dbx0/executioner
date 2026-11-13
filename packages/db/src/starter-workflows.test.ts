import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openGlobalDatabase } from './index.js'
import { STARTER_WORKFLOWS, seedStarterWorkflows } from './starter-workflows.js'
import { WorkflowRepository } from './workflows.js'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'exe-starters-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('seedStarterWorkflows', () => {
  it('gives a fresh user-level database the starter workflows', () => {
    const db = openGlobalDatabase(join(home, 'global.sqlite'))
    expect(seedStarterWorkflows(db)).toBe(STARTER_WORKFLOWS.length)
    const names = new WorkflowRepository(db).list().map((w) => w.name)
    expect(names.sort()).toEqual(STARTER_WORKFLOWS.map((s) => s.name).sort())
    db.close()
  })

  it('wires every step to the trigger', () => {
    for (const starter of STARTER_WORKFLOWS) {
      const ids = new Set(starter.graph.nodes.map((n) => (n as { id: string }).id))
      for (const edge of starter.graph.edges as Array<{ source: string; target: string }>) {
        expect(ids.has(edge.source) && ids.has(edge.target)).toBe(true)
      }
      expect(starter.graph.edges).toHaveLength(starter.graph.nodes.length - 1)
    }
  })

  it('ships a recon workflow built from nodes alone', () => {
    const recon = STARTER_WORKFLOWS.find((s) => s.id === 'starter-recon')
    expect(recon?.name).toBe('Recon')
    const types = (recon?.graph.nodes ?? []).map((n) => (n as { type: string }).type)
    expect(types).toContain('manual')
    // A node saves its own results and a loop walks another node's rows, so a
    // starter has no reason to script, to re-save, or to ask an LLM.
    for (const banned of ['python_script', 'save_to_target', 'agent']) expect(types).not.toContain(banned)
  })

  it('does not walk an unbounded list of subdomains by default', () => {
    // A wildcard domain can return tens of thousands of names; the loop a starter
    // ships with has to say how many it will act on.
    const recon = STARTER_WORKFLOWS.find((s) => s.id === 'starter-recon')
    const loops = (recon?.graph.nodes ?? []).filter((n) => (n as { type: string }).type === 'loop') as Array<{ data: { max_items?: number } }>
    expect(loops.length).toBeGreaterThan(0)
    for (const loop of loops) expect(loop.data.max_items).toBeGreaterThan(0)
  })

  it('does not bring back a starter the user deleted', () => {
    const path = join(home, 'global.sqlite')
    const first = openGlobalDatabase(path)
    seedStarterWorkflows(first)
    const repo = new WorkflowRepository(first)
    for (const w of repo.list()) repo.remove(w.id)
    first.close()

    const again = openGlobalDatabase(path)
    expect(seedStarterWorkflows(again)).toBe(0)
    expect(new WorkflowRepository(again).list()).toHaveLength(0)
    again.close()
  })
})
