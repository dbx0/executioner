import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { useApp } from '../store.js'

// The live-session, runs and footer blocks pull in the spawn menu, the
// executions API and the settings wiring. None of that is what this file is
// about: the question here is how the nav rows are grouped.
vi.mock('./sidebar/SessionsSection.js', () => ({ SessionsSection: () => <div /> }))
vi.mock('./sidebar/RunsSection.js', () => ({ RunsSection: () => <div /> }))
vi.mock('./sidebar/SidebarFooter.js', () => ({ SidebarFooter: () => <div /> }))

const { Sidebar } = await import('./Sidebar.js')

/** The labels of the nav rows under a given section heading, in render order. */
function rowsUnder(label: string): string[] {
  const heading = screen.getByText(label)
  const group = heading.parentElement
  if (group === null) throw new Error(`no group for ${label}`)
  return Array.from(group.querySelectorAll('button')).map((b) => b.textContent ?? '')
}

describe('Sidebar nav groups', () => {
  beforeEach(() => {
    useApp.setState({ client: {} as AxiosInstance, connection: { id: 'e1' } as never })
  })

  it('groups the engagement views under one heading', () => {
    render(<Sidebar />)
    expect(rowsUnder('Engagement')).toEqual(['About', 'Scope', 'Targets', 'Findings'])
  })

  it('groups the automation views under their own heading', () => {
    render(<Sidebar />)
    expect(rowsUnder('Automation')).toEqual(['Workflows', 'Tools', 'Agents'])
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
})
