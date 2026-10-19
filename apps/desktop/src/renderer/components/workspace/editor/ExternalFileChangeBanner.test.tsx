import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ExternalFileChangeBanner } from './ExternalFileChangeBanner.js'

describe('ExternalFileChangeBanner', () => {
  it('offers all three recoveries for a changed file', () => {
    render(
      <ExternalFileChangeBanner
        mutation="changed"
        onReload={() => {}}
        onKeepEdits={() => {}}
        onCompare={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /reload from disk/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /keep my edits/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /compare/i })).toBeTruthy()
  })

  it('calls onReload when reload is chosen', () => {
    const onReload = vi.fn()
    render(
      <ExternalFileChangeBanner
        mutation="changed"
        onReload={onReload}
        onKeepEdits={() => {}}
        onCompare={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /reload from disk/i }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('calls onKeepEdits when the edits are kept', () => {
    const onKeepEdits = vi.fn()
    render(
      <ExternalFileChangeBanner
        mutation="changed"
        onReload={() => {}}
        onKeepEdits={onKeepEdits}
        onCompare={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /keep my edits/i }))
    expect(onKeepEdits).toHaveBeenCalledTimes(1)
  })

  it('offers no reload for a deleted file, because there is nothing to reload', () => {
    render(
      <ExternalFileChangeBanner
        mutation="deleted"
        onReload={() => {}}
        onKeepEdits={() => {}}
        onCompare={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /reload from disk/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /compare/i })).toBeNull()
    expect(screen.getByText(/deleted on disk/i)).toBeTruthy()
  })

  it('shows an undo affordance after a reload, and only then', () => {
    const { rerender } = render(
      <ExternalFileChangeBanner
        mutation="changed"
        onReload={() => {}}
        onKeepEdits={() => {}}
        onCompare={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull()

    rerender(
      <ExternalFileChangeBanner
        mutation={null}
        undoReload={() => {}}
        onReload={() => {}}
        onKeepEdits={() => {}}
        onCompare={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /undo/i })).toBeTruthy()
  })

  it('renders nothing when there is no conflict and no undo offer', () => {
    const { container } = render(
      <ExternalFileChangeBanner
        mutation={null}
        onReload={() => {}}
        onKeepEdits={() => {}}
        onCompare={() => {}}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})
