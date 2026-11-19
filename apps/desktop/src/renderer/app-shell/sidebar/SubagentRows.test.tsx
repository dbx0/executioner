import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SubagentNode } from '../../lib/subagent-tree.js'

const working = new Set<string>()
vi.mock('../../lib/subagent-tree.js', () => ({
  subtreeHasWorking: (node: SubagentNode) => working.has(node.id),
}))

const { SubagentNodeRow } = await import('./SubagentRows.js')

const node = (id: string): SubagentNode => ({ id, description: `task ${id}`, children: [] }) as unknown as SubagentNode

describe('SubagentNodeRow', () => {
  it('marks a finished sub-agent with a labelled check instead of the word', () => {
    working.clear()
    render(<SubagentNodeRow node={node('a')} />)
    expect(screen.getByRole('img', { name: 'Done' })).toBeTruthy()
    expect(screen.queryByText(/done/i)).toBeNull()
    expect(screen.queryByLabelText('working')).toBeNull()
  })

  it('shows the working dot, not the check, while it runs', () => {
    working.add('b')
    render(<SubagentNodeRow node={node('b')} />)
    expect(screen.getByLabelText('working')).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'Done' })).toBeNull()
  })
})
