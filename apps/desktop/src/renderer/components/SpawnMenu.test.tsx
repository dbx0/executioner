import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosInstance } from 'axios'
import { useApp } from '../store.js'

vi.mock('../api/teams.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/teams.js')>()),
  teamsApi: () => ({ list: () => Promise.resolve([{ id: 't1', name: 'Recon & Strike', description: '', members: [] }]) }),
}))
vi.mock('../api/saved-agents.js', () => ({
  savedAgentsApi: () => ({ list: () => Promise.resolve([{ id: 's1', name: 'Web AppSec', description: '', agent: 'claude', prompt: 'p', scope: 'global' }]) }),
}))
vi.mock('../api/targets.js', () => ({ targetsApi: () => ({ list: () => Promise.resolve([]) }) }))
vi.mock('../api/backends.js', () => ({ backendsApi: () => ({ list: () => Promise.resolve([]) }) }))

const { SpawnMenu } = await import('./SpawnMenu.js')

// jsdom has no layout, so it lacks the scroll call an opened listbox makes.
Element.prototype.scrollIntoView = vi.fn()

const createSession = vi.fn(() => Promise.resolve())
const openBrowser = vi.fn(() => Promise.resolve())

beforeEach(() => {
  vi.clearAllMocks()
  useApp.setState({ client: {} as AxiosInstance, createSession, openBrowser, installedAgents: ['claude', 'codex'] })
})

/** Open the "+" menu the way a click does. */
function openMenu(): void {
  render(
    <SpawnMenu>
      <button type="button">New session</button>
    </SpawnMenu>,
  )
  const trigger = screen.getByRole('button', { name: 'New session' })
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
}

describe('SpawnMenu', () => {
  it('lists a terminal, a browser and an agent, then the installed CLIs and the teams', async () => {
    openMenu()
    const menu = await screen.findByRole('menu')
    await within(menu).findByRole('menuitem', { name: 'Recon & Strike' })
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Terminal',
      'Browser',
      'Agent',
      'Claude',
      'Codex',
      'Recon & Strike',
    ])
  })

  it('starts an installed CLI straight away', async () => {
    openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Codex' }))
    expect(createSession).toHaveBeenCalledWith({ agent: 'codex' })
  })

  it('opens the run dialog with the team already chosen', async () => {
    openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Recon & Strike' }))
    expect(await screen.findByText('Run “Recon & Strike”')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: /agent/i })).toBeNull()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('opens a terminal straight away', async () => {
    openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Terminal' }))
    expect(createSession).toHaveBeenCalledWith({ kind: 'shell' })
  })

  it('asks which agent to run, offering the installed CLIs, the saved agents and the teams', async () => {
    openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Agent' }))
    expect(await screen.findByText('Run an agent')).toBeTruthy()
    // Nothing starts until an agent is chosen in the dialog.
    expect(createSession).not.toHaveBeenCalled()

    const picker = screen.getByRole('combobox', { name: /agent/i })
    fireEvent.click(picker)
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(options).toEqual(['Claude', 'Codex', 'Web AppSec', 'Recon & Strike'])
  })
})
