import type { AxiosInstance } from 'axios'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SecretsSection } from './SecretsSection.js'

afterEach(() => vi.unstubAllGlobals())

describe('SecretsSection', () => {
  it('asks main to refresh the log masks once after a save', async () => {
    const refreshMasks = vi.fn()
    vi.stubGlobal('window', Object.assign(window, {
      executioner: { log: { write: vi.fn(), refreshMasks, getVerbose: () => Promise.resolve(false), onLevel: () => () => {} } },
    }))
    const client = {
      get: vi.fn().mockResolvedValue({ data: [] }),
      put: vi.fn().mockResolvedValue({ data: {} }),
    } as unknown as AxiosInstance
    render(<SecretsSection client={client} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Set key' })[0]!)
    fireEvent.change(document.querySelector('input[type="password"]')!, { target: { value: 'abc123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(refreshMasks).toHaveBeenCalledTimes(1))
    expect(client.put).toHaveBeenCalledTimes(1)
  })
})
