import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ScopeBadge, filterTreeByScope } from './ScopeBadge.js'
import type { TargetNode } from '../../api/targets.js'

const node = (
  id: string,
  value: string,
  scopeStatus: 'in' | 'out' | 'unknown',
  children: TargetNode[] = [],
): TargetNode => ({
  id,
  kind: 'subdomain',
  value,
  apex: null,
  parentId: null,
  source: 'agent',
  scopeStatus,
  scopeReason: `because ${value}`,
  children,
})

describe('ScopeBadge', () => {
  it('says nothing for an asset that is plainly in scope', () => {
    const { container } = render(<ScopeBadge status="in" reason="in scope by *.smartfit.com.br" />)
    // An in-scope asset is the normal case; a badge on every row would be noise.
    expect(container.textContent).toBe('')
  })

  it('flags an asset no rule covers, and says so in words', () => {
    render(<ScopeBadge status="unknown" reason="no scope rule matches appsync-api.amazonaws.com" />)
    const badge = screen.getByLabelText(/no scope rule matches appsync-api/i)
    expect(badge.textContent).toMatch(/unscoped/i)
  })

  it('flags an excluded asset distinctly from an unknown one', () => {
    render(<ScopeBadge status="out" reason="excluded by smartfit.io (parked)" />)
    const badge = screen.getByLabelText(/excluded by smartfit.io/i)
    expect(badge.textContent).toMatch(/out of scope/i)
  })
})

describe('filterTreeByScope', () => {
  const tree: TargetNode[] = [
    node('a', 'smartfit.com.br', 'in', [node('b', 'app.smartfit.com.br', 'in')]),
    node('c', 'appsync-api.amazonaws.com', 'unknown'),
    node('d', 'smartfit.io', 'out'),
  ]

  it('shows everything by default', () => {
    expect(filterTreeByScope(tree, 'all').map((n) => n.id)).toEqual(['a', 'c', 'd'])
  })

  it('narrows to what the boundary covers', () => {
    const filtered = filterTreeByScope(tree, 'in')
    expect(filtered.map((n) => n.id)).toEqual(['a'])
    expect(filtered[0]?.children.map((n) => n.id)).toEqual(['b'])
  })

  it('narrows to the assets that need a decision', () => {
    expect(filterTreeByScope(tree, 'unknown').map((n) => n.id)).toEqual(['c'])
  })

  it('narrows to what has been ruled out', () => {
    expect(filterTreeByScope(tree, 'out').map((n) => n.id)).toEqual(['d'])
  })

  it('keeps a parent whose child matches, so the match stays reachable', () => {
    const mixed: TargetNode[] = [node('a', 'smartfit.com.br', 'in', [node('b', 'stray.smartfit.com.br', 'unknown')])]
    const filtered = filterTreeByScope(mixed, 'unknown')
    expect(filtered.map((n) => n.id)).toEqual(['a'])
    expect(filtered[0]?.children.map((n) => n.id)).toEqual(['b'])
  })
})
