import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { useApp } from '../../store.js'
import type { DirListing, FileEntry } from '../../api/files.js'

const listings: Record<string, FileEntry[]> = {
  '': [
    { name: 'src', type: 'dir' },
    { name: 'readme.md', type: 'file' },
  ],
  src: [{ name: 'index.ts', type: 'file' }],
}

const list = vi.fn(
  (path?: string): Promise<DirListing> =>
    Promise.resolve({ path: path ?? '', entries: listings[path ?? ''] ?? [] }),
)
const fakeApi = { list }
vi.mock('../../api/files.js', () => ({ filesApi: () => fakeApi }))

const { FileExplorer } = await import('./FileExplorer.js')

describe('FileExplorer', () => {
  beforeEach(() => {
    list.mockClear()
    useApp.setState({ client: {} as AxiosInstance })
  })

  it('keeps expanded folders open across a refresh', async () => {
    render(<FileExplorer />)

    // Expand the "src" folder and wait for its child to appear.
    fireEvent.click(await screen.findByText('src'))
    await waitFor(() => expect(screen.getByText('index.ts')).toBeTruthy())

    // Refresh the explorer.
    fireEvent.click(screen.getByRole('button', { name: /refresh explorer/i }))

    // The folder stays expanded: its child is still shown after the refresh.
    await waitFor(() => expect(screen.getByText('index.ts')).toBeTruthy())
    expect(screen.getByText('readme.md')).toBeTruthy()
  })
})
