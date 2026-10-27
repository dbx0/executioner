import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '../../store.js'
import { TOURS } from '../../lib/tours.js'
import { PageTour, placeCard } from './PageTour.js'

const connection = { url: 'http://127.0.0.1:1', token: 't' } as unknown as NonNullable<
  ReturnType<typeof useApp.getState>['connection']
>

/** Render the tour on `scope` and let its start delay pass. */
function openOn(view: 'scope' | 'targets' = 'scope'): void {
  useApp.setState({ activeView: view })
  render(<PageTour />)
  act(() => {
    vi.advanceTimersByTime(400)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useApp.setState({ connection, onboardingOpen: false, toursSeen: [], hubTab: 'workflows', activeView: 'scope' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PageTour', () => {
  it('walks the page tour one step per click and remembers it', () => {
    openOn('scope')
    const steps = TOURS.scope
    expect(screen.getByRole('dialog').textContent).toContain(steps[0]!.title)
    expect(screen.getByText(`1 of ${String(steps.length)}`)).toBeTruthy()

    for (let i = 1; i < steps.length; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
      expect(screen.getByRole('dialog').textContent).toContain(steps[i]!.title)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useApp.getState().toursSeen).toEqual(['scope'])
    expect(JSON.parse(localStorage.getItem('exe.toursSeen') ?? '[]')).toEqual(['scope'])
  })

  it('does not advance when the darkened page is clicked', () => {
    openOn('scope')
    const overlay = screen.getByRole('dialog').parentElement!
    fireEvent.mouseDown(overlay)
    fireEvent.click(overlay)
    expect(screen.getByText(`1 of ${String(TOURS.scope.length)}`)).toBeTruthy()
  })

  it('spotlights the anchor a step points at', () => {
    const anchor = document.createElement('button')
    anchor.setAttribute('data-tour', 'targets-add')
    anchor.getBoundingClientRect = () => ({ top: 10, left: 500, width: 90, height: 30 }) as DOMRect
    document.body.appendChild(anchor)
    openOn('targets')
    const spot = screen.getByTestId('tour-spotlight').style
    expect([spot.top, spot.left, spot.width, spot.height]).toEqual(['4px', '494px', '102px', '42px'])
    anchor.remove()
  })

  it('skipping counts as seen', () => {
    openOn('scope')
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useApp.getState().toursSeen).toEqual(['scope'])
  })

  it('stays away from a page whose tour was seen, and while onboarding runs', () => {
    useApp.setState({ toursSeen: ['scope'] })
    openOn('scope')
    expect(screen.queryByRole('dialog')).toBeNull()

    useApp.setState({ toursSeen: [], onboardingOpen: true })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('swallows app shortcuts while open', () => {
    const spy = vi.fn()
    window.addEventListener('keydown', spy)
    openOn('scope')
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    expect(spy).not.toHaveBeenCalled()
    window.removeEventListener('keydown', spy)
  })
})

describe('placeCard', () => {
  const card = { width: 320, height: 180 }
  const view = { width: 1200, height: 800 }

  it('goes below the anchor when it fits', () => {
    expect(placeCard({ top: 40, left: 100, width: 80, height: 30 }, card, view)).toEqual({ top: 82, left: 100 })
  })

  it('goes above when there is no room below', () => {
    expect(placeCard({ top: 700, left: 100, width: 80, height: 30 }, card, view)).toEqual({ top: 508, left: 100 })
  })

  it('goes beside a panel that fills the height', () => {
    expect(placeCard({ top: 50, left: 0, width: 400, height: 740 }, card, view)).toEqual({ top: 50, left: 412 })
  })

  it('stays inside the window', () => {
    expect(placeCard({ top: 40, left: 1150, width: 40, height: 30 }, card, view).left).toBe(1200 - 320 - 16)
  })

  it('centres without an anchor', () => {
    expect(placeCard(null, card, view)).toEqual({ top: 310, left: 440 })
  })
})
