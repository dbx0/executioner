import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RunWorkflowModal } from './RunWorkflowModal.js'
import { useApp } from '../../store.js'
import * as targets from '../../api/targets.js'
import * as backends from '../../api/backends.js'
import * as executions from '../../api/executions.js'

const TARGETS = [{ id: 't1', kind: 'domain', value: 'example.com' }]
const PROFILES = [
  { id: 'b1', name: 'kali box', kind: 'ssh', createdAt: '', updatedAt: '' },
  { id: 'b2', name: 'scanbox', kind: 'docker', createdAt: '', updatedAt: '' },
]

function stubApis(): { runWorkflow: ReturnType<typeof vi.fn> } {
  const runWorkflow = vi.fn().mockResolvedValue({ executionId: 'e1' })
  vi.spyOn(targets, 'targetsApi').mockReturnValue({
    list: vi.fn().mockResolvedValue(TARGETS),
  } as unknown as ReturnType<typeof targets.targetsApi>)
  vi.spyOn(backends, 'backendsApi').mockReturnValue({
    list: vi.fn().mockResolvedValue(PROFILES),
  } as unknown as ReturnType<typeof backends.backendsApi>)
  vi.spyOn(executions, 'executionsApi').mockReturnValue({
    runWorkflow,
  } as unknown as ReturnType<typeof executions.executionsApi>)
  return { runWorkflow }
}

/** Select the target, then fire Run. */
async function pickTargetAndRun(): Promise<void> {
  await waitFor(() => expect(screen.getByText('example.com')).toBeTruthy())
  fireEvent.click(screen.getByText('example.com'))
  fireEvent.click(screen.getByRole('button', { name: /^run$/i }))
}

describe('RunWorkflowModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    useApp.setState({ client: {} as never, activeRoot: '/tmp/eng' })
  })

  it('offers the saved backends alongside the local machine', async () => {
    stubApis()
    render(<RunWorkflowModal workflowId="w1" name="recon" onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Run on')).toBeTruthy())
    expect(screen.getByText('Local machine')).toBeTruthy()
  })

  it('sends the chosen backend, so the run does not silently fall back to local', async () => {
    const { runWorkflow } = stubApis()
    localStorage.setItem('exe.runBackend:/tmp/eng', 'b1')
    render(<RunWorkflowModal workflowId="w1" name="recon" onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('example.com')).toBeTruthy())
    await pickTargetAndRun()

    expect(runWorkflow).toHaveBeenCalledWith('w1', { targetId: 't1', backendProfileId: 'b1' })
  })

  it('omits the backend entirely when running locally', async () => {
    const { runWorkflow } = stubApis()
    render(<RunWorkflowModal workflowId="w1" name="recon" onClose={vi.fn()} />)
    await pickTargetAndRun()

    expect(runWorkflow).toHaveBeenCalledWith('w1', { targetId: 't1' })
  })

  it('falls back to local when the remembered backend no longer exists', async () => {
    const { runWorkflow } = stubApis()
    localStorage.setItem('exe.runBackend:/tmp/eng', 'deleted-profile')
    render(<RunWorkflowModal workflowId="w1" name="recon" onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Local machine')).toBeTruthy())
    await pickTargetAndRun()

    expect(runWorkflow).toHaveBeenCalledWith('w1', { targetId: 't1' })
  })
})
