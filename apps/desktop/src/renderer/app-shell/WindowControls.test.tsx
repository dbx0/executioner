import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WindowControls } from './WindowControls.js'

let maximizedListener: ((maximized: boolean) => void) | undefined
const windowControl = vi.fn()

function stubPlatform(platform: string): void {
  Object.assign(window, {
    executioner: {
      platform,
      windowControl,
      onMaximizedChange: (listener: (maximized: boolean) => void) => {
        maximizedListener = listener
        return () => (maximizedListener = undefined)
      },
    },
  })
}

describe('WindowControls', () => {
  beforeEach(() => {
    windowControl.mockReset()
    maximizedListener = undefined
  })

  it('leaves the buttons to the native traffic lights on macOS', () => {
    stubPlatform('darwin')
    const { container } = render(<WindowControls />)
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(container.firstChild).toBeNull()
  })

  it.each(['linux', 'win32'])('draws minimize, maximize and close on %s', (platform) => {
    stubPlatform(platform)
    render(<WindowControls />)
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(windowControl.mock.calls).toEqual([['minimize'], ['maximize'], ['close']])
  })

  it('offers restore once the window is maximized', () => {
    stubPlatform('linux')
    render(<WindowControls />)
    act(() => maximizedListener?.(true))
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDefined()
  })

  it('stays out of the window drag region', () => {
    stubPlatform('linux')
    render(<WindowControls />)
    expect(screen.getByRole('group', { name: 'Window' }).className).toContain('app-no-drag')
  })
})
