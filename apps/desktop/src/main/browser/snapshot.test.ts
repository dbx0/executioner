import { describe, expect, it } from 'vitest'
import { renderSnapshot, type AXNode } from './snapshot'

const node = (nodeId: string, role: string, name: string, extra: Partial<AXNode> = {}): AXNode => ({
  nodeId,
  role: { value: role },
  name: { value: name },
  backendDOMNodeId: Number(nodeId) + 100,
  ...extra,
})

describe('renderSnapshot', () => {
  it('renders roles and names with refs and skips ignored nodes', () => {
    const nodes: AXNode[] = [
      node('1', 'RootWebArea', 'Home', { childIds: ['2', '3', '5'] }),
      node('2', 'button', 'Sign in', { parentId: '1' }),
      node('3', 'none', '', { parentId: '1', childIds: ['4'] }),
      node('4', 'link', 'Docs', { parentId: '3' }),
      node('5', 'text', 'hidden', { parentId: '1', ignored: true }),
    ]
    const snap = renderSnapshot(nodes, 3)
    expect(snap.generation).toBe(3)
    expect(snap.text.split('\n')).toEqual([
      '- RootWebArea "Home" [ref=g3e1]',
      '  - button "Sign in" [ref=g3e2]',
      '  - link "Docs" [ref=g3e3]',
    ])
    expect(snap.refs.get('g3e2')).toBe(102)
    expect(snap.refs.get('g3e3')).toBe(104)
    expect(snap.refs.size).toBe(3)
  })

  it('truncates after 2000 lines', () => {
    const kids = Array.from({ length: 2500 }, (_, i) => String(i + 2))
    const nodes: AXNode[] = [
      node('1', 'list', 'big', { childIds: kids }),
      ...kids.map((id) => node(id, 'listitem', `item ${id}`, { parentId: '1' })),
    ]
    const lines = renderSnapshot(nodes, 1).text.split('\n')
    expect(lines).toHaveLength(2001)
    expect(lines[2000]).toBe('… truncated')
  })
})
