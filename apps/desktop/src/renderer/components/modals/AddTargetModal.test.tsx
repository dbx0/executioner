import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { AddTargetModal } from './AddTargetModal.js'

const create = vi.fn()

vi.mock('../../api/targets.js', () => ({
  targetsApi: () => ({ create }),
}))

beforeEach(() => {
  create.mockReset()
  create.mockResolvedValue({})
})

const open = (): { onCreated: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } => {
  const onCreated = vi.fn()
  const onClose = vi.fn()
  render(<AddTargetModal client={{} as AxiosInstance} onClose={onClose} onCreated={onCreated} />)
  return { onCreated, onClose }
}

const type = (value: string): void => {
  fireEvent.change(screen.getByLabelText(/value/i), { target: { value } })
}

describe('AddTargetModal', () => {
  it('adds a target that is fine', async () => {
    const { onCreated } = open()
    type('bmw.com')
    fireEvent.click(screen.getByRole('button', { name: /add target/i }))

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ value: 'bmw.com' })))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
  })

  it('shows the reason the engine refused a wildcard, not the status code', async () => {
    // What the operator used to see for *.bmw.com was a 500 and, once that was
    // fixed, "Request failed with status code 400" — neither says what to do.
    create.mockRejectedValue({
      message: 'Request failed with status code 400',
      response: {
        status: 400,
        data: { error: '"*.bmw.com" is a wildcard: add it as a scope rule, not an asset' },
      },
    })

    open()
    type('*.bmw.com')
    fireEvent.click(screen.getByRole('button', { name: /add target/i }))

    expect(await screen.findByText(/is a wildcard: add it as a scope rule/i)).toBeTruthy()
  })

  it('keeps the modal open so the value can be corrected', async () => {
    create.mockRejectedValue({ message: 'boom', response: { data: { error: 'nope' } } })
    const { onClose } = open()
    type('*.bmw.com')
    fireEvent.click(screen.getByRole('button', { name: /add target/i }))

    await screen.findByText('nope')
    expect(onClose).not.toHaveBeenCalled()
  })
})
