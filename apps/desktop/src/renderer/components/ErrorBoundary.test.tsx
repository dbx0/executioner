import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary.js'

function Bomb(): never {
  throw new Error('render crash')
}

afterEach(() => vi.unstubAllGlobals())

describe('ErrorBoundary', () => {
  it('logs once and shows the fallback with a Reload button', () => {
    const write = vi.fn()
    vi.stubGlobal('window', Object.assign(window, {
      executioner: { log: { write, getVerbose: () => Promise.resolve(false), onLevel: () => () => {} } },
    }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><Bomb /></ErrorBoundary>)
    expect(screen.getByText('Something went wrong. Restart Executioner, then export the logs from Settings > Logs.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]![0]).toMatchObject({
      lvl: 'error',
      data: { message: 'render crash', componentStack: expect.any(String) },
    })
  })
})
