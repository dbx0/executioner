import { mkdtempSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, openProject, isProjectFolder } from './index.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-project-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('createProject', () => {
  it('lays out the engagement folder', () => {
    const project = createProject(dir, { name: 'acme-2026' })
    expect(existsSync(join(dir, '.executioner', 'project.sqlite'))).toBe(true)
    expect(existsSync(join(dir, '.executioner', 'config.json'))).toBe(true)
    expect(existsSync(join(dir, 'workflows'))).toBe(true)
    expect(existsSync(join(dir, 'evidence'))).toBe(true)
    expect(project.config.name).toBe('acme-2026')
    expect(project.config.defaultBackend).toBe('local')
    project.close()
  })

  it('refuses to create over an existing project', () => {
    createProject(dir, { name: 'a' }).close()
    expect(() => createProject(dir, { name: 'b' })).toThrow(/already an Executioner project/)
  })
})

describe('openProject', () => {
  it('opens a project created earlier and sees its targets', () => {
    const created = createProject(dir, { name: 'acme' })
    created.targets.upsert({ kind: 'domain', value: 'example.com', source: 'manual' })
    created.close()

    const reopened = openProject(dir)
    expect(reopened.targets.all()).toHaveLength(1)
    expect(reopened.config.name).toBe('acme')
    reopened.close()
  })

  it('refuses to open a folder that is not a project', () => {
    expect(() => openProject(dir)).toThrow(/not an Executioner project/)
  })

  it('reports a corrupt config clearly rather than crashing on a type error', () => {
    createProject(dir, { name: 'a' }).close()
    writeFileSync(join(dir, '.executioner', 'config.json'), '{"name": 42}')
    expect(() => openProject(dir)).toThrow(/config.json is invalid/)
  })
})

describe('isProjectFolder', () => {
  it('is false for an empty directory and true after creation', () => {
    expect(isProjectFolder(dir)).toBe(false)
    createProject(dir, { name: 'a' }).close()
    expect(isProjectFolder(dir)).toBe(true)
  })
})

describe('evidence paths', () => {
  it('gives each execution its own directory under evidence', () => {
    const project = createProject(dir, { name: 'a' })
    const path = project.evidenceDir('exec-123')
    expect(path).toBe(join(dir, 'evidence', 'exec-123'))
    expect(existsSync(path)).toBe(true)
    project.close()
  })
})
