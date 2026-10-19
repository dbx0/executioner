import { describe, expect, it } from 'vitest'
import type { Target } from '@exe/protocol'
import { buildTargetTree } from './tree.js'

const t = (id: string, value: string, parentId: string | null): Target => ({
  id,
  kind: parentId === null ? 'domain' : 'subdomain',
  value,
  apex: null,
  parentId,
  source: 'test',
  scopeStatus: 'unknown',
  scopeReason: '',
  firstSeen: '2026-09-01T00:00:00.000Z',
  lastSeen: '2026-09-01T00:00:00.000Z',
})

describe('buildTargetTree', () => {
  it('returns an empty array for no targets', () => {
    expect(buildTargetTree([])).toEqual([])
  })

  it('nests children under their parent', () => {
    const tree = buildTargetTree([
      t('1', 'example.com', null),
      t('2', 'api.example.com', '1'),
      t('3', 'www.example.com', '1'),
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0]!.children.map((c) => c.value)).toEqual(['api.example.com', 'www.example.com'])
  })

  it('nests to arbitrary depth', () => {
    const tree = buildTargetTree([
      t('1', 'example.com', null),
      t('2', 'api.example.com', '1'),
      t('3', 'v2.api.example.com', '2'),
    ])
    expect(tree[0]!.children[0]!.children[0]!.value).toBe('v2.api.example.com')
  })

  it('promotes a target whose parent is missing to the root', () => {
    const tree = buildTargetTree([t('2', 'api.example.com', 'ghost')])
    expect(tree).toHaveLength(1)
    expect(tree[0]!.value).toBe('api.example.com')
  })

  it('does not hang on a cycle and drops the cycled nodes from the roots', () => {
    const tree = buildTargetTree([t('1', 'a.com', '2'), t('2', 'b.com', '1')])
    expect(tree).toEqual([])
  })

  it('treats a self-parent as a root instead of nesting it under itself', () => {
    const tree = buildTargetTree([t('1', 'volturion.com', '1')])
    expect(tree).toHaveLength(1)
    expect(tree[0]!.value).toBe('volturion.com')
    expect(tree[0]!.children).toEqual([])
  })
})
