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
