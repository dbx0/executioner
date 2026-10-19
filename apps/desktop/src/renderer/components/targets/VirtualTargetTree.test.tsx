import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TargetNode } from '../../api/targets.js'
import { VirtualTargetTree, flattenTree } from './VirtualTargetTree.js'

afterEach(cleanup)

function node(id: string, value: string, children: TargetNode[] = []): TargetNode {
  return {
    id,
    kind: 'domain',
    value,
    apex: null,
    parentId: null,
    source: 'manual',
    scopeStatus: 'in',
    scopeReason: '',
    children,
  }
}

const domain = node('d1', 'example.com', [
  node('s1', 'a.example.com'),
  node('s2', 'b.example.com'),
])

describe('flattenTree', () => {
  it('yields a single row when the parent is collapsed', () => {
    const rows = flattenTree([domain], new Set())
    expect(rows.length).toBe(1)
    const r0 = rows[0]!
    expect(r0.node.id).toBe('d1')
    expect(r0.depth).toBe(0)
    expect(r0.hasChildren).toBe(true)
    expect(r0.expanded).toBe(false)
  })

  it('yields parent + children with correct depths when expanded', () => {
    const rows = flattenTree([domain], new Set(['d1']))
    expect(rows.length).toBe(3)
    expect(rows.map((r) => r.node.id)).toEqual(['d1', 's1', 's2'])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1])
    expect(rows.map((r) => r.hasChildren)).toEqual([true, false, false])
    expect(rows.map((r) => r.expanded)).toEqual([true, false, false])
  })

  it('does not recurse past a collapsed intermediate node', () => {
    const deep = node('r', 'root', [node('m', 'mid', [node('leaf', 'leaf')])])
    // root expanded, mid collapsed -> root + mid only
    const rows = flattenTree([deep], new Set(['r']))
    expect(rows.map((r) => r.node.id)).toEqual(['r', 'm'])
  })
})

describe('VirtualTargetTree', () => {
  it('renders the root value', () => {
    render(<VirtualTargetTree nodes={[domain]} selectedId={null} onSelect={() => {}} filter="" />)
    expect(screen.getByText('example.com')).toBeTruthy()
  })

  it('renders children by default (expanded) and toggles on click', () => {
    render(<VirtualTargetTree nodes={[domain]} selectedId={null} onSelect={() => {}} filter="" />)
    // Default expanded -> children visible.
    expect(screen.queryByText('a.example.com')).toBeTruthy()
    // Clicking the parent collapses it.
    fireEvent.click(screen.getByText('example.com'))
    expect(screen.queryByText('a.example.com')).toBeNull()
    // Clicking again re-expands.
    fireEvent.click(screen.getByText('example.com'))
    expect(screen.queryByText('a.example.com')).toBeTruthy()
  })

  it('invokes onSelect with the clicked node', () => {
    let picked: string | null = null
    render(
      <VirtualTargetTree
        nodes={[domain]}
        selectedId={null}
        onSelect={(n) => {
          picked = n.id
        }}
        filter=""
      />,
    )
    fireEvent.click(screen.getByText('a.example.com'))
    expect(picked).toBe('s1')
  })
})

describe('VirtualTargetTree — row wrapping', () => {
  it('wraps every row so a caller can attach a menu to it', () => {
    const wrapped: string[] = []
    render(
      <VirtualTargetTree
        nodes={[domain]}
        selectedId={null}
        onSelect={() => {}}
        filter=""
        renderRow={(node, row) => {
          wrapped.push(node.value)
          return <div data-wrapped={node.value}>{row}</div>
        }}
      />,
    )

    expect(wrapped).toEqual(['example.com', 'a.example.com', 'b.example.com'])
  })

  it('renders rows unwrapped when no wrapper is given', () => {
    render(<VirtualTargetTree nodes={[domain]} selectedId={null} onSelect={() => {}} filter="" />)
    expect(screen.getByText('example.com')).toBeTruthy()
  })

  it('leaves the right-click to the wrapper rather than handling it itself', () => {
    // The tree used to select the row on right-click, which swung the detail
    // pane open. Opening a menu is the menu's business now, and nothing else's.
    const onSelect = vi.fn()
    render(
      <VirtualTargetTree
        nodes={[domain]}
        selectedId={null}
        onSelect={onSelect}
        filter=""
        renderRow={(_node, row) => row}
      />,
    )

    fireEvent.contextMenu(screen.getByText('a.example.com'))

    expect(onSelect).not.toHaveBeenCalled()
  })
})
