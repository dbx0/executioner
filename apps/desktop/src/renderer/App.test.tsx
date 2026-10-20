import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App.js'

describe('App', () => {
  it('renders the full shell with the landing state when no engagement is open', () => {
    vi.stubGlobal(
      'window',
      Object.assign(window, {
        executioner: { pickFolder: vi.fn(), openProject: vi.fn(), onMaximizedChange: () => () => {} },
      }),
    )
    render(<App />)
    // Full shell present + landing empty state, not a blocking gate.
    expect(screen.getByRole('heading', { name: 'Executioner' })).toBeTruthy()
    // Both the sidebar control and the Landing CTA can open an engagement.
    expect(screen.getAllByRole('button', { name: /open engagement/i }).length).toBeGreaterThanOrEqual(1)
  })
})

describe('App — native context menu', () => {
  it('swallows the OS menu so only the app\'s own menus appear', () => {
    vi.stubGlobal(
      'window',
      Object.assign(window, { executioner: { pickFolder: vi.fn(), openProject: vi.fn(), onMaximizedChange: () => () => {} } }),
    )
    const { container } = render(<App />)

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    container.firstElementChild?.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves the menu alone in a text field', () => {
    vi.stubGlobal(
      'window',
      Object.assign(window, { executioner: { pickFolder: vi.fn(), openProject: vi.fn(), onMaximizedChange: () => () => {} } }),
    )
    render(<App />)

    const input = document.createElement('input')
    document.body.appendChild(input)
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    input.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    input.remove()
  })
})

