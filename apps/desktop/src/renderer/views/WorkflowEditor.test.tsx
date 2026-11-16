import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
const nonemptyWorkflow = {
  ...existingWorkflow,
  graph: { nodes: [{ id: 'original', type: 'manual', data: {}, position: { x: 0, y: 0 } }], edges: [] },
}
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
    data: url === '/workflows/existing' ? nonemptyWorkflow : [],
  }))
  vi.spyOn(notify, 'success').mockImplementation(() => {})
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

async function openEditor(empty = false): Promise<void> {
  render(<WorkflowEditor workflowId={empty ? 'new' : existingWorkflow.id} onBack={() => {}} />)
  await screen.findByText(empty ? 'Untitled workflow' : existingWorkflow.name)
}

async function paste(text: string): Promise<void> {
  vi.stubGlobal('executioner', { clipboardRead: vi.fn().mockResolvedValue(text) })
  const button = screen.getByRole('button', { name: 'Paste workflow JSON' })
  button.focus()
  await act(async () => {
    fireEvent.click(button)
  })
}

describe('WorkflowEditor clipboard import', () => {
  it.each([0, 1, 2])('imports a %i-node graph directly into an empty canvas with neutral copy', async (count) => {
    const create = vi.spyOn(client, 'post').mockResolvedValue({ data: { id: 'created' } })
    const workflow = {
      ...importedWorkflow,
      graph: {
        nodes: Array.from({ length: count }, (_, index) => ({ ...importedWorkflow.graph.nodes[0]!, id: `node-${index}` })),
        edges: [],
      },
    }
    await openEditor(true)
    await paste('\uFEFF' + JSON.stringify(workflow))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(workflow.name)).toBeTruthy()
    expect(notify.success).toHaveBeenCalledWith('Workflow imported. Save to keep it.')
    expect(create).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(create).toHaveBeenCalledWith('/workflows', workflow)
  })

  it('requires confirmation before replacing a nonempty canvas and saves the captured clipboard as a new workflow', async () => {
    const create = vi.spyOn(client, 'post').mockResolvedValue({ data: { id: 'created' } })
    const update = vi.spyOn(client, 'put')
    await openEditor()
    await paste(JSON.stringify(importedWorkflow))

    expect(screen.getByRole('dialog', { name: 'Replace current workflow?' })).toBeTruthy()
    expect(screen.getByText(existingWorkflow.name)).toBeTruthy()
    expect(screen.queryByText(importedWorkflow.name)).toBeNull()
    expect(notify.success).not.toHaveBeenCalled()
    vi.mocked(window.executioner.clipboardRead).mockResolvedValue('changed clipboard')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Replace workflow' }))
    })

    expect(window.executioner.clipboardRead).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(importedWorkflow.name)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(create).toHaveBeenCalledWith('/workflows', importedWorkflow)
    expect(update).not.toHaveBeenCalled()
  })

  it('preserves unsaved edits, the graph and workflow identity when cancelled', async () => {
    const update = vi.spyOn(client, 'put').mockResolvedValue({ data: {} })
    const create = vi.spyOn(client, 'post')
    await openEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Rename workflow' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Workflow name' }), { target: { value: 'Unsaved name' } })
    fireEvent.blur(screen.getByRole('textbox', { name: 'Workflow name' }))
    await paste(JSON.stringify(importedWorkflow))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    })

    expect(screen.getByText('Unsaved name')).toBeTruthy()
    expect(notify.success).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(update).toHaveBeenCalledWith('/workflows/existing', { name: 'Unsaved name', graph: nonemptyWorkflow.graph })
    expect(create).not.toHaveBeenCalled()
  })

  it('focuses Cancel, dismisses with Escape and restores focus to the paste button', async () => {
    await openEditor()
    await paste(JSON.stringify(importedWorkflow))

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Paste workflow JSON' })))
    expect(screen.getByText(existingWorkflow.name)).toBeTruthy()
  })

  it('confirms before an empty imported workflow replaces a nonempty canvas', async () => {
    await openEditor()
    await paste(JSON.stringify({ name: 'Empty workflow', graph: { nodes: [], edges: [] } }))

    expect(screen.getByRole('dialog')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Replace workflow' }))
    })
    expect(screen.getByText('Empty workflow')).toBeTruthy()
    expect(notify.success).toHaveBeenCalledWith('Workflow imported. Save to keep it.')
  })

  it('reports invalid clipboard JSON and leaves the open workflow in place', async () => {
    const error = vi.spyOn(notify, 'error').mockImplementation(() => {})
    await openEditor()
    await paste('plain text')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Import failed\./))
    expect(screen.getByText(existingWorkflow.name)).toBeTruthy()
  })
})
