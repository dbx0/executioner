import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { useApp } from '../../store.js'
import type { ProjectMeta } from '../../api/project.js'

const backendsList = vi.fn(() =>
  Promise.resolve([{ id: 'kali-1', name: 'kali box', kind: 'ssh', createdAt: '', updatedAt: '' }]),
)
vi.mock('../../api/backends.js', () => ({
  backendsApi: () => ({ list: backendsList, remove: vi.fn() }),
}))

const projectGet = vi.fn<() => Promise<ProjectMeta>>(() =>
  Promise.resolve({ root: '/r', name: 'acme', icon: null, defaultBackendProfileId: null }),
)
const projectUpdate = vi.fn(() => Promise.resolve({} as ProjectMeta))
vi.mock('../../api/project.js', () => ({
  projectApi: () => ({ get: projectGet, update: projectUpdate }),
}))

const { ConnectionsSection } = await import('./ConnectionsSection.js')

beforeEach(() => {
  vi.clearAllMocks()
  useApp.setState({ client: {} as AxiosInstance, connection: { port: 61337 } as never })
  projectGet.mockResolvedValue({ root: '/r', name: 'acme', icon: null, defaultBackendProfileId: null })
})

describe('ConnectionsSection default backend', () => {
  it('offers a default-backend selector that reads Local when none is set', async () => {
    render(<ConnectionsSection />)
    const picker = await screen.findByLabelText('Default backend')
    expect(picker.getAttribute('role')).toBe('combobox')
    expect(picker.textContent).toMatch(/local/i)
  })

  it('reflects the saved default profile by name', async () => {
    projectGet.mockResolvedValue({ root: '/r', name: 'acme', icon: null, defaultBackendProfileId: 'kali-1' })
    render(<ConnectionsSection />)
    const picker = await screen.findByLabelText('Default backend')
    await waitFor(() => expect(picker.textContent).toMatch(/kali box/))
  })
})
