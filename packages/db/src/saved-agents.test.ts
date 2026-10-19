import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type ProjectDatabase } from './index.js'
import { SavedAgentRepository } from './saved-agents.js'

let db: ProjectDatabase
let repo: SavedAgentRepository

beforeEach(() => {
  db = openDatabase(':memory:')
  repo = new SavedAgentRepository(db)
})

describe('SavedAgentRepository', () => {
  it('creates and gets a local agent with defaults', () => {
    const a = repo.create({ name: 'Recon', agent: 'claude', prompt: 'do recon' })
    expect(a.name).toBe('Recon')
    expect(a.scope).toBe('local')
    expect(a.model).toBeUndefined()
    expect(a.tools).toBeUndefined()
    expect(repo.get(a.id)?.prompt).toBe('do recon')
  })

  it('round-trips model and tools', () => {
    const a = repo.create({
      name: 'Auditor',
      description: 'code audit',
      agent: 'claude',
      prompt: 'audit',
      model: 'opus',
      tools: ['Read', 'Grep'],
    })
    const got = repo.get(a.id)!
    expect(got.model).toBe('opus')
    expect(got.tools).toEqual(['Read', 'Grep'])
    expect(got.description).toBe('code audit')
  })

  it('lists agents in creation order', () => {
    repo.create({ name: 'a', agent: 'claude', prompt: 'p' })
    repo.create({ name: 'b', agent: 'codex', prompt: 'p' })
    expect(repo.list().map((x) => x.name)).toEqual(['a', 'b'])
  })

  it('updates an agent and clears empty optionals', () => {
    const a = repo.create({ name: 'x', agent: 'claude', prompt: 'p', model: 'opus', tools: ['Read'] })
    const updated = repo.update(a.id, { name: 'y', agent: 'claude', prompt: 'p2' })
    expect(updated?.name).toBe('y')
    expect(updated?.prompt).toBe('p2')
    expect(updated?.model).toBeUndefined()
    expect(updated?.tools).toBeUndefined()
  })

  it('returns undefined updating a missing agent', () => {
    expect(repo.update('nope', { name: 'x', agent: 'claude', prompt: 'p' })).toBeUndefined()
  })

  it('removes an agent', () => {
    const a = repo.create({ name: 'x', agent: 'claude', prompt: 'p' })
    repo.remove(a.id)
    expect(repo.get(a.id)).toBeUndefined()
  })

  it('creates a team: id-qualifies a bare claude-team and round-trips members', () => {
    const t = repo.create({
      name: 'Recon & Strike',
      agent: 'claude-team',
      prompt: 'lead the team',
      members: [
        { name: 'recon', description: 'enumerate', prompt: 'do recon', tools: ['Read'] },
        { name: 'reporter', description: 'report', prompt: 'write up', model: 'haiku' },
      ],
    })
    // A bare claude-team gains a unique id suffix so the launch can find it.
    expect(t.agent).toBe(`claude-team:${t.id}`)
    const got = repo.get(t.id)!
    expect(got.members?.map((m) => m.name)).toEqual(['recon', 'reporter'])
    expect(got.members?.[0]?.tools).toEqual(['Read'])
    expect(got.members?.[1]?.model).toBe('haiku')
  })

  it('keeps a team agent string stable across updates', () => {
    const t = repo.create({ name: 'T', agent: 'claude-team', prompt: 'p', members: [{ name: 'a', description: 'd', prompt: 'pp' }] })
    const updated = repo.update(t.id, {
      name: 'T2',
      agent: 'claude-team',
      prompt: 'p',
      members: [{ name: 'a', description: 'd', prompt: 'pp' }, { name: 'b', description: 'd2', prompt: 'pp2' }],
    })
    expect(updated?.agent).toBe(t.agent)
    expect(updated?.members?.map((m) => m.name)).toEqual(['a', 'b'])
  })
})
