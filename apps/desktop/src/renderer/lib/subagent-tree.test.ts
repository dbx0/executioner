import { describe, expect, it } from 'vitest'
import { buildSubagentTree, subtreeHasWorking, anySubtreeWorking } from './subagent-tree.js'
import type { Subagent } from '../store.js'

describe('subagent-tree — recursive lineage derivation', () => {
  it('builds a multi-level tree from the flat parentId-linked list', () => {
    const list: Subagent[] = [
      { id: 'a', description: 'lead child', state: 'done' },
      { id: 'b', description: 'sub of a', state: 'done', parentId: 'a' },
      { id: 'c', description: 'sub of b', state: 'working', parentId: 'b' },
      { id: 'd', description: 'another lead child', state: 'working' },
    ]
    const tree = buildSubagentTree(list)
    expect(tree.map((n) => n.id)).toEqual(['a', 'd'])
    const a = tree[0]!
    expect(a.children.map((n) => n.id)).toEqual(['b'])
    expect(a.children[0]!.children.map((n) => n.id)).toEqual(['c'])
  })

  it('a working descendant keeps every ancestor working', () => {
    const list: Subagent[] = [
      { id: 'a', description: 'lead child', state: 'done' },
      { id: 'b', description: 'sub of a', state: 'done', parentId: 'a' },
      { id: 'c', description: 'deep worker', state: 'working', parentId: 'b' },
    ]
    const [a] = buildSubagentTree(list)
    // a and b are 'done' themselves, but c (a descendant) is working.
    expect(subtreeHasWorking(a!)).toBe(true)
    expect(anySubtreeWorking(buildSubagentTree(list))).toBe(true)
  })

  it('reports settled when no node in the tree is working', () => {
    const list: Subagent[] = [
      { id: 'a', description: 'x', state: 'done' },
      { id: 'b', description: 'y', state: 'done', parentId: 'a' },
    ]
    expect(anySubtreeWorking(buildSubagentTree(list))).toBe(false)
  })

  it('surfaces an orphan (parent already reaped) as a root rather than dropping it', () => {
    const list: Subagent[] = [{ id: 'c', description: 'orphan', state: 'working', parentId: 'gone' }]
    const tree = buildSubagentTree(list)
    expect(tree.map((n) => n.id)).toEqual(['c'])
  })
})
