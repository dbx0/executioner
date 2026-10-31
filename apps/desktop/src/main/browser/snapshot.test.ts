import { describe, expect, it } from 'vitest'
import { renderFrames, renderSnapshot, type AXNode } from './snapshot'

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

  it('renders frame sections with targets and counts every frame toward the cap', () => {
    const main: AXNode[] = [node('1', 'RootWebArea', 'Home')]
    const inner: AXNode[] = [node('1', 'RootWebArea', 'In', { childIds: ['2'] }), node('2', 'button', 'Go', { parentId: '1' })]
    const snap = renderFrames(
      [{ nodes: main }, { nodes: inner, header: { url: 'http://f/', label: 'f1' }, sessionId: 'S1' }],
      2,
    )
    expect(snap.text.split('\n')).toEqual([
      '- RootWebArea "Home" [ref=g2e1]',
      '- frame "http://f/" [frame=f1]',
      '  - RootWebArea "In" [ref=g2e2]',
      '    - button "Go" [ref=g2e3]',
    ])
    expect(snap.refs.get('g2e1')).toEqual({ backendNodeId: 101 })
    expect(snap.refs.get('g2e3')).toEqual({ backendNodeId: 102, sessionId: 'S1' })

    const kids = Array.from({ length: 1999 }, (_, i) => String(i + 2))
    const big: AXNode[] = [node('1', 'list', 'big', { childIds: kids }), ...kids.map((id) => node(id, 'listitem', id, { parentId: '1' }))]
    const capped = renderFrames([{ nodes: big }, { nodes: inner, header: { url: 'http://f/', label: 'f1' } }], 1)
    const lines = capped.text.split('\n')
    expect(lines).toHaveLength(2001)
    expect(lines[2000]).toBe('… truncated')
  })
})
