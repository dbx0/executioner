import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NodeProps } from 'reactflow'

const updateNodeInternals = vi.fn()

vi.mock('reactflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('reactflow')>()),
  useUpdateNodeInternals: () => updateNodeInternals,
}))

const { ReactFlowProvider } = await import('reactflow')
const { NewNodeIdsContext, ToolNode } = await import('./GraphNodes.js')
type Data = import('./GraphNodes.js').GraphNodeData

function renderNode(newIds: ReadonlySet<string>): HTMLElement {
  const props = { id: 'n1', data: { label: 'httpx', category: 'web' }, selected: false } as unknown as NodeProps<Data>
  const { container } = render(
    <ReactFlowProvider>
      <NewNodeIdsContext.Provider value={newIds}>
        <ToolNode {...props} />
      </NewNodeIdsContext.Provider>
    </ReactFlowProvider>,
  )
  return container.firstElementChild as HTMLElement
}

describe('GraphNodes', () => {
  it('re-measures a new node once its enter animation ends, so handles line up', () => {
    const wrapper = renderNode(new Set(['n1']))
    expect(wrapper.className).toContain('animate-node-in')

    // jsdom has no AnimationEvent, so React listens for the prefixed name there.
    fireEvent(wrapper, new Event('webkitAnimationEnd', { bubbles: true }))

    expect(updateNodeInternals).toHaveBeenCalledWith('n1')
  })
})
