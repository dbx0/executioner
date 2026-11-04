import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StatusBar } from './StatusBar.js'

vi.stubGlobal('__APP_VERSION__', '0.0.0')

function stub(verbose: boolean): { fire: (l: 'debug' | 'info') => void } {
  let listener: (l: 'debug' | 'info') => void = () => {}
  Object.assign(window, {
    executioner: {
      log: {
        getVerbose: vi.fn(() => Promise.resolve(verbose)),
        onLevel: vi.fn((cb: typeof listener) => {
          listener = cb
          return () => {}
        }),
      },
    },
  })
  return { fire: (l) => listener(l) }
}

afterEach(cleanup)

describe('StatusBar verbose indicator', () => {
  it('shows while verbose and hides otherwise', async () => {
    stub(false)
    render(<StatusBar />)
    await act(async () => {})
    expect(screen.queryByText('Verbose logging')).toBeNull()
    cleanup()
    stub(true)
    render(<StatusBar />)
    await screen.findByText('Verbose logging')
  })

  it('follows level changes', async () => {
    const h = stub(false)
    render(<StatusBar />)
    await act(async () => {})
    act(() => h.fire('debug'))
    expect(screen.getByText('Verbose logging')).toBeTruthy()
    act(() => h.fire('info'))
    expect(screen.queryByText('Verbose logging')).toBeNull()
  })
})
