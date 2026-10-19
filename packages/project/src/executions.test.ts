import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from './index.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'exe-exec-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('project executions repository', () => {
  it('exposes an execution repository backed by the project database', () => {
    const project = createProject(root, { name: 'acme' })
    const target = project.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    const id = project.executions.create({ targetId: target.id, nodeId: 'subfinder' })
    expect(project.executions.get(id)?.status).toBe('running')
    project.close()
  })
})
