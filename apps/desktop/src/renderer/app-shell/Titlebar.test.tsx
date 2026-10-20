import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../components/ui/tooltip.js'
import { Titlebar } from './Titlebar.js'

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

function renderTitlebar(): void {
  render(
    <TooltipProvider>
      <Titlebar />
    </TooltipProvider>,
  )
}

describe('Titlebar window controls', () => {
  beforeEach(() => {
    windowControl.mockReset()
    maximizedListener = undefined
  })

  it('leaves the buttons to the native traffic lights on macOS', () => {
    stubPlatform('darwin')
    renderTitlebar()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })

  it.each(['linux', 'win32'])('draws minimize, maximize and close on %s', (platform) => {
    stubPlatform(platform)
    renderTitlebar()
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(windowControl.mock.calls).toEqual([['minimize'], ['maximize'], ['close']])
  })

  it('offers restore once the window is maximized', () => {
    stubPlatform('linux')
    renderTitlebar()
    act(() => maximizedListener?.(true))
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDefined()
  })
})
