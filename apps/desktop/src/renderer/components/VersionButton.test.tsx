import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

const openWhatsNew = vi.fn()
vi.mock('../lib/whats-new.js', () => ({ openWhatsNew: () => openWhatsNew() }))

const { VersionButton } = await import('./VersionButton.js')

it('shows only the app version and opens the what\'s-new notes', () => {
  render(<VersionButton />)
  const button = screen.getByRole('button', { name: /Version 0\.0\.0/ })
  expect(button.textContent).toBe('v0.0.0-test')
  fireEvent.click(button)
  expect(openWhatsNew).toHaveBeenCalledOnce()
})
