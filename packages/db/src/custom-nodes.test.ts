import { beforeEach, describe, expect, it } from 'vitest'
import { toolManifestSchema, type ToolManifest } from '@exe/protocol'
import { openDatabase } from './index.js'
import { CustomNodeRepository } from './custom-nodes.js'

let repo: CustomNodeRepository

beforeEach(() => {
  const db = openDatabase(':memory:')
  repo = new CustomNodeRepository(db)
})

const def = (over: Partial<ToolManifest> = {}): ToolManifest =>
  toolManifestSchema.parse({
    id: 'my-scanner',
    name: 'My Scanner',
    description: 'a user-authored tool',
    category: 'custom',
    accepts: ['domain'],
    command: { program: 'echo', args: ['{{ target.value }}'] },
    emit: { parser: 'json' },
    ...over,
  })

describe('CustomNodeRepository', () => {
  it('creates, gets and lists a custom node', () => {
    const created = repo.create(def())
    expect(created.id).toBe('my-scanner')
    expect(repo.get('my-scanner')?.name).toBe('My Scanner')
    expect(repo.list()).toHaveLength(1)
    // The stored value round-trips as a valid ToolManifest.
    expect(repo.list()[0]?.command.program).toBe('echo')
  })

  it('updates an existing custom node, keeping the row id authoritative', () => {
    repo.create(def())
    const updated = repo.update('my-scanner', def({ id: 'ignored', name: 'Renamed' }))
    expect(updated?.id).toBe('my-scanner')
    expect(updated?.name).toBe('Renamed')
    expect(repo.get('my-scanner')?.name).toBe('Renamed')
  })

  it('returns undefined updating a node that does not exist', () => {
    expect(repo.update('nope', def())).toBeUndefined()
  })

  it('removes a custom node', () => {
    repo.create(def())
    repo.remove('my-scanner')
    expect(repo.get('my-scanner')).toBeUndefined()
  })

  it('rejects an invalid tool manifest definition', () => {
    expect(() => repo.create({ id: 'Bad Id', name: '' } as unknown as ToolManifest)).toThrow()
  })
})
