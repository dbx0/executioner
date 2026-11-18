import { useState } from 'react'
import type { JSX } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { AxiosInstance } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { AssistantPanel } from './AssistantPanel.js'

// jsdom has no scrollTo; the panel scrolls its message list on every change.
Element.prototype.scrollTo = () => {}

const conversation = {
  id: 'conv-1',
  workflowId: 'wf-1',
  agent: 'claude',
  sessionId: null,
  createdAt: '',
  updatedAt: '',
}

const reply = {
  id: 'm-2',
  conversationId: 'conv-1',
  role: 'assistant',
  content: 'Built it.',
  proposal: null,
  createdAt: '',
}

function fakeClient(): { client: AxiosInstance; get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> } {
  const get = vi.fn().mockResolvedValue({ data: { conversation, messages: [] } })
  const post = vi.fn().mockResolvedValue({ data: { message: reply } })
  return { client: { get, post } as unknown as AxiosInstance, get, post }
}

/** Mirrors the editor: saving binds the id, which re-renders the panel with it. */
function Harness({
  client,
  onSave,
}: {
  client: AxiosInstance
  onSave: () => Promise<string | undefined>
}): JSX.Element {
  const [workflowId, setWorkflowId] = useState<string | undefined>()
  return (
    <AssistantPanel
      client={client}
      workflowId={workflowId}
      buildGraph={() => ({ nodes: [], edges: [] })}
      ensureSaved={async () => {
        const id = await onSave()
        setWorkflowId(id)
        return id
      }}
      onApply={() => {}}
      onClose={() => {}}
    />
  )
}

const type = (text: string): void => {
  fireEvent.change(screen.getByPlaceholderText(/Describe the workflow/), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

describe('AssistantPanel on an unsaved canvas', () => {
  it('offers the chat right away instead of asking to save first', () => {
    render(<Harness client={fakeClient().client} onSave={() => Promise.resolve('wf-1')} />)
    expect(screen.queryByText(/Save this workflow first/)).toBeNull()
    expect(screen.getByPlaceholderText(/Describe the workflow/)).toBeTruthy()
  })

  it('saves the workflow on the first message, then sends it on the new thread', async () => {
    const { client, get, post } = fakeClient()
    const onSave = vi.fn().mockResolvedValue('wf-1')
    render(<Harness client={client} onSave={onSave} />)

    type('recon for a domain')

    await waitFor(() => expect(screen.getByText('Built it.')).toBeTruthy())
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('/assistant/conversation', { params: { workflowId: 'wf-1', agent: 'claude' } })
    expect(post).toHaveBeenCalledWith(
      '/assistant/conversation/conv-1/message',
      expect.objectContaining({ text: 'recon for a domain' }),
    )
    // The typed message survives the id arriving mid-send.
    expect(screen.getByText('recon for a domain')).toBeTruthy()
  })

  it('keeps the thread when the saved id only reaches the panel after the send', async () => {
    // The editor binds the new id on a later render. If that render lands after
    // the send has finished opening the thread, loading the stored (empty)
    // thread again must not wipe what is on screen.
    const { client, get } = fakeClient()
    const props = {
      client,
      buildGraph: () => ({ nodes: [], edges: [] }),
      ensureSaved: () => Promise.resolve('wf-1'),
      onApply: () => {},
      onClose: () => {},
    }
    const { rerender } = render(<AssistantPanel {...props} workflowId={undefined} />)

    type('recon for a domain')
    await waitFor(() => expect(screen.getByText('Built it.')).toBeTruthy())

    rerender(<AssistantPanel {...props} workflowId="wf-1" />)
    await Promise.resolve()
    expect(get).toHaveBeenCalledTimes(1)
    expect(screen.getByText('recon for a domain')).toBeTruthy()
    expect(screen.getByText('Built it.')).toBeTruthy()
  })

  it('keeps the draft and reports it when the save fails', async () => {
    const { client, post } = fakeClient()
    render(<Harness client={client} onSave={() => Promise.reject(new Error('boom'))} />)

    type('recon for a domain')

    await waitFor(() => expect(screen.getByText(/Could not save the workflow/)).toBeTruthy())
    expect(post).not.toHaveBeenCalled()
    expect((screen.getByPlaceholderText(/Describe the workflow/) as HTMLTextAreaElement).value).toBe(
      'recon for a domain',
    )
  })
})
