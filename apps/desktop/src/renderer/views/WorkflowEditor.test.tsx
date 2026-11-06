import { act, fireEvent, render, screen } from '@testing-library/react'
import axios from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Graph } from '../lib/graph-types.js'
import { notify } from '../lib/toast.js'
import { useApp } from '../store.js'
import { WorkflowEditor } from './WorkflowEditor.js'

vi.mock('../lib/events.js', () => {
  const events: never[] = []
  return { useEngineEvents: () => events }
})

const existingWorkflow = { id: 'existing', name: 'Existing workflow', graph: { nodes: [], edges: [] } }
const importedWorkflow = {
  name: 'Pasted workflow',
  graph: {
    nodes: [{ id: 'start', type: 'manual', data: {}, position: { x: 20, y: 40 } }],
    edges: [],
  } satisfies Graph,
}

const client = axios.create()

beforeEach(() => {
  vi.spyOn(client, 'get').mockImplementation(async (url) => ({
    data: url === '/workflows/existing' ? existingWorkflow : [],
  }))
  useApp.setState({
    client,
    connection: { port: 4599, token: 'test', projectRoot: '/tmp/workflow-editor' },
  })
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function paste(text: string): Promise<void> {
  vi.stubGlobal('executioner', { clipboardRead: vi.fn().mockResolvedValue(text) })
  render(<WorkflowEditor workflowId={existingWorkflow.id} onBack={() => {}} />)
  await screen.findByText(existingWorkflow.name)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Paste workflow JSON' }))
  })
}

describe('WorkflowEditor clipboard import', () => {
  it('loads pasted workflow JSON and saves it as a new workflow', async () => {
    const create = vi.spyOn(client, 'post').mockResolvedValue({ data: { id: 'created' } })
    const update = vi.spyOn(client, 'put')
    await paste(JSON.stringify(importedWorkflow))

    expect(screen.getByText(importedWorkflow.name)).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(create).toHaveBeenCalledWith('/workflows', importedWorkflow)
    expect(update).not.toHaveBeenCalled()
  })

  it('reports invalid clipboard JSON and leaves the open workflow in place', async () => {
    const error = vi.spyOn(notify, 'error').mockImplementation(() => {})
    await paste('plain text')

    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Import failed\./))
    expect(screen.getByText(existingWorkflow.name)).toBeTruthy()
  })
})
