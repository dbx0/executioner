import type { JSX } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { TooltipProvider } from '../components/ui/tooltip.js'
import { useApp } from '../store.js'

// The live-session, runs and footer blocks pull in the spawn menu, the
// executions API and the settings wiring. None of that is what this file is
// about: the question here is how the nav rows are grouped.
vi.mock('./sidebar/SessionsSection.js', () => ({ SessionsSection: () => <div /> }))
vi.mock('./sidebar/RunsSection.js', () => ({ RunsSection: () => <div /> }))
vi.mock('./sidebar/SidebarFooter.js', () => ({ SidebarFooter: () => <div /> }))

const { Sidebar: BareSidebar } = await import('./Sidebar.js')

/** The header's toggle and the rail carry tooltips, which need the app's provider. */
function Sidebar(): JSX.Element {
  return (
    <TooltipProvider>
      <BareSidebar />
    </TooltipProvider>
  )
}

/** The labels of the nav rows under a given section heading, in render order. */
function rowsUnder(label: string): string[] {
  const heading = screen.getByText(label)
  const group = heading.parentElement
  if (group === null) throw new Error(`no group for ${label}`)
  return Array.from(group.querySelectorAll('button')).map((b) => b.textContent ?? '')
}

describe('Sidebar nav groups', () => {
  beforeEach(() => {
    useApp.setState({
      client: {} as AxiosInstance,
      connection: { id: 'e1' } as never,
      open: [],
      engagementName: null,
      sidebarCollapsed: false,
    })
  })

  it('groups the engagement views under one heading', () => {
    render(<Sidebar />)
    expect(rowsUnder('Engagement')).toEqual(['About', 'Scope', 'Targets', 'Findings'])
  })

  it('groups the automation views under their own heading', () => {
    render(<Sidebar />)
    expect(rowsUnder('Automation')).toEqual(['Actions', 'Workflows', 'Tools', 'Agents'])
  })

  it('renders engagement above automation', () => {
    render(<Sidebar />)
    const order = screen.getByText('Engagement').compareDocumentPosition(screen.getByText('Automation'))
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens the about view from its nav row', () => {
    render(<Sidebar />)
    screen.getByRole('button', { name: 'About' }).click()
    expect(useApp.getState().activeView).toBe('about')
  })

  it('opens the scope view from its nav row', () => {
    render(<Sidebar />)
    screen.getByRole('button', { name: 'Scope' }).click()
    expect(useApp.getState().activeView).toBe('scope')
  })

  it('still drives the hub tab from the automation rows', () => {
    render(<Sidebar />)
    screen.getByRole('button', { name: 'Agents' }).click()
    expect(useApp.getState().activeView).toBe('workflows')
    expect(useApp.getState().hubTab).toBe('agents')
  })

  it('names the open engagement in the header row, which drags the window', () => {
    useApp.setState({ engagementName: 'acme-corp' })
    render(<Sidebar />)
    const name = screen.getByText('acme-corp')
    expect(name.parentElement?.className).toContain('app-drag')
  })

  it('hides itself from the header toggle, which stays out of the drag region', () => {
    render(<Sidebar />)
    const toggle = screen.getByRole('button', { name: 'Toggle sidebar' })
    expect(toggle.className).toContain('app-no-drag')
    toggle.click()
    expect(useApp.getState().sidebarCollapsed).toBe(true)
  })

  it('shows the engagement rail only once an engagement is open', () => {
    const { unmount } = render(<Sidebar />)
    expect(screen.queryByRole('button', { name: 'New engagement' })).toBeNull()
    unmount()
    useApp.setState({ open: [{ root: '/a', name: 'a', browserAsks: {} } as never], activeRoot: '/a' })
    render(<Sidebar />)
    expect(screen.getByRole('button', { name: 'New engagement' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close a' })).toBeTruthy()
  })

  it('keeps the engagement rail and a way back when collapsed', () => {
    useApp.setState({
      open: [{ root: '/a', name: 'a', browserAsks: {} } as never],
      activeRoot: '/a',
      sidebarCollapsed: true,
    })
    render(<Sidebar />)
    expect(screen.getByRole('button', { name: 'New engagement' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close a' })).toBeTruthy()
    expect(screen.queryByText('Engagement')).toBeNull()
    expect(screen.queryByText('Search')).toBeNull()
    screen.getByRole('button', { name: 'Toggle sidebar' }).click()
    expect(useApp.getState().sidebarCollapsed).toBe(false)
  })

  it('renders nothing when collapsed with no engagement open', () => {
    useApp.setState({ sidebarCollapsed: true })
    const { container } = render(<Sidebar />)
    expect(container.querySelector('aside')).toBeNull()
  })
})
