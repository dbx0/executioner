import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, type Project } from '@exe/project'
import { resolveRunBackend } from './backend-profile.js'

let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exe-backend-'))
  project = createProject(dir, { name: 'test' })
})
afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('resolveRunBackend', () => {
  it('runs locally when no backend is named and no engagement default is set', () => {
    expect(resolveRunBackend(project, undefined)).toBeUndefined()
  })

  it("treats an explicit 'local' as local", () => {
    expect(resolveRunBackend(project, 'local')).toBeUndefined()
  })

  it('resolves a saved profile id to its profile', () => {
    const kali = project.backends.create({ name: 'kali', kind: 'ssh', host: 'kali.lan', user: 'root' })
    expect(resolveRunBackend(project, kali.id)?.id).toBe(kali.id)
  })

  it('errors on an unknown backend id rather than silently running locally', () => {
    expect(() => resolveRunBackend(project, 'nope')).toThrow(/unknown backend profile: nope/)
  })

  it('falls back to the engagement default profile id when none is named', () => {
    const kali = project.backends.create({ name: 'kali', kind: 'ssh', host: 'kali.lan', user: 'root' })
    project.config.defaultBackendProfileId = kali.id
    expect(resolveRunBackend(project, undefined)?.id).toBe(kali.id)
  })

  it('errors when the engagement default names a profile that no longer exists', () => {
    project.config.defaultBackendProfileId = 'gone'
    expect(() => resolveRunBackend(project, undefined)).toThrow(/unknown backend profile: gone/)
  })

  it('lets an explicit backend override the engagement default', () => {
    const kali = project.backends.create({ name: 'kali', kind: 'ssh', host: 'kali.lan', user: 'root' })
    project.config.defaultBackendProfileId = kali.id
    expect(resolveRunBackend(project, 'local')).toBeUndefined()
  })
})
