import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { useApp } from '../../../store.js'
import type { ToolInfo, ToolProbeBatchResponse, ToolProbeResult } from '../../../api/tools.js'
import type { BackendProfile } from '../../../api/backends.js'

const tool = (program: string, usedBy: string[]): ToolInfo => ({
  program,
  usedBy,
  install: { linux: `sudo apt install -y ${program}` },
})

const backend = (over: Partial<BackendProfile> = {}): BackendProfile => ({
  id: 'be-1',
  name: 'kali',
  kind: 'ssh',
  host: 'kali.lan',
  user: 'root',
  createdAt: '',
  updatedAt: '',
  ...over,
})

const tools = {
  list: vi.fn(() => Promise.resolve({ platform: 'linux', tools: [tool('nmap', ['Nmap']), tool('whois', ['Whois'])] })),
  probe: vi.fn((program: string) => Promise.resolve({ program, installed: true, version: `${program} 1.0` })),
  probeBatch: vi.fn(
    (programs: string[], backendId?: string): Promise<ToolProbeBatchResponse> =>
      Promise.resolve({
        backendId: backendId ?? 'local',
        results: programs.map((program): ToolProbeResult => ({ program, installed: false, version: null })),
      }),
  ),
}
const backends = { list: vi.fn(() => Promise.resolve([] as BackendProfile[])) }

vi.mock('../../../api/tools.js', () => ({ toolsApi: () => tools }))
vi.mock('../../../api/backends.js', () => ({ backendsApi: () => backends }))

const { ToolsSection } = await import('./ToolsSection.js')

beforeEach(() => {
  vi.clearAllMocks()
  tools.list.mockResolvedValue({ platform: 'linux', tools: [tool('nmap', ['Nmap']), tool('whois', ['Whois'])] })
  tools.probe.mockImplementation((program: string) =>
    Promise.resolve({ program, installed: true, version: `${program} 1.0` }),
  )
  tools.probeBatch.mockImplementation(
    (programs: string[], backendId?: string): Promise<ToolProbeBatchResponse> =>
      Promise.resolve({
        backendId: backendId ?? 'local',
        results: programs.map((program): ToolProbeResult => ({ program, installed: false, version: null })),
      }),
  )
  backends.list.mockResolvedValue([])
  useApp.setState({ client: {} as AxiosInstance })
})

describe('Settings → Tools', () => {
  it('shows no tab strip when this machine is the only connection', async () => {
    render(<ToolsSection />)
    expect(await screen.findByText('nmap')).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('probes this machine per tool so the badges resolve one by one', async () => {
    render(<ToolsSection />)
    await waitFor(() => expect(tools.probe).toHaveBeenCalledTimes(2))
    expect(tools.probe.mock.calls.map((c) => c[0])).toEqual(['nmap', 'whois'])
    expect(tools.probeBatch).not.toHaveBeenCalled()
    expect(await screen.findByText('nmap 1.0')).toBeTruthy()
  })

  it('shows one tab per saved connection alongside this machine', async () => {
    backends.list.mockResolvedValue([backend(), backend({ id: 'be-2', name: 'box', kind: 'docker', image: 'kali' })])
    render(<ToolsSection />)

    await screen.findByRole('tab', { name: /kali/i })
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['This machine', 'kali', 'box'])
  })

  it('probes a connection only when its tab is first opened, in ONE batched call', async () => {
    backends.list.mockResolvedValue([backend()])
    render(<ToolsSection />)

    const tab = await screen.findByRole('tab', { name: /kali/i })
    expect(tools.probeBatch).not.toHaveBeenCalled()

    fireEvent.click(tab)
    await waitFor(() => expect(tools.probeBatch).toHaveBeenCalledTimes(1))
    expect(tools.probeBatch).toHaveBeenCalledWith(['nmap', 'whois'], 'be-1')
  })

  it('caches a tab, so switching back does not probe the connection again', async () => {
    backends.list.mockResolvedValue([backend()])
    render(<ToolsSection />)

    fireEvent.click(await screen.findByRole('tab', { name: /kali/i }))
    await waitFor(() => expect(tools.probeBatch).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('tab', { name: 'This machine' }))
    fireEvent.click(screen.getByRole('tab', { name: /kali/i }))
    await waitFor(() => expect(screen.getAllByText('Missing').length).toBe(2))
    expect(tools.probeBatch).toHaveBeenCalledTimes(1)
  })

  it('reports an unreachable connection instead of a wall of missing tools', async () => {
    backends.list.mockResolvedValue([backend()])
    tools.probeBatch.mockResolvedValue({ backendId: 'be-1', results: [], error: 'No route to host' })
    render(<ToolsSection />)

    fireEvent.click(await screen.findByRole('tab', { name: /kali/i }))
    expect(await screen.findByText('Could not reach kali')).toBeTruthy()
    expect(screen.getByText('No route to host')).toBeTruthy()
    expect(screen.queryAllByText('Missing')).toEqual([])
    expect(screen.getAllByText('Unknown').length).toBe(2)
  })

  it('rechecks only the connection being viewed', async () => {
    backends.list.mockResolvedValue([backend()])
    render(<ToolsSection />)

    fireEvent.click(await screen.findByRole('tab', { name: /kali/i }))
    await waitFor(() => expect(tools.probeBatch).toHaveBeenCalledTimes(1))
    tools.probe.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /recheck/i }))
    await waitFor(() => expect(tools.probeBatch).toHaveBeenCalledTimes(2))
    expect(tools.probe).not.toHaveBeenCalled()
  })

  it('names the connection in the install modal, and drops "this machine" for a remote host', async () => {
    backends.list.mockResolvedValue([backend()])
    render(<ToolsSection />)

    fireEvent.click(await screen.findByRole('tab', { name: /kali/i }))
    const install = await screen.findAllByRole('button', { name: /install/i })
    fireEvent.click(install[0]!)

    expect(await screen.findByText('on kali (root@kali.lan)')).toBeTruthy()
    expect(screen.queryByText(/this machine\)/i)).toBeNull()
  })
})
