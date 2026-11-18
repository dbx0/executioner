import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../components/ui/tooltip.js'
import { useApp } from '../store.js'

// The panels fetch on mount; this file is about the frame around them.
vi.mock('../components/right-sidebar/FileExplorer.js', () => ({ FileExplorer: () => <div>explorer panel</div> }))
vi.mock('../components/right-sidebar/TargetsPanel.js', () => ({ TargetsPanel: () => <div>targets panel</div> }))
vi.mock('../components/right-sidebar/SessionHistory.js', () => ({ SessionHistory: () => <div /> }))
vi.mock('../components/right-sidebar/ExecutionHistory.js', () => ({ ExecutionHistory: () => <div /> }))
vi.mock('../components/right-sidebar/SourceControl.js', () => ({ SourceControl: () => <div /> }))

const { RightSidebar } = await import('./RightSidebar.js')

function renderSidebar(): void {
  render(
    <TooltipProvider>
      <RightSidebar />
    </TooltipProvider>,
  )
}

describe('RightSidebar', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.assign(window, { executioner: { platform: 'darwin' } })
    useApp.setState({ rightSidebarCollapsed: false, activeRightTab: 'explorer' })
  })

  it('collapses from the active tab and reopens on another, so the capsule is the panel toggle', () => {
    renderSidebar()
    expect(screen.getByText('explorer panel')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Explorer' }))
    expect(useApp.getState().rightSidebarCollapsed).toBe(true)
    expect(screen.queryByText('explorer panel')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Targets' }))
    expect(useApp.getState().rightSidebarCollapsed).toBe(false)
    expect(screen.getByText('targets panel')).toBeTruthy()
  })

  it('resizes against the 56px tool column and remembers the width', () => {
    renderSidebar()
    const handle = screen.getByRole('separator')
    fireEvent.mouseDown(handle)
    fireEvent.mouseMove(window, { clientX: window.innerWidth - 56 - 400 })
    expect((handle.parentElement as HTMLElement).style.width).toBe('400px')
    fireEvent.mouseUp(window)
    expect(localStorage.getItem('exe.rightSidebarWidth')).toBe('400')
  })

  it('draws the window controls over the capsule off macOS only', () => {
    renderSidebar()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })
})
